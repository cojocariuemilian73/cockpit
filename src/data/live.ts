// Date reale, gratuite, doar citire:
// - DexScreener: preț, lichiditate, tranzacții, social, căutare (~300 cereri/min), toate rețelele
// - GeckoTerminal: lumânări, tranzacții individuale, holderi, autorități, pool-uri noi/trend (limită strictă)
// - RugCheck: autorități, LP blocat/ars, riscuri (doar Solana)
// Cererile la GeckoTerminal și RugCheck trec prin cozi cu pauză, cache și așteptare la 429.

import type { Candle, Chain, TapeTrade, Token } from "../domain/types";

const DS = "https://api.dexscreener.com";
const GT = "https://api.geckoterminal.com/api/v2/networks";
const RC = "https://api.rugcheck.xyz/v1";

export const NATIVE: Record<Chain, { symbol: string; wrapped: string; label: string }> = {
  solana: { symbol: "SOL", wrapped: "So11111111111111111111111111111111111111112", label: "Solana" },
  base: { symbol: "ETH", wrapped: "0x4200000000000000000000000000000000000006", label: "Base" },
  bsc: { symbol: "BNB", wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", label: "BNB" },
};

// ---------- cache + cozi ----------

const cache = new Map<string, { at: number; data: unknown }>();

export class RateLimited extends Error {}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new RateLimited("limită de cereri");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function cached<T>(url: string, ttlMs: number): T | undefined {
  const c = cache.get(url);
  return c && Date.now() - c.at < ttlMs ? (c.data as T) : undefined;
}

async function ds<T>(path: string, ttlMs = 4000): Promise<T> {
  const url = DS + path;
  const hit = cached<T>(url, ttlMs);
  if (hit) return hit;
  const data = (await getJson(url)) as T;
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** Coadă cu pauză minimă între cereri și oprire 30 s după un 429. */
function queue(gapMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let nextAt = 0;
  let pausedUntil = 0;
  return function <T>(url: string, ttlMs: number): Promise<T> {
    const hit = cached<T>(url, ttlMs);
    if (hit) return Promise.resolve(hit);
    const run = async () => {
      const hit2 = cached<T>(url, ttlMs);
      if (hit2) return hit2;
      const wait = Math.max(nextAt, pausedUntil) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAt = Date.now() + gapMs;
      try {
        const data = (await getJson(url)) as T;
        cache.set(url, { at: Date.now(), data });
        return data;
      } catch (e) {
        if (e instanceof RateLimited) pausedUntil = Date.now() + 30_000;
        throw e;
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  };
}

const gtQ = queue(2600);
const rcQ = queue(900);
const gt = <T,>(chain: Chain, path: string, ttlMs: number) => gtQ<T>(`${GT}/${chain}${path}`, ttlMs);

// ---------- DexScreener ----------

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  txns?: { h1?: { buys: number; sells: number } };
  volume?: { h1?: number };
  priceChange?: { m5?: number; h1?: number };
  info?: { imageUrl?: string; socials?: { type: string; url: string }[]; websites?: { url: string }[] };
}

const isChain = (c: string): c is Chain => c === "solana" || c === "base" || c === "bsc";

function socials(p: DsPair): Token["socials"] {
  const s = p.info?.socials ?? [];
  const x = s.find((x) => x.type === "twitter")?.url;
  const telegram = s.find((x) => x.type === "telegram")?.url;
  const web = p.info?.websites?.[0]?.url;
  return { x, telegram, web };
}

function fromPair(p: DsPair): Token {
  const tx = p.txns?.h1;
  const n = tx ? tx.buys + tx.sells : 0;
  return {
    id: `${p.chainId}:${p.baseToken.address}`,
    ca: p.baseToken.address,
    chain: p.chainId as Chain,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    priceUsd: Number(p.priceUsd ?? 0),
    change1hPct: p.priceChange?.h1 ?? 0,
    change5mPct: p.priceChange?.m5,
    metrics: {
      liquidityUsd: p.liquidity?.usd,
      mcapUsd: p.marketCap ?? p.fdv,
      ageMin: p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 60_000 : undefined,
      buyRatioPct: n > 0 ? (tx!.buys / n) * 100 : undefined,
    },
    flags: {},
    source: "live",
    updatedAt: Date.now(),
    pairAddress: p.pairAddress,
    dex: p.dexId,
    imageUrl: p.info?.imageUrl,
    volume1hUsd: p.volume?.h1,
    socials: socials(p),
  };
}

const bestPair = (pairs: DsPair[], chain?: Chain) =>
  pairs.filter((p) => (chain ? p.chainId === chain : isChain(p.chainId))).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

/** Caută după contract, pe rețeaua dată. Null dacă nu există niciun pool. */
export async function lookupLive(chain: Chain, ca: string): Promise<Token | null> {
  const pairs = await ds<DsPair[]>(`/tokens/v1/${chain}/${ca}`);
  const p = Array.isArray(pairs) ? bestPair(pairs, chain) : undefined;
  if (!p) return null;
  return fromPair(p);
}

/** Caută după nume sau $TICKER, pe rețeaua dată. Un rezultat pe token (cel mai lichid pool). */
export async function searchLive(chain: Chain, q: string): Promise<Token[]> {
  const r = await ds<{ pairs: DsPair[] }>(`/latest/dex/search?q=${encodeURIComponent(q.replace(/^\$/, ""))}`, 20_000);
  const byToken = new Map<string, DsPair>();
  for (const p of r.pairs ?? []) {
    if (p.chainId !== chain) continue;
    const prev = byToken.get(p.baseToken.address);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) byToken.set(p.baseToken.address, p);
  }
  return [...byToken.values()].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 8).map(fromPair);
}

export interface LivePatch {
  priceUsd: number; change1hPct: number; change5mPct?: number; volume1hUsd?: number; pairAddress?: string;
  metrics: Token["metrics"]; socials?: Token["socials"]; imageUrl?: string;
}

/** Prețuri, metrici și social pentru până la 30 de tokenuri pe cerere, grupate pe rețea. Cheia e id-ul tokenului. */
export async function refreshLive(tokens: { chain: Chain; ca: string; id: string }[]): Promise<Record<string, LivePatch>> {
  const out: Record<string, LivePatch> = {};
  const byChain = new Map<Chain, typeof tokens>();
  for (const t of tokens) byChain.set(t.chain, [...(byChain.get(t.chain) ?? []), t]);
  for (const [chain, list] of byChain) {
    for (let i = 0; i < list.length; i += 30) {
      const chunk = list.slice(i, i + 30);
      const pairs = await ds<DsPair[]>(`/tokens/v1/${chain}/${chunk.map((t) => t.ca).join(",")}`, 3000);
      for (const t of chunk) {
        const p = bestPair((pairs ?? []).filter((x) => x.baseToken.address.toLowerCase() === t.ca.toLowerCase()), chain);
        if (!p) continue;
        const f = fromPair(p);
        out[t.id] = {
          priceUsd: f.priceUsd, change1hPct: f.change1hPct, change5mPct: f.change5mPct, volume1hUsd: f.volume1hUsd,
          pairAddress: f.pairAddress, metrics: f.metrics, socials: f.socials, imageUrl: f.imageUrl,
        };
      }
    }
  }
  return out;
}

const nativeUsd: Record<Chain, number> = { solana: 150, base: 3000, bsc: 600 };
export async function nativePrices(): Promise<Record<Chain, number>> {
  await Promise.all((Object.keys(NATIVE) as Chain[]).map(async (c) => {
    try {
      const pairs = await ds<DsPair[]>(`/tokens/v1/${c}/${NATIVE[c].wrapped}`, 300_000);
      const stable = (pairs ?? []).filter((p) => /^(USDC|USDT|USD₮|BUSD)$/i.test(p.quoteToken.symbol)).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (stable?.priceUsd) nativeUsd[c] = Number(stable.priceUsd);
    } catch { /* păstrăm ultima valoare */ }
  }));
  return { ...nativeUsd };
}

// ---------- GeckoTerminal + RugCheck ----------

interface GtInfo {
  data: { attributes: {
    holders?: { count?: number; distribution_percentage?: Record<string, string> };
    mint_authority?: string | null;
    freeze_authority?: string | null;
    image_url?: string | null;
  } };
}

interface RcSummary { score_normalised?: number; lpLockedPct?: number; risks?: { name: string; level: string }[] }

/** Holderi și distribuție (GeckoTerminal) + autorități și LP (RugCheck, doar Solana). */
export async function enrich(t: Token): Promise<Partial<Token>> {
  const metrics: Token["metrics"] = {};
  const flags: Token["flags"] = {};
  const out: Partial<Token> = {};
  const [info, rug] = await Promise.allSettled([
    gt<GtInfo>(t.chain, `/tokens/${t.ca}/info`, 10 * 60_000),
    t.chain === "solana" ? rugcheck(t.ca) : Promise.reject(new Error("doar Solana")),
  ]);
  if (info.status === "fulfilled") {
    const a = info.value.data.attributes;
    const d = a.holders?.distribution_percentage;
    if (a.holders?.count) metrics.holders = a.holders.count;
    if (d?.top_10) metrics.top10Pct = Number(d.top_10);
    if (a.mint_authority != null) flags.mintRenounced = a.mint_authority === "no";
    if (a.freeze_authority != null) flags.freezeRenounced = a.freeze_authority === "no";
    if (a.image_url && !a.image_url.includes("missing")) out.imageUrl = a.image_url;
    if (d?.top_10) out.holdersDist = { top10: Number(d.top_10), r11_20: Number(d["11_20"] ?? 0), r21_40: Number(d["21_40"] ?? 0), rest: Number(d.rest ?? 0) };
  }
  if (rug.status === "fulfilled") {
    Object.assign(flags, rug.value.flags);
    out.rug = rug.value.rug;
  }
  if (info.status === "rejected" && rug.status === "rejected") throw info.reason;
  return { ...out, metrics, flags };
}

/** Doar RugCheck: rapid, folosit și pentru filtrele din radar. */
export async function rugcheck(ca: string): Promise<Pick<Token, "flags" | "rug">> {
  const r = await rcQ<RcSummary>(`${RC}/tokens/${ca}/report/summary`, 10 * 60_000);
  const risks = (r.risks ?? []).map((x) => ({ name: x.name, level: x.level }));
  const has = (re: RegExp) => risks.some((x) => re.test(x.name));
  return {
    flags: {
      mintRenounced: !has(/mint authority/i),
      freezeRenounced: !has(/freeze authority/i),
      ...(r.lpLockedPct !== undefined ? { lpBurned: r.lpLockedPct >= 95 } : {}),
    },
    rug: { score: r.score_normalised ?? 0, lpLockedPct: r.lpLockedPct, risks, top10High: has(/top 10 holders|single holder/i) },
  };
}

export type Timeframe = "1m" | "5m" | "15m" | "1h";
const TF: Record<Timeframe, string> = { "1m": "minute?aggregate=1", "5m": "minute?aggregate=5", "15m": "minute?aggregate=15", "1h": "hour?aggregate=1" };

export async function candlesLive(chain: Chain, pool: string, tf: Timeframe): Promise<Candle[]> {
  const r = await gt<{ data: { attributes: { ohlcv_list: number[][] } } }>(chain, `/pools/${pool}/ohlcv/${TF[tf]}&limit=200&currency=usd`, 45_000);
  return r.data.attributes.ohlcv_list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

interface GtTrade { id: string; attributes: { block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; price_to_in_usd: string; price_from_in_usd: string; tx_from_address: string } }

export async function tapeLive(chain: Chain, pool: string): Promise<TapeTrade[]> {
  const r = await gt<{ data: GtTrade[] }>(chain, `/pools/${pool}/trades`, 15_000);
  return r.data.filter((x) => Number(x.attributes.volume_in_usd) >= 1).slice(0, 25).map((x) => ({
    id: x.id,
    ts: Date.parse(x.attributes.block_timestamp),
    side: x.attributes.kind,
    usd: Number(x.attributes.volume_in_usd),
    priceUsd: Number(x.attributes.kind === "buy" ? x.attributes.price_to_in_usd : x.attributes.price_from_in_usd),
    wallet: x.attributes.tx_from_address,
  }));
}

interface GtPool {
  attributes: {
    address: string; name: string; pool_created_at: string; base_token_price_usd: string;
    fdv_usd: string | null; market_cap_usd: string | null; reserve_in_usd: string;
    price_change_percentage: { m5: string; h1: string }; transactions: { h1: { buys: number; sells: number } }; volume_usd: { h1: string };
  };
  relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
}
interface GtIncluded { id: string; attributes: { address: string; name: string; symbol: string; image_url?: string | null } }

export type RadarKind = "noi" | "trend";

/** Pool-uri noi sau în trend, ca tokenuri. Social și m5 vin dintr-o cerere DexScreener grupată. */
export async function radarLive(chain: Chain, kind: RadarKind): Promise<Token[]> {
  const path = kind === "noi" ? "/new_pools?include=base_token&page=1" : "/trending_pools?include=base_token&duration=1h&page=1";
  const r = await gt<{ data: GtPool[]; included?: GtIncluded[] }>(chain, path, 50_000);
  const inc = new Map((r.included ?? []).map((i) => [i.id, i.attributes]));
  const seen = new Set<string>();
  const tokens = r.data.flatMap((p) => {
    const b = inc.get(p.relationships.base_token.data.id);
    if (!b || seen.has(b.address)) return [];
    seen.add(b.address);
    const a = p.attributes;
    const tx = a.transactions.h1;
    const n = tx.buys + tx.sells;
    const t: Token = {
      id: `${chain}:${b.address}`, ca: b.address, chain, symbol: b.symbol, name: b.name,
      priceUsd: Number(a.base_token_price_usd), change1hPct: Number(a.price_change_percentage.h1), change5mPct: Number(a.price_change_percentage.m5),
      metrics: {
        liquidityUsd: Number(a.reserve_in_usd),
        mcapUsd: Number(a.market_cap_usd ?? a.fdv_usd ?? 0) || undefined,
        ageMin: (Date.now() - Date.parse(a.pool_created_at)) / 60_000,
        buyRatioPct: n ? (tx.buys / n) * 100 : undefined,
      },
      flags: {}, source: "live", updatedAt: Date.now(),
      pairAddress: a.address, dex: p.relationships.dex.data.id,
      imageUrl: b.image_url && !b.image_url.includes("missing") ? b.image_url : undefined,
      volume1hUsd: Number(a.volume_usd.h1),
    };
    return [t];
  });
  try {
    const patches = await refreshLive(tokens);
    for (const t of tokens) {
      const p = patches[t.id];
      if (p) { t.socials = p.socials; t.imageUrl = t.imageUrl ?? p.imageUrl; }
    }
  } catch { /* social rămâne necunoscut */ }
  return tokens;
}
