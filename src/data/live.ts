// Date reale, gratuite, doar citire: DexScreener (preț, lichiditate, tranzacții; ~300 cereri/min)
// și GeckoTerminal (lumânări, tranzacții individuale, holderi, autorități; limită strictă).
// Cererile la GeckoTerminal trec printr-o coadă cu pauză între ele, cache și așteptare la 429.
// Mai târziu: un API propriu (dev, bundle, insideri) cu aceeași formă.

import type { Candle, TapeTrade, Token } from "../domain/types";

const DS = "https://api.dexscreener.com";
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

// ---------- cache + coadă ----------

const cache = new Map<string, { at: number; data: unknown }>();
let gtChain: Promise<unknown> = Promise.resolve();
let gtNextAt = 0;
let gtPausedUntil = 0;
const GT_GAP_MS = 2600;

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

function gt<T>(path: string, ttlMs: number): Promise<T> {
  const url = GT + path;
  const hit = cached<T>(url, ttlMs);
  if (hit) return Promise.resolve(hit);
  const run = async () => {
    const hit2 = cached<T>(url, ttlMs);
    if (hit2) return hit2;
    const wait = Math.max(gtNextAt, gtPausedUntil) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    gtNextAt = Date.now() + GT_GAP_MS;
    try {
      const data = (await getJson(url)) as T;
      cache.set(url, { at: Date.now(), data });
      return data;
    } catch (e) {
      if (e instanceof RateLimited) gtPausedUntil = Date.now() + 30_000;
      throw e;
    }
  };
  const p = gtChain.then(run, run);
  gtChain = p.catch(() => undefined);
  return p;
}

export const gtStatus = () => (gtPausedUntil > Date.now() ? "pauză" : "ok");

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
  priceChange?: { h1?: number };
  info?: { imageUrl?: string };
}

function fromPair(p: DsPair): Token {
  const tx = p.txns?.h1;
  const n = tx ? tx.buys + tx.sells : 0;
  return {
    id: p.baseToken.address,
    ca: p.baseToken.address,
    chain: "solana",
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    priceUsd: Number(p.priceUsd ?? 0),
    change1hPct: p.priceChange?.h1 ?? 0,
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
  };
}

const bestPair = (pairs: DsPair[]) =>
  pairs.filter((p) => p.chainId === "solana").sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

/** Caută după contract. Null dacă nu există niciun pool pe Solana. */
export async function lookupLive(ca: string): Promise<Token | null> {
  const pairs = await ds<DsPair[]>(`/tokens/v1/solana/${ca}`);
  const p = Array.isArray(pairs) ? bestPair(pairs) : undefined;
  if (!p) return null;
  const t = fromPair(p);
  try { Object.assign(t, await enrich(t)); } catch { /* holderii vin la următoarea reîmprospătare */ }
  return t;
}

/** Caută după nume sau simbol. Întoarce un rezultat pe token (cel mai lichid pool). */
export async function searchLive(q: string): Promise<Token[]> {
  const r = await ds<{ pairs: DsPair[] }>(`/latest/dex/search?q=${encodeURIComponent(q)}`, 20_000);
  const byToken = new Map<string, DsPair>();
  for (const p of r.pairs ?? []) {
    if (p.chainId !== "solana") continue;
    const prev = byToken.get(p.baseToken.address);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) byToken.set(p.baseToken.address, p);
  }
  return [...byToken.values()].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 8).map(fromPair);
}

/** Prețuri și metrici pentru până la 30 de tokenuri într-o singură cerere. */
export interface LivePatch { priceUsd: number; change1hPct: number; volume1hUsd?: number; pairAddress?: string; metrics: Token["metrics"] }

export async function refreshLive(cas: string[]): Promise<Record<string, LivePatch>> {
  const out: Record<string, LivePatch> = {};
  for (let i = 0; i < cas.length; i += 30) {
    const chunk = cas.slice(i, i + 30);
    const pairs = await ds<DsPair[]>(`/tokens/v1/solana/${chunk.join(",")}`, 3000);
    for (const ca of chunk) {
      const p = bestPair((pairs ?? []).filter((x) => x.baseToken.address === ca));
      if (!p) continue;
      const t = fromPair(p);
      out[ca] = { priceUsd: t.priceUsd, change1hPct: t.change1hPct, volume1hUsd: t.volume1hUsd, pairAddress: t.pairAddress, metrics: t.metrics };
    }
  }
  return out;
}

