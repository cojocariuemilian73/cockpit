// Export / Import JSON cu validare strictă. Un fișier care nu respectă schema e respins întreg: nu se amestecă nimic.

import type { Durable } from "./types";
import { checkInvariants } from "./invariants";

export const SCHEMA = "cockpit.demo";
export const VERSION = 4;

export function exportDurable(d: Durable, now: number): string {
  return JSON.stringify({ schema: SCHEMA, version: VERSION, exportedAt: now, data: d }, null, 2);
}

type V = (v: unknown, path: string) => string | null;

const fail = (path: string, what: string) => `${path}: ${what}`;
const num: V = (v, p) => (typeof v === "number" && Number.isFinite(v) ? null : fail(p, "trebuie să fie un număr finit"));
const str: V = (v, p) => (typeof v === "string" ? null : fail(p, "trebuie să fie text"));
const bool: V = (v, p) => (typeof v === "boolean" ? null : fail(p, "trebuie să fie da/nu"));
const oneOf = (...xs: string[]): V => (v, p) => (typeof v === "string" && xs.includes(v) ? null : fail(p, `trebuie să fie ${xs.join(" / ")}`));
const opt = (f: V): V => (v, p) => (v === undefined ? null : f(v, p));
const nullable = (f: V): V => (v, p) => (v === null ? null : f(v, p));
const arr = (f: V): V => (v, p) => {
  if (!Array.isArray(v)) return fail(p, "trebuie să fie o listă");
  for (let i = 0; i < v.length; i++) { const e = f(v[i], `${p}[${i}]`); if (e) return e; }
  return null;
};
const obj = (shape: Record<string, V>): V => (v, p) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "trebuie să fie un obiect");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in shape)) return fail(`${p}.${k}`, "câmp necunoscut");
  for (const [k, f] of Object.entries(shape)) { const e = f(o[k], `${p}.${k}`); if (e) return e; }
  return null;
};
const record = (f: V): V => (v, p) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(p, "trebuie să fie un obiect");
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const e = f(x, `${p}.${k}`); if (e) return e; }
  return null;
};
const any: V = () => null;

const chain = oneOf("solana", "base", "bsc");
const thesis = obj({ text: str, tag: oneOf("narativă", "momentum", "smart money", "revenire", "altceva") });
const exec = obj({ platformFeeBps: num, slippageBps: num, priorityFeeUsd: num });
const check = obj({ ruleId: str, label: str, status: oneOf("pass", "warn", "fail", "unknown"), actual: str, severity: oneOf("block", "warn") });

const rule: V = (v, p) => {
  const k = (v as { kind?: unknown } | null)?.kind;
  const base = { id: str, enabled: bool };
  if (k === "metric") return obj({ ...base, kind: str, metric: oneOf("liquidityUsd", "mcapUsd", "ageMin", "holders", "top10Pct", "devHoldPct", "bundlePct", "buyRatioPct"), op: oneOf("min", "max"), value: num, severity: oneOf("block", "warn") })(v, p);
  if (k === "flag") return obj({ ...base, kind: str, flag: oneOf("mintRenounced", "freezeRenounced", "lpBurned"), severity: oneOf("block", "warn") })(v, p);
  if (k === "session") return obj({ ...base, kind: str, type: oneOf("maxTradesPerDay", "maxDailyRiskPct", "cooldownAfterLosses", "maxPositionPct", "noSizeUpAfterLoss", "minThesisWords"), value: num, minutes: opt(num) })(v, p);
  if (k === "exit") return obj({ ...base, kind: str, tpPct: num, slPct: num, partialPct: num, maxHoldMin: num, trailPct: num })(v, p);
  return fail(p, "regulă de tip necunoscut");
};

const trade = obj({
  id: str, day: str, tokenId: str, symbol: str, ca: str, sizeUsd: num, feeUsd: num, entryPrice: num, qty: num, remainingQty: num,
  realizedUsd: num, tpPct: num, slPct: num, partialPct: num, maxHoldMin: num, tpHit: bool, trailPct: num, peakPrice: num, exec,
  openedAt: num, closedAt: opt(num), exitPrice: opt(num), exitReason: opt(oneOf("tp", "sl", "breakeven", "trailing", "timp", "manual", "2x")),
  pnlUsd: opt(num), thesis, checksAtEntry: arr(check), acceptedWarnings: bool, mode: oneOf("paper", "live"),
  auto2x: bool, recovered: opt(obj({ at: num, price: num, usd: num })), entryMove: oneOf("spike", "normal"), brakeReasons: arr(str), note: opt(str),
});

const token = obj({
  id: str, ca: str, chain, symbol: str, name: str, priceUsd: num, change1hPct: num, metrics: record(opt(num)), flags: record(opt(bool)),
  source: oneOf("mock", "live"), updatedAt: num, pairAddress: opt(str), dex: opt(str), imageUrl: opt(str), volume1hUsd: opt(num),
  holdersDist: opt(obj({ top10: num, r11_20: num, r21_40: num, rest: num })), change5mPct: opt(num),
  txns5m: opt(obj({ buys: num, sells: num })), socials: opt(record(opt(str))), rug: any,
});

const settings = obj({
  preset: oneOf("turbo", "normal", "safe", "advanced"), slippageBps: num, priorityFeeSol: num, spikePct: num, burstMax: num, burstWindowMin: num,
  tiltLosses: num, staleSec: num, requotePct: num, bigPositionPct: num, liveTick: bool, notifications: bool, orderTtlMin: num,
});

const durable = obj({
  mode: oneOf("demo", "live"), chain, cashUsd: num, bankrollUsd: num, rules: arr(rule),
  ideas: arr(obj({ id: str, text: str, createdAt: num })), trades: arr(trade),
  orders: arr(obj({ id: str, tokenId: str, symbol: str, triggerPrice: num, sizeUsd: num, thesis, acceptedWarnings: bool, createdAt: num, expiresAt: num, status: oneOf("open", "filled", "cancelled", "expired"), note: opt(str) })),
  alerts: arr(obj({ id: str, tokenId: str, symbol: str, op: oneOf("above", "below"), price: num, createdAt: num, firedAt: opt(num) })),
  settings, tokens: arr(token), selectedId: nullable(str), watchlist: arr(str),
  tracked: arr(obj({ address: str, label: str, addedAt: num })), brakeHits: num, tiltHiddenDay: nullable(str),
});

export type ImportResult = { ok: true; data: Durable } | { ok: false; error: string };

export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "Fișierul nu e JSON valid." }; }
  const head = raw as { schema?: unknown; version?: unknown; data?: unknown } | null;
  if (!head || head.schema !== SCHEMA) return { ok: false, error: "Nu e un export Cockpit." };
  if (head.version !== VERSION) return { ok: false, error: `Versiunea ${String(head.version)} nu e suportată (aștept ${VERSION}).` };
  const err = durable(head.data, "data");
  if (err) return { ok: false, error: err };
  const data = head.data as Durable;
  const broken = checkInvariants(data);
  if (broken.length) return { ok: false, error: `Date incoerente: ${broken[0]}.` };
  return { ok: true, data };
}
