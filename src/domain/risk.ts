// Scorul de risc 1–10 și frâna anti-FOMO. Funcții pure, peste verificările regulilor.

import type { Check, Token } from "./types";

export interface RiskView {
  /** 1 = curat, 10 = foarte riscant */
  score: number;
  level: "scăzut" | "mediu" | "ridicat";
  reasons: string[];
}

export interface FomoBrake {
  active: boolean;
  /** cât trebuie ținut butonul apăsat, în ms */
  holdMs: number;
  reasons: string[];
}

export const FOMO_PUMP_5M_PCT = 200;
export const FOMO_RISK_SCORE = 7;

export function riskScore(t: Token, checks: Check[]): RiskView {
  let pts = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { pts += n; reasons.push(why); };

  const fails = checks.filter((c) => c.status === "fail");
  const unknown = checks.filter((c) => c.status === "unknown");
  if (fails.length) add(Math.min(4, fails.length * 1.5), `${fails.length} ${fails.length === 1 ? "regulă critică încălcată" : "reguli critice încălcate"}`);
  if (unknown.length >= 3) add(1, `${unknown.length} verificări fără date`);

  const liq = t.metrics.liquidityUsd;
  if (liq !== undefined && liq < 20_000) add(2, "lichiditate sub 20k$");
  const age = t.metrics.ageMin;
  if (age !== undefined && age < 15) add(1.5, "pool mai nou de 15 min");
  const top10 = t.metrics.top10Pct;
  if ((top10 !== undefined && top10 > 40) || t.rug?.top10High) add(1.5, "deținători concentrați");
  if (t.flags.mintRenounced === false) add(2, "mint activ");
  if (t.flags.freezeRenounced === false) add(1.5, "freeze activ");
  if (t.rug && t.rug.score >= 7) add(1.5, `RugCheck ${t.rug.score}/10`);
  const m5 = t.change5mPct ?? 0;
  if (m5 > 100) add(1.5, `+${Math.round(m5)}% în 5 min`);
  const h1 = t.change1hPct;
  if (h1 > 300) add(1, `+${Math.round(h1)}% într-o oră`);

  const score = Math.max(1, Math.min(10, Math.round(1 + pts)));
  return { score, level: score >= 7 ? "ridicat" : score >= 4 ? "mediu" : "scăzut", reasons };
}

/** Frâna anti-FOMO: pompare bruscă sau risc mare → confirmare de 2 s cu motivul pe ecran. */
export function fomoBrake(t: Token, risk: RiskView): FomoBrake {
  const reasons: string[] = [];
  const m5 = t.change5mPct ?? 0;
  if (m5 > FOMO_PUMP_5M_PCT) reasons.push(`A crescut ${Math.round(m5)}% în ultimele 5 minute. De obicei aici intră ultimii.`);
  if (risk.score >= FOMO_RISK_SCORE) reasons.push(`Scor de risc ${risk.score}/10: ${risk.reasons.slice(0, 2).join(", ")}.`);
  return { active: reasons.length > 0, holdMs: reasons.length ? 2000 : 1000, reasons };
}
