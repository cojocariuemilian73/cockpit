// Contractele dintre cockpit și lumea de afară. UI-ul și store-ul vorbesc doar prin ele;
// o sursă nouă (API propriu, Birdeye, proxy X) se scrie ca o nouă implementare, fără să se atingă motorul.

import type { Candle, Chain, TapeTrade, Token, TrackedWallet, Tweet, WalletActivity } from "../domain/types";
import type { LivePatch, RadarKind, Timeframe } from "./live";

export interface MarketDataAdapter {
  /** tokenurile demo de pornire */
  watchlist(now: number): Token[];
  lookup(chain: Chain, ca: string, now: number): Promise<{ token: Token | null; offline: boolean }>;
  search(chain: Chain, q: string): Promise<Token[]>;
  refresh(tokens: Token[]): Promise<Record<string, LivePatch>>;
  natives(): Promise<Record<Chain, number>>;
  radar(chain: Chain, kind: RadarKind): Promise<Token[]>;
  candles(t: Token, tf: Timeframe, now: number): Promise<Candle[]>;
  tape(t: Token, now: number): Promise<TapeTrade[]>;
}

export interface SecurityAdapter {
  /** holderi, distribuție, autorități, raport de risc */
  enrich(t: Token): Promise<Partial<Token>>;
  /** doar autoritățile și LP-ul, rapid (pentru filtrele din radar) */
  quick(t: Token): Promise<Partial<Token>>;
}

export type XMode = "ca" | "ticker" | "kol";

export interface SocialFeedAdapter {
  /** true când conturile sunt inventate (feed demo) */
  demo: boolean;
  feed(t: Token, mode: XMode, others: Token[], now: number): Promise<Tweet[]>;
  wallets(tracked: TrackedWallet[], tokens: Token[], now: number): Promise<WalletActivity[]>;
  walletsDemo: boolean;
}