let solUsd = 150;
export async function solPriceUsd(): Promise<number> {
  try {
    const pairs = await ds<DsPair[]>("/tokens/v1/solana/So11111111111111111111111111111111111111112", 300_000);
    const usdc = (pairs ?? []).find((p) => p.quoteToken.symbol === "USDC" && p.baseToken.symbol === "SOL");
    if (usdc?.priceUsd) solUsd = Number(usdc.priceUsd);
  } catch { /* păstrăm ultima valoare */ }
  return solUsd;
}

// ---------- GeckoTerminal ----------

interface GtInfo {
  data: { attributes: {
    holders?: { count?: number; distribution_percentage?: Record<string, string> };
    mint_authority?: string | null;
    freeze_authority?: string | null;
    image_url?: string | null;
  } };
}

/** Holderi, distribuție, autorități. Dev-ul și bundle-ul nu vin de aici: rămân „lipsesc datele”. */
export async function enrich(t: Token): Promise<Partial<Token>> {
  const r = await gt<GtInfo>(`/tokens/${t.ca}/info`, 10 * 60_000);
  const a = r.data.attributes;
  const d = a.holders?.distribution_percentage;
  const metrics = { ...t.metrics };
  if (a.holders?.count) metrics.holders = a.holders.count;
  if (d?.top_10) metrics.top10Pct = Number(d.top_10);
  const flags = { ...t.flags };
  if (a.mint_authority != null) flags.mintRenounced = a.mint_authority === "no";
  if (a.freeze_authority != null) flags.freezeRenounced = a.freeze_authority === "no";
  return {
    metrics, flags,
    imageUrl: t.imageUrl ?? a.image_url ?? undefined,
    holdersDist: d?.top_10 ? { top10: Number(d.top_10), r11_20: Number(d["11_20"] ?? 0), r21_40: Number(d["21_40"] ?? 0), rest: Number(d.rest ?? 0) } : undefined,
  };
}

export type Timeframe = "1m" | "5m" | "15m" | "1h";
const TF: Record<Timeframe, string> = { "1m": "minute?aggregate=1", "5m": "minute?aggregate=5", "15m": "minute?aggregate=15", "1h": "hour?aggregate=1" };

export async function candlesLive(pool: string, tf: Timeframe): Promise<Candle[]> {
  const r = await gt<{ data: { attributes: { ohlcv_list: number[][] } } }>(`/pools/${pool}/ohlcv/${TF[tf]}&limit=200&currency=usd`, 45_000);
  return r.data.attributes.ohlcv_list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

interface GtTrade { id: string; attributes: { block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; price_to_in_usd: string; price_from_in_usd: string; tx_from_address: string } }

export async function tapeLive(pool: string): Promise<TapeTrade[]> {
  const r = await gt<{ data: GtTrade[] }>(`/pools/${pool}/trades`, 15_000);
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
    price_change_percentage: { h1: string }; transactions: { h1: { buys: number; sells: number } }; volume_usd: { h1: string };
  };
  relationships: { base_token: { data: { id: string } }; dex: { data: { id: string } } };
}
interface GtIncluded { id: string; attributes: { address: string; name: string; symbol: string; image_url?: string | null } }

export type RadarKind = "noi" | "trend";

/** Pool-uri noi sau în trend, ca tokenuri. Holderii și autoritățile se completează la selectare. */
export async function radarLive(kind: RadarKind): Promise<Token[]> {
  const path = kind === "noi" ? "/new_pools?include=base_token&page=1" : "/trending_pools?include=base_token&duration=1h&page=1";
  const r = await gt<{ data: GtPool[]; included?: GtIncluded[] }>(path, 50_000);
  const inc = new Map((r.included ?? []).map((i) => [i.id, i.attributes]));
  return r.data.flatMap((p) => {
    const b = inc.get(p.relationships.base_token.data.id);
    if (!b) return [];
    const a = p.attributes;
    const tx = a.transactions.h1;
    const n = tx.buys + tx.sells;
    const t: Token = {
      id: b.address, ca: b.address, chain: "solana", symbol: b.symbol, name: b.name,
      priceUsd: Number(a.base_token_price_usd), change1hPct: Number(a.price_change_percentage.h1),
      metrics: {
        liquidityUsd: Number(a.reserve_in_usd),
        mcapUsd: Number(a.market_cap_usd ?? a.fdv_usd ?? 0) || undefined,
        ageMin: (Date.now() - Date.parse(a.pool_created_at)) / 60_000,
        buyRatioPct: n ? (tx.buys / n) * 100 : undefined,
      },
      flags: {}, source: "live", updatedAt: Date.now(),
      pairAddress: a.address, dex: p.relationships.dex.data.id, imageUrl: b.image_url ?? undefined,
      volume1hUsd: Number(a.volume_usd.h1),
    };
    return [t];
  });
}
