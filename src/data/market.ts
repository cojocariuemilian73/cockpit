// Fațada de date: UI-ul vorbește doar cu `market`. Tokenurile demo (source = "mock") merg pe
// simulare; cele reale pe DexScreener + GeckoTerminal + RugCheck. Același contract poate fi
// servit mai târziu de un API propriu (cu cache comun și chei pe server).

import type { Candle, Chain, TapeTrade, Token } from "../domain/types";
import { mockCandles, mockSource, mockTape } from "./mock";
import { candlesLive, enrich, lookupLive, nativePrices, radarLive, refreshLive, rugcheck, searchLive, tapeLive, type RadarKind, type Timeframe } from "./live";

export type { RadarKind, Timeframe };
export { NATIVE } from "./live";

const SOL_CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_CA = /^0x[0-9a-fA-F]{40}$/;
/** Detectează rețeaua dintr-o adresă lipită (o adresă EVM rămâne pe rețeaua EVM curentă, altfel Base). */
export const chainOfCa = (s: string, current: Chain): Chain | null =>
  EVM_CA.test(s.trim()) ? (current === "solana" ? "base" : current) : SOL_CA.test(s.trim()) ? "solana" : null;

export const market = {
  watchlist: () => mockSource.watchlist(),
  step: (tokens: Token[], dtSec: number) => mockSource.step(tokens, dtSec),
  natives: () => nativePrices(),

  async lookup(chain: Chain, ca: string): Promise<{ token: Token | null; offline: boolean }> {
    try {
      return { token: await lookupLive(chain, ca.trim()), offline: false };
    } catch {
      return { token: chain === "solana" ? await mockSource.lookup(ca) : null, offline: true };
    }
  },
  search: (chain: Chain, q: string) => searchLive(chain, q),
  refresh: (tokens: { chain: Chain; ca: string; id: string }[]) => refreshLive(tokens),
  enrich: (t: Token): Promise<Partial<Token>> => (t.source === "live" ? enrich(t) : Promise.resolve({})),
  rugcheck: (t: Token): Promise<Partial<Token>> => (t.source === "live" && t.chain === "solana" ? rugcheck(t.ca) : Promise.resolve({})),
  radar: (chain: Chain, kind: RadarKind) => radarLive(chain, kind),

  candles(t: Token, tf: Timeframe): Promise<Candle[]> {
    if (t.source === "live" && t.pairAddress) return candlesLive(t.chain, t.pairAddress, tf);
    return Promise.resolve(mockCandles(t, tf));
  },
  tape(t: Token): Promise<TapeTrade[]> {
    if (t.source === "live" && t.pairAddress) return tapeLive(t.chain, t.pairAddress);
    return Promise.resolve(mockTape(t));
  },
};
