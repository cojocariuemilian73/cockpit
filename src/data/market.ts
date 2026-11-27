// Implementările adaptoarelor de piață și securitate. Tokenurile demo (source = "mock") merg pe simulare cu seed;
// cele reale pe DexScreener + GeckoTerminal (MarketData) și GeckoTerminal + RugCheck (Security).

import type { Chain, Token } from "../domain/types";
import type { MarketDataAdapter, SecurityAdapter } from "./adapters";
import { mockCandles, mockSource, mockTape } from "./mock";
import { candlesLive, enrich, lookupLive, nativePrices, radarLive, refreshLive, rugcheck, searchLive, tapeLive, type RadarKind, type Timeframe } from "./live";

export type { RadarKind, Timeframe };
export { NATIVE } from "./live";

const SOL_CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_CA = /^0x[0-9a-fA-F]{40}$/;
/** Detectează rețeaua dintr-o adresă lipită (o adresă EVM rămâne pe rețeaua EVM curentă, altfel Base). */
export const chainOfCa = (s: string, current: Chain): Chain | null =>
  EVM_CA.test(s.trim()) ? (current === "solana" ? "base" : current) : SOL_CA.test(s.trim()) ? "solana" : null;

export const marketData: MarketDataAdapter = {
  watchlist: (now) => mockSource.watchlist(now),
  async lookup(chain, ca, now) {
    try {
      return { token: await lookupLive(chain, ca.trim()), offline: false };
    } catch {
      return { token: chain === "solana" ? await mockSource.lookup(ca, now) : null, offline: true };
    }
  },
  search: (chain, q) => searchLive(chain, q),
  refresh: (tokens) => refreshLive(tokens.filter((t) => t.source === "live")),
  natives: () => nativePrices(),
  radar: (chain, kind) => radarLive(chain, kind),
  candles(t, tf, now) {
    if (t.source === "live" && t.pairAddress) return candlesLive(t.chain, t.pairAddress, tf);
    return Promise.resolve(mockCandles(t, tf, now));
  },
  tape(t, now) {
    if (t.source === "live" && t.pairAddress) return tapeLive(t.chain, t.pairAddress);
    return Promise.resolve(mockTape(t, now));
  },
};

export const security: SecurityAdapter = {
  enrich: (t: Token) => (t.source === "live" ? enrich(t) : Promise.resolve({})),
  quick: (t: Token) => (t.source === "live" && t.chain === "solana" ? rugcheck(t.ca) : Promise.resolve({})),
};

/** Pasul pieței demo: aici intră generatorul cu seed. */
export const stepDemo = mockSource.step;
