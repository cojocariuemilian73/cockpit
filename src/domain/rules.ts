// Motorul de reguli. Funcții pure: (reguli, date, trade-uri, ora) -> starea ecranului.
// Nu ține stare: cooldown-ul și limitele se recalculează mereu din trade-uri, deci
// regulile scrise de utilizator controlează direct ce se vede.

import type {
  BuyGate, Check, ExitRule, Flag, Metric, MetricRule, Rule, SessionRule,
  SessionView, Token, Trade,
} from "./types";

export const METRICS: Record<Metric, { label: string; unit: string; scale: number }> = {
  liquidityUsd: { label: "Lichiditate", unit: "k$", scale: 1000 },
  mcapUsd: { label: "Market cap", unit: "k$", scale: 1000 },
  ageMin: { label: "Vârstă", unit: "min", scale: 1 },
  holders: { label: "Holderi", unit: "", scale: 1 },
  top10Pct: { label: "Top 10 dețin", unit: "%", scale: 1 },
  devHoldPct: { label: "Dev-ul deține", unit: "%", scale: 1 },
  bundlePct: { label: "Bundle la lansare", unit: "%", scale: 1 },
  buyRatioPct: { label: "Cumpărări din volum", unit: "%", scale: 1 },
};

export const FLAGS: Record<Flag, string> = {
  mintRenounced: "Mint renunțat",
  freezeRenounced: "Freeze renunțat",
  lpBurned: "Lichiditate arsă",
};

export function fmtMetric(m: Metric, v: number): string {
  const { unit, scale } = METRICS[m];
  const n = v / scale;
  if (unit === "k$" && n >= 1000) return `${(n / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 2 })} M$`;
  const s = n >= 100 ? Math.round(n).toLocaleString("ro-RO") : n.toLocaleString("ro-RO", { maximumFractionDigits: 1 });
  return unit ? `${s} ${unit}` : s;
}

export function ruleLabel(r: MetricRule): string {
  return `${METRICS[r.metric].label} ${r.op === "min" ? "≥" : "≤"} ${fmtMetric(r.metric, r.value)}`;
}

// ---------- Verificări pe token ----------

