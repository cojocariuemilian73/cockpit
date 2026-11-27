// Schema de date. Tot ce e aici e serializabil (localStorage acum, Postgres/Supabase mai târziu).

export type Metric =
  | "liquidityUsd"
  | "mcapUsd"
  | "ageMin"
  | "holders"
  | "top10Pct"
  | "devHoldPct"
  | "bundlePct"
  | "buyRatioPct";

export type Flag = "mintRenounced" | "freezeRenounced" | "lpBurned";

/** Un token așa cum îl vede cockpitul, indiferent de sursă (mock, GMGN, Birdeye, botul propriu). */
export type Chain = "solana" | "base" | "bsc";

export interface Token {
  id: string;
  ca: string;
  chain: Chain;
  symbol: string;
  name: string;
  priceUsd: number;
  change1hPct: number;
  /** Lipsa unei valori = necunoscut. Un câmp absent nu trece niciodată o verificare. */
  metrics: Partial<Record<Metric, number>>;
  flags: Partial<Record<Flag, boolean>>;
  source: "mock" | "live";
  updatedAt: number;
  pairAddress?: string;
  dex?: string;
  imageUrl?: string;
  volume1hUsd?: number;
  /** distribuția deținătorilor, în procente din supply */
  holdersDist?: { top10: number; r11_20: number; r21_40: number; rest: number };
  change5mPct?: number;
  socials?: { x?: string; telegram?: string; web?: string };
  /** raportul RugCheck (doar Solana) */
  rug?: { score: number; lpLockedPct?: number; risks: { name: string; level: string }[]; top10High: boolean };
}

export interface Tweet {
  id: string;
  author: { name: string; handle: string; verified: boolean; avatarSeed: string; kol: boolean };
  text: string;
  ts: number;
  views: number;
  likes: number;
  /** contractul menționat în text, dacă există */
  ca?: string;
  chain?: Chain;
  demo: boolean;
}

export interface TrackedWallet { address: string; label: string; addedAt: number }

export interface WalletActivity { id: string; wallet: string; label: string; side: "buy" | "sell"; token: Token; usd: number; ts: number; demo: boolean }

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface TapeTrade { id: string; ts: number; side: "buy" | "sell"; usd: number; priceUsd: number; wallet: string }

// ---------- Reguli ----------

/** block = buton blocat; warn = cere confirmare explicită, care rămâne scrisă pe trade. */
export type Severity = "block" | "warn";

interface RuleBase {
  id: string;
  enabled: boolean;
}

export interface MetricRule extends RuleBase {
  kind: "metric";
  metric: Metric;
  op: "min" | "max";
  value: number;
  severity: Severity;
}

export interface FlagRule extends RuleBase {
  kind: "flag";
  flag: Flag;
  severity: Severity;
}

export type SessionRuleType =
  | "maxTradesPerDay"
  | "maxDailyRiskPct"
  | "cooldownAfterLosses"
  | "maxPositionPct"
  | "noSizeUpAfterLoss"
  | "minThesisWords";

export interface SessionRule extends RuleBase {
  kind: "session";
  type: SessionRuleType;
  value: number;
  /** doar pentru cooldownAfterLosses: durata în minute */
  minutes?: number;
}

export interface ExitRule extends RuleBase {
  kind: "exit";
  tpPct: number;
  slPct: number;
  /** cât se vinde la TP; restul rămâne cu stop mutat la intrare */
  partialPct: number;
  maxHoldMin: number;
  /** după TP, restul iese la o scădere de atâtea procente din vârf; 0 = stop la intrare */
  trailPct: number;
}

export type Rule = MetricRule | FlagRule | SessionRule | ExitRule;

export interface Idea {
  id: string;
  text: string;
  createdAt: number;
}

// ---------- Trade + teză ----------

export type ThesisTag = "narativă" | "momentum" | "smart money" | "revenire" | "altceva";

export interface Thesis {
  text: string;
  tag: ThesisTag;
}

export type ExitReason = "tp" | "sl" | "breakeven" | "trailing" | "timp" | "manual";

export interface ExecConfig {
  /** comisionul platformei, transparent (monetizare); 0 în MVP */
  platformFeeBps: number;
  slippageBps: number;
  /** taxa de prioritate pe tranzacție, în $ (convertită din SOL la intrare) */
  priorityFeeUsd: number;
}

export interface Settings {
  slippageBps: number;
  priorityFeeSol: number;
  sizePresetsPct: number[];
  notifications: boolean;
  /** ordinele limită expiră după atâtea minute */
  orderTtlMin: number;
}

export interface LimitOrder {
  id: string;
  tokenId: string;
  symbol: string;
  triggerPrice: number;
  sizeUsd: number;
  thesis: Thesis;
  acceptedWarnings: boolean;
  createdAt: number;
  expiresAt: number;
  status: "open" | "filled" | "cancelled" | "expired";
  note?: string;
}

export interface PriceAlert {
  id: string;
  tokenId: string;
  symbol: string;
  op: "above" | "below";
  price: number;
  createdAt: number;
  firedAt?: number;
}

export interface Trade {
  id: string;
  day: string; // AAAA-LL-ZZ, ziua sesiunii
  tokenId: string;
  symbol: string;
  ca: string;
  sizeUsd: number;
  feeUsd: number;
  entryPrice: number;
  qty: number;
  remainingQty: number;
  realizedUsd: number;
  tpPct: number;
  slPct: number;
  partialPct: number;
  maxHoldMin: number;
  tpHit: boolean;
  trailPct: number;
  peakPrice: number;
  exec: ExecConfig;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  exitReason?: ExitReason;
  pnlUsd?: number;
  thesis: Thesis;
  /** instantaneul verificărilor la intrare: baza statisticilor Pro (ce reguli încalci, ce teze câștigă) */
  checksAtEntry: Check[];
  acceptedWarnings: boolean;
  mode: "paper" | "live";
}

// ---------- Rezultatul evaluării ----------

export type Status = "pass" | "warn" | "fail" | "unknown";

export interface Check {
  ruleId: string;
  label: string;
  status: Status;
  actual: string;
  severity: Severity;
}

export type SessionState = "active" | "cooldown" | "limit";

export interface SessionView {
  state: SessionState;
  reason?: string;
  tradesUsed: number;
  tradesMax: number | null;
  riskUsedPct: number;
  riskMaxPct: number | null;
  cooldownUntil?: number;
  lossStreak: number;
  maxPositionUsd: number | null;
  /** plafonul impus de „nu mări miza după pierdere” */
  sizeCapAfterLossUsd: number | null;
  minThesisWords: number;
  exit: ExitRule;
}

export interface BuyGate {
  allowed: boolean;
  /** de ce nu se poate apăsa, în limbaj simplu */
  blockers: string[];
  /** atenționări care cer bifă */
  warnings: string[];
  needsAck: boolean;
}
