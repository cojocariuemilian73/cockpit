// Fațada de date: UI-ul vorbește doar cu `market`. Tokenurile demo (source = "mock") merg pe
// simulare; cele reale pe DexScreener + GeckoTerminal. Același contract poate fi servit
// mai târziu de un API propriu.

import type { Candle, TapeTrade, Token } from "../domain/types";
import { mockCandles, mockSource, mockTape } from "./mock";
import { candlesLive, enrich, lookupLive, radarLive, refreshLive, searchLive, tapeLive, type RadarKind, type Timeframe } from "./live";

export type { RadarKind, Timeframe };

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const looksLikeCa = (s: string) => B58.test(s.trim());

export const market = {
  watchlist: () => mockSource.watchlist(),
  step: (tokens: Token[], dtSec: number) => mockSource.step(tokens, dtSec),

  async lookup(ca: string): Promise<{ token: Token | null; offline: boolean }> {
    try {
      return { token: await lookupLive(ca.trim()), offline: false };
    } catch {
      return { token: await mockSource.lookup(ca), offline: true };
    }
  },
  search: (q: string) => searchLive(q),
  refresh: (cas: string[]) => refreshLive(cas),
  enrich: (t: Token) => (t.source === "live" ? enrich(t) : Promise.resolve({})),
  radar: (kind: RadarKind) => radarLive(kind),

  candles(t: Token, tf: Timeframe): Promise<Candle[]> {
    if (t.source === "live" && t.pairAddress) return candlesLive(t.pairAddress, tf);
    return Promise.resolve(mockCandles(t, tf));
  },
  tape(t: Token): Promise<TapeTrade[]> {
    if (t.source === "live" && t.pairAddress) return tapeLive(t.pairAddress);
    return Promise.resolve(mockTape(t));
  },
};