export function evaluateToken(token: Token, rules: Rule[]): Check[] {
  const out: Check[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.kind === "metric") {
      const v = token.metrics[r.metric];
      const label = ruleLabel(r);
      if (v === undefined) {
        out.push({ ruleId: r.id, label, status: "unknown", actual: "lipsesc datele", severity: r.severity });
        continue;
      }
      const ok = r.op === "min" ? v >= r.value : v <= r.value;
      out.push({
        ruleId: r.id, label, severity: r.severity, actual: fmtMetric(r.metric, v),
        status: ok ? "pass" : r.severity === "block" ? "fail" : "warn",
      });
    } else if (r.kind === "flag") {
      const v = token.flags[r.flag];
      const label = FLAGS[r.flag];
      if (v === undefined) {
        out.push({ ruleId: r.id, label, status: "unknown", actual: "necunoscut", severity: r.severity });
        continue;
      }
      out.push({
        ruleId: r.id, label, severity: r.severity, actual: v ? "da" : "nu",
        status: v ? "pass" : r.severity === "block" ? "fail" : "warn",
      });
    }
  }
  // ordinea de citire: întâi ce blochează, apoi ce cere atenție, apoi ce trece
  const rank = { fail: 0, unknown: 1, warn: 2, pass: 3 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

// ---------- Sesiune ----------

export const DEFAULT_EXIT: ExitRule = {
  id: "exit", kind: "exit", enabled: true, tpPct: 80, slPct: 20, partialPct: 50, maxHoldMin: 240, trailPct: 15,
};

function sessionRule(rules: Rule[], type: SessionRule["type"]): SessionRule | undefined {
  return rules.find((r): r is SessionRule => r.kind === "session" && r.type === type && r.enabled);
}

/** Riscul unui trade: pierderea realizată dacă e închis, altfel cât poate pierde până la stop. */
export function tradeRiskUsd(t: Trade): number {
  if (t.closedAt !== undefined) return Math.max(0, -(t.pnlUsd ?? 0));
  if (t.tpHit) return 0; // stop la intrare: riscul rămas e ~0
  return t.sizeUsd * (t.slPct / 100);
}

export function evaluateSession(rules: Rule[], trades: Trade[], bankrollUsd: number, day: string, now: number): SessionView {
  const today = trades.filter((t) => t.day === day);
  const closed = today.filter((t) => t.closedAt !== undefined).sort((a, b) => a.closedAt! - b.closedAt!);

  let lossStreak = 0;
  for (let i = closed.length - 1; i >= 0 && (closed[i].pnlUsd ?? 0) < 0; i--) lossStreak++;

  const exit = (rules.find((r): r is ExitRule => r.kind === "exit") ?? DEFAULT_EXIT);
  const maxTrades = sessionRule(rules, "maxTradesPerDay");
  const maxRisk = sessionRule(rules, "maxDailyRiskPct");
  const cooldown = sessionRule(rules, "cooldownAfterLosses");
  const maxPos = sessionRule(rules, "maxPositionPct");
  const noSizeUp = sessionRule(rules, "noSizeUpAfterLoss");
  const minWords = sessionRule(rules, "minThesisWords");

  const riskUsedPct = (today.reduce((s, t) => s + tradeRiskUsd(t), 0) / bankrollUsd) * 100;

  let cooldownUntil: number | undefined;
  if (cooldown && lossStreak >= cooldown.value && closed.length) {
    const until = closed[closed.length - 1].closedAt! + (cooldown.minutes ?? 30) * 60_000;
    if (until > now) cooldownUntil = until;
  }

  const lastClosed = closed[closed.length - 1];
  const sizeCapAfterLossUsd = noSizeUp && lastClosed && (lastClosed.pnlUsd ?? 0) < 0 ? lastClosed.sizeUsd : null;

  const view: SessionView = {
    state: "active",
    tradesUsed: today.length,
    tradesMax: maxTrades ? maxTrades.value : null,
    riskUsedPct,
    riskMaxPct: maxRisk ? maxRisk.value : null,
    cooldownUntil,
    lossStreak,
    maxPositionUsd: maxPos ? (bankrollUsd * maxPos.value) / 100 : null,
    sizeCapAfterLossUsd,
    minThesisWords: minWords ? minWords.value : 0,
    exit,
  };

  if (cooldownUntil) {
    view.state = "cooldown";
    view.reason = `${lossStreak} pierderi la rând`;
  } else if (view.tradesMax !== null && view.tradesUsed >= view.tradesMax) {
    view.state = "limit";
    view.reason = "trade-urile de azi s-au terminat";
  } else if (view.riskMaxPct !== null && riskUsedPct >= view.riskMaxPct - 1e-9) {
    view.state = "limit";
    view.reason = "riscul zilei e consumat";
  }
  return view;
}

/** Cea mai mare mărime permisă acum, din toate limitele care o plafonează. */
export function sizeCeilingUsd(s: SessionView, bankrollUsd: number): number {
  let cap = Infinity;
  if (s.maxPositionUsd !== null) cap = Math.min(cap, s.maxPositionUsd);
  if (s.sizeCapAfterLossUsd !== null) cap = Math.min(cap, s.sizeCapAfterLossUsd);
  if (s.riskMaxPct !== null) {
    const riskLeftUsd = ((s.riskMaxPct - s.riskUsedPct) / 100) * bankrollUsd;
    cap = Math.min(cap, Math.max(0, riskLeftUsd) / (s.exit.slPct / 100));
  }
  return cap;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 1).length;
}

// ---------- Poarta de cumpărare ----------

export function buyGate(args: {
  token: Token | null;
  checks: Check[];
  session: SessionView;
  bankrollUsd: number;
  sizeUsd: number;
  thesisText: string;
  ack: boolean;
  now: number;
}): BuyGate {
  const { token, checks, session, bankrollUsd, sizeUsd, thesisText, ack, now } = args;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!token) blockers.push("Alege un token.");
  if (session.state === "cooldown" && session.cooldownUntil) {
    blockers.push(`Cooldown încă ${fmtDuration(session.cooldownUntil - now)} după ${session.reason}.`);
  }
  if (session.state === "limit") blockers.push(`Sesiune închisă: ${session.reason}.`);

  for (const c of checks) {
    if (c.status === "fail") blockers.push(`${c.label} — are ${c.actual}.`);
    else if (c.status === "warn") warnings.push(`${c.label} — are ${c.actual}.`);
    else if (c.status === "unknown") warnings.push(`${c.label} — ${c.actual}.`);
  }

  const cap = sizeCeilingUsd(session, bankrollUsd);
  if (sizeUsd > cap + 0.005) blockers.push(`Mărimea depășește plafonul de acum (${fmtUsd(cap)}).`);

  const missing = session.minThesisWords - countWords(thesisText);
  if (missing > 0) blockers.push(`Scrie de ce intri: încă ${missing} ${missing === 1 ? "cuvânt" : "cuvinte"}.`);

  const needsAck = warnings.length > 0;
  return { allowed: blockers.length === 0 && (!needsAck || ack), blockers, warnings, needsAck };
}

// ---------- Formatare ----------

export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("ro-RO", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtPct(v: number, signed = true): string {
  const s = Math.abs(v).toLocaleString("ro-RO", { maximumFractionDigits: 1 });
  return signed ? `${v >= 0 ? "+" : "−"}${s}%` : `${s}%`;
}
