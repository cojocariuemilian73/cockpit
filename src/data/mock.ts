import type { Candle, TapeTrade, Token } from "../domain/types";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function hash(str: string) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function fakeCa(seed: number) {
  const r = seeded(seed);
  let out = "";
  for (let i = 0; i < 43; i++) out += B58[Math.floor(r() * B58.length)];
  return out + "p"; // pump.fun obișnuiește sufixul „pump”; aici doar un „p” ca să nu pară real
}

// volatilitate pe secundă, per token (date mock)
const VOL: Record<string, number> = {};

function make(sym: string, name: string, price: number, vol: number, t: Omit<Token, "id" | "ca" | "chain" | "symbol" | "name" | "priceUsd" | "source" | "updatedAt">): Token {
  const ca = fakeCa(hash(sym));
  VOL[ca] = vol;
  return { id: ca, ca, chain: "solana", symbol: sym, name, priceUsd: price, source: "mock", updatedAt: Date.now(), ...t };
}

const WATCH: Token[] = [
  make("PUFF", "Puff the Dragon", 0.001284, 0.012, {
    change1hPct: 6.4, change5mPct: 0.8, socials: { x: "https://x.com/demo" },
    metrics: { liquidityUsd: 182_000, mcapUsd: 1_420_000, ageMin: 380, holders: 2840, top10Pct: 18, devHoldPct: 0, bundlePct: 3, buyRatioPct: 61 },
    flags: { mintRenounced: true, freezeRenounced: true, lpBurned: true },
  }),
  make("GRUB", "Grub", 0.000261, 0.02, {
    change1hPct: 38.2, change5mPct: 12, socials: { telegram: "https://t.me/demo" },
    metrics: { liquidityUsd: 64_000, mcapUsd: 260_000, ageMin: 22, holders: 610, top10Pct: 34, devHoldPct: 2.5, bundlePct: 9, buyRatioPct: 55 },
    flags: { mintRenounced: true, freezeRenounced: true, lpBurned: false },
  }),
  make("ZAPZ", "Zapzeke", 0.0000418, 0.035, {
    change1hPct: 212, change5mPct: 240,
    metrics: { liquidityUsd: 12_400, mcapUsd: 41_800, ageMin: 9, holders: 140, top10Pct: 58, devHoldPct: 11, bundlePct: 27, buyRatioPct: 72 },
    flags: { mintRenounced: true, freezeRenounced: false, lpBurned: false },
  }),
  make("OTTO", "Otto the Otter", 0.00733, 0.015, {
    change1hPct: -4.1, change5mPct: -0.6, socials: { x: "https://x.com/demo" },
    metrics: { liquidityUsd: 96_000, mcapUsd: 7_330_000, ageMin: 2900, top10Pct: 22, devHoldPct: 0, buyRatioPct: 48 },
    flags: { mintRenounced: true, freezeRenounced: true },
  }),
];

function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export const mockSource = {
  name: "date simulate",
  watchlist: () => WATCH.map((t) => ({ ...t })),
  async lookup(ca: string): Promise<Token | null> {
    const clean = ca.trim();
    if (clean.length < 32 || clean.length > 44 || [...clean].some((c) => !B58.includes(c))) return null;
    const found = WATCH.find((t) => t.ca === clean);
    if (found) return { ...found };
    // orice CA valid ca format primește un token generat determinist din hash
    const r = seeded(hash(clean));
    const sym = Array.from({ length: 4 }, () => "ABCDEFGHKLMNPRSTVWZ"[Math.floor(r() * 19)]).join("");
    const liq = Math.round(5_000 + r() * 200_000);
    VOL[clean] = 0.01 + r() * 0.03;
    return {
      id: clean, ca: clean, chain: "solana", symbol: sym, name: `Token ${sym}`,
      priceUsd: +(0.00001 + r() * 0.01).toPrecision(4), change1hPct: Math.round((r() * 160 - 40) * 10) / 10,
      metrics: {
        liquidityUsd: liq, mcapUsd: Math.round(liq * (3 + r() * 15)), ageMin: Math.round(3 + r() * 600),
        holders: Math.round(50 + r() * 3000), top10Pct: Math.round(10 + r() * 60), devHoldPct: Math.round(r() * 120) / 10,
        bundlePct: Math.round(r() * 35), buyRatioPct: Math.round(40 + r() * 35),
      },
      flags: { mintRenounced: r() > 0.15, freezeRenounced: r() > 0.2, lpBurned: r() > 0.5 },
      source: "mock", updatedAt: Date.now(),
    };
  },
  step(tokens: Token[], dtSec: number): Token[] {
    const r = Math.random;
    return tokens.map((t) => {
      if (t.source !== "mock") return t;
      const vol = (VOL[t.ca] ?? 0.02) * Math.sqrt(dtSec);
      const f = Math.exp(gauss(r) * vol - (vol * vol) / 2);
      return { ...t, priceUsd: t.priceUsd * f, updatedAt: Date.now() };
    });
  },
};

const TF_SEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 } as const;

/** Istoric sintetic care se termină exact la prețul curent (doar pentru tokenurile demo). */
export function mockCandles(t: Token, tf: keyof typeof TF_SEC): Candle[] {
  const step = TF_SEC[tf];
  const r = seeded(hash(t.ca + tf));
  const vol = (VOL[t.ca] ?? 0.02) * Math.sqrt(step) * 0.6;
  const n = 160;
  const closes: number[] = [t.priceUsd];
  for (let i = 1; i < n; i++) closes.unshift(closes[0] / Math.exp(gauss(r) * vol + vol * 0.04));
  const now = Math.floor(Date.now() / 1000 / step) * step;
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close / Math.exp(gauss(r) * vol);
    const hi = Math.max(open, close) * (1 + Math.abs(gauss(r)) * vol * 0.4);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss(r)) * vol * 0.4);
    return { time: now - (n - 1 - i) * step, open, high: hi, low: lo, close, volume: Math.round(500 + r() * 20_000) };
  });
}

export function mockTape(t: Token): TapeTrade[] {
  const r = Math.random;
  const now = Date.now();
  let ts = now;
  return Array.from({ length: 18 }, (_, i) => {
    ts -= Math.round(2_000 + r() * 40_000);
    const side = r() < ((t.metrics.buyRatioPct ?? 50) / 100) ? "buy" : "sell";
    const usd = Math.round(Math.exp(2 + r() * 6));
    return { id: `${t.id}-${i}-${ts}`, ts, side, usd, priceUsd: t.priceUsd * (1 + (r() - 0.5) * 0.02), wallet: fakeCa(Math.floor(r() * 1e9)) };
  });
}
