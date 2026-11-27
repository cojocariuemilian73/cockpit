// Frâna asimetrică. O singură funcție pură evaluează cumpărarea și întoarce BrakeDecision; UI-ul doar o afișează,
// reducerul o reevaluează la execuție. Vânzarea nu trece pe aici: ieșirea nu se blochează niciodată.

import type { Check, ExecConfig, Mode, Rule, SessionView, Settings, Token } from "./types";
import { countWords, evaluateToken, fmtDuration, fmtUsd, sizeCeilingUsd } from "./rules";
import { HIGH_RISK_SCORE, riskScore, type RiskView } from "./risk";
import { quoteBuy, type Quote } from "../execution/executor";

export type BrakeSeverity = "none" | "caution" | "high" | "block";
export type BrakeAction = "proceed" | "confirm" | "reduce" | "wait";

export interface BrakeDecision {
  triggered: boolean;
  severity: BrakeSeverity;
  /** fapte observabile, cele mai grave primele */
  reasons: string[];
  recommendedAction: BrakeAction;
  requiresConfirmation: boolean;
  /** prețul la care s-a luat decizia; reconfirmarea se compară cu el */
  snapshotPrice: number;
  /** prețul s-a mișcat peste prag față de previzualizare */
  requote: boolean;
  move: "spike" | "normal";
}

export interface BuyView {
  decision: BrakeDecision;
  checks: Check[];
  risk: RiskView | null;
  quote: Quote;
  /** cea mai mare mărime permisă acum, în $ */
  capUsd: number;
}

export interface BuyInput {
  token: Token | null;
  rules: Rule[];
  session: SessionView;
  bankrollUsd: number;
  cashUsd: number;
  sizeUsd: number;
  thesisText: string;
  exec: ExecConfig;
  settings: Settings;
  mode: Mode;
  now: number;
  consecutiveLosses: number;
  /** câte intrări au fost în fereastra Burst Cadence */
  entriesInWindow: number;
  /** prețul văzut la previzualizare, dacă e o execuție */
  snapshotPrice?: number;
}

const RANK: Record<BrakeSeverity, number> = { none: 0, caution: 1, high: 2, block: 3 };
const IMPACT_HIGH_PCT = 3;
const IMPACT_CAUTION_PCT = 1;

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%`;

export function assessBuy(i: BuyInput): BuyView {
  const found: { level: Exclude<BrakeSeverity, "none">; text: string; wait?: boolean }[] = [];
  const add = (level: Exclude<BrakeSeverity, "none">, text: string, wait = false) => found.push({ level, text, wait });
  const t = i.token;
  const checks = t ? evaluateToken(t, i.rules) : [];
  const risk = t ? riskScore(t, checks) : null;
  const quote = quoteBuy(t?.priceUsd ?? 0, i.sizeUsd, i.exec, t?.metrics.liquidityUsd);
  const capUsd = Math.max(0, Math.min(sizeCeilingUsd(i.session, i.bankrollUsd), i.cashUsd));
  const m5 = t?.change5mPct ?? 0;
  const move = m5 >= i.settings.spikePct ? "spike" : "normal";
  let requote = false;

  // ---- blocaje: butonul nu poate executa
  if (!t) add("block", "Niciun token ales.");
  else if (!(t.priceUsd > 0)) add("block", "Prețul lipsește: nu există cotație.");
  if (i.mode === "live") add("block", "Modul LIVE e doar pregătit (wallet/RPC). Nu există portofel conectat; nimic nu se execută.");
  if (!(i.sizeUsd > 0)) add("block", "Alege o sumă.");
  else if (i.sizeUsd > i.cashUsd + 1e-9) add("block", `Balanța DEMO are ${fmtUsd(i.cashUsd)}; ordinul cere ${fmtUsd(i.sizeUsd)}.`);
  const s = i.session;
  if (s.state === "cooldown" && s.cooldownUntil) add("block", `Cooldown încă ${fmtDuration(s.cooldownUntil - i.now)} după ${s.reason}.`, true);
  if (s.state === "limit") add("block", `Sesiune închisă: ${s.reason}.`, true);
  const sessionCap = sizeCeilingUsd(s, i.bankrollUsd);
  if (i.sizeUsd > sessionCap + 0.005) add("block", `Mărimea depășește plafonul de acum (${fmtUsd(sessionCap)}).`);
  const missing = s.minThesisWords - countWords(i.thesisText);
  if (missing > 0) add("block", `Scrie de ce intri: încă ${missing} ${missing === 1 ? "cuvânt" : "cuvinte"}.`);
  for (const c of checks) if (c.status === "fail") add("block", `${c.label} — are ${c.actual}.`);
  if (quote.impactPct !== null && quote.impactPct > i.exec.slippageBps / 100) {
    add("block", `Impactul estimat ${pct(quote.impactPct)} depășește alunecarea maximă ${(i.exec.slippageBps / 100).toLocaleString("ro-RO")}%: tranzacția reală ar eșua.`);
  }

  // ---- frâna propriu-zisă: cer confirmare explicită
  if (t) {
    if (move === "spike") add("high", `${pct(m5)} în 5 min (pragul de spike e ${i.settings.spikePct}%). De obicei aici intră ultimii.`, true);
    if (risk && risk.score >= HIGH_RISK_SCORE) add("high", `Scor de risc ${risk.score}/10: ${risk.reasons.slice(0, 2).join(", ")}.`);
    if (quote.impactPct !== null && quote.impactPct >= IMPACT_HIGH_PCT) add("high", `Ordinul mută prețul cu ~${pct(quote.impactPct).slice(1)} față de lichiditate.`);
    else if (quote.impactPct !== null && quote.impactPct >= IMPACT_CAUTION_PCT) add("caution", `Impact ~${pct(quote.impactPct).slice(1)} față de lichiditate.`);
    if (quote.impactPct === null) add("caution", "Lichiditatea nu e cunoscută: impactul nu se poate estima.");
    const ageSec = Math.max(0, (i.now - t.updatedAt) / 1000);
    if (ageSec > i.settings.staleSec) add("caution", `Datele au ${Math.round(ageSec)} s (prag ${i.settings.staleSec} s).`);
    if (i.snapshotPrice !== undefined && i.snapshotPrice > 0) {
      const moved = (t.priceUsd / i.snapshotPrice - 1) * 100;
      if (Math.abs(moved) >= i.settings.requotePct) {
        requote = true;
        add("high", `Prețul s-a mișcat ${pct(moved)} de la previzualizare.`, true);
      }
    }
  }
  if (i.consecutiveLosses >= i.settings.tiltLosses) add("high", `${i.consecutiveLosses} pierderi la rând.`);
  if (i.entriesInWindow >= i.settings.burstMax) add("high", `${i.entriesInWindow} intrări în ultimele ${i.settings.burstWindowMin} min.`, true);
  for (const c of checks) {
    if (c.status === "warn") add("caution", `${c.label} — are ${c.actual}.`);
    else if (c.status === "unknown") add("caution", `${c.label} — ${c.actual}.`);
  }

  found.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const severity = (found[0]?.level ?? "none") as BrakeSeverity;
  const recommendedAction: BrakeAction =
    severity === "block" || (severity === "high" && found.some((f) => f.level === "high" && f.wait)) ? "wait"
      : severity === "high" ? "reduce"
        : severity === "caution" ? "confirm" : "proceed";

  return {
    decision: {
      triggered: severity !== "none",
      severity,
      reasons: found.map((f) => f.text),
      recommendedAction,
      requiresConfirmation: severity === "caution" || severity === "high",
      snapshotPrice: t?.priceUsd ?? 0,
      requote,
      move,
    },
    checks, risk, quote, capUsd,
  };
}

/** Sell 100% pe o poziție mare cere o confirmare vizibilă; orice altă vânzare trece direct. */
export function needsSellConfirm(pct: number, valueUsd: number, bankrollUsd: number, bigPositionPct: number): boolean {
  return pct >= 100 && bankrollUsd > 0 && valueUsd >= (bankrollUsd * bigPositionPct) / 100;
}
