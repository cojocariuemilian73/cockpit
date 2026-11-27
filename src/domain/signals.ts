// Cele trei răspunsuri din centru (contract, tracțiune, X), filtrele și lecțiile. Funcții pure.

import type { Check, Rule, Token, Trade, Tweet } from "./types";
import type { RiskView } from "./risk";
import { evaluateToken, fmtUsd } from "./rules";
import { markToMarket } from "../execution/executor";

// ---------- siguranța contractului ----------

export interface Verdict { level: "curat" | "atentie" | "pericol"; label: string; reason: string }

export function contractVerdict(t: Token, checks: Check[], risk: RiskView): Verdict {
  const fail = checks.find((c) => c.status === "fail");
  if (t.flags.mintRenounced === false) return { level: "pericol", label: "Pericol", reason: "mint activ: se pot tipări tokenuri noi" };
  if (t.flags.freezeRenounced === false) return { level: "pericol", label: "Pericol", reason: "freeze activ: soldul poate fi înghețat" };
  if (fail) return { level: "pericol", label: "Pericol", reason: `${fail.label.toLowerCase()} (${fail.actual})` };
  if (risk.score >= 7) return { level: "pericol", label: "Pericol", reason: risk.reasons[0] ?? `risc ${risk.score}/10` };
  const doubt = checks.find((c) => c.status === "unknown" || c.status === "warn");
  if (doubt) return { level: "atentie", label: "Atenție", reason: `${doubt.label.toLowerCase()}: ${doubt.actual}` };
  if (risk.score >= 4) return { level: "atentie", label: "Atenție", reason: risk.reasons[0] ?? `risc ${risk.score}/10` };
  return { level: "curat", label: "Curat", reason: "mint și freeze renunțate, reguli trecute" };
}

// ---------- tracțiunea (5 minute) ----------

export interface Traction { buys: number; sells: number; buyShare: number | null; label: string; tone: "pos" | "neg" | "neutral" }

export function traction(t: Token): Traction {
  const x = t.txns5m;
  if (!x) return { buys: 0, sells: 0, buyShare: null, label: "Date lipsă", tone: "neutral" };
  const n = x.buys + x.sells;
  if (n < 10) return { buys: x.buys, sells: x.sells, buyShare: n ? x.buys / n : null, label: "Activitate slabă", tone: "neutral" };
  const share = x.buys / n;
  if (share >= 0.6) return { buys: x.buys, sells: x.sells, buyShare: share, label: "Cumpărătorii domină", tone: "pos" };
  if (share <= 0.4) return { buys: x.buys, sells: x.sells, buyShare: share, label: "Vânzătorii domină", tone: "neg" };
  return { buys: x.buys, sells: x.sells, buyShare: share, label: "Echilibru", tone: "neutral" };
}

// ---------- semnalul X ----------

export interface XSignal { label: "Puternic" | "Moderat" | "Slab" | "Liniște"; mentions: number; kols: number; demo: boolean }

const mentions = (tw: Tweet, t: Token) => tw.ca === t.ca || tw.text.toUpperCase().includes(`$${t.symbol.toUpperCase()}`);

/** Mențiuni în ultimele 60 de minute. KOL-urile cântăresc dublu. Un feed demo e marcat ca atare. */
export function xSignal(tweets: Tweet[], t: Token, now: number): XSignal {
  const recent = tweets.filter((tw) => mentions(tw, t) && now - tw.ts <= 60 * 60_000);
  const kols = recent.filter((tw) => tw.author.kol).length;
  const score = recent.length + kols;
  const label = score >= 6 ? "Puternic" : score >= 3 ? "Moderat" : score >= 1 ? "Slab" : "Liniște";
  return { label, mentions: recent.length, kols, demo: tweets.some((tw) => tw.demo) };
}

export function filterTweets(tweets: Tweet[], query: string): Tweet[] {
  const q = query.trim().toLowerCase();
  if (!q) return tweets;
  return tweets.filter((tw) => `${tw.text} ${tw.author.handle} ${tw.author.name}`.toLowerCase().includes(q));
}

// ---------- filtrele din radar ----------

export type RadarFilter = "noMint" | "lpBurned" | "top10" | "hasX";

/** Un filtru trece doar dacă valoarea e știută și bună. Necunoscutul nu trece. */
export function passesFilter(t: Token, f: RadarFilter): boolean {
  switch (f) {
    case "noMint": return t.flags.mintRenounced === true;
    case "lpBurned": return t.flags.lpBurned === true;
    case "top10": return t.metrics.top10Pct !== undefined && t.metrics.top10Pct < 20;
    case "hasX": return !!t.socials?.x;
  }
}

export interface RadarView { shown: Token[]; hiddenByRules: number; total: number }

export function filterTokens(list: Token[], filters: RadarFilter[], rules: Rule[], hideBlocked: boolean): RadarView {
  const visible = list.filter((t) => filters.every((f) => passesFilter(t, f)));
  const blocked = new Set(visible.filter((t) => evaluateToken(t, rules).some((c) => c.status === "fail")).map((t) => t.id));
  const shown = hideBlocked ? visible.filter((t) => !blocked.has(t.id)) : visible;
  return { shown, hiddenByRules: blocked.size, total: list.length };
}

// ---------- Istoric & Lecții ----------

interface Bucket { n: number; wins: number; pnl: number }
export interface Lessons {
  realizedUsd: number;
  unrealizedUsd: number;
  closed: number;
  winRate: number | null;
  spike: Bucket;
  normal: Bucket;
  brakeHits: number;
  note: string;
}

export function lessons(trades: Trade[], priceOf: (tokenId: string) => number | undefined, brakeHits: number): Lessons {
  const closed = trades.filter((t) => t.closedAt !== undefined);
  const open = trades.filter((t) => t.closedAt === undefined);
  const bucket = (m: Trade["entryMove"]): Bucket => {
    const xs = closed.filter((t) => t.entryMove === m);
    return { n: xs.length, wins: xs.filter((t) => (t.pnlUsd ?? 0) > 0).length, pnl: xs.reduce((s, t) => s + (t.pnlUsd ?? 0), 0) };
  };
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
  const spike = bucket("spike");
  const normal = bucket("normal");
  let note = "Încă nu sunt destule trade-uri închise pentru o lecție.";
  if (closed.length >= 3) {
    const sr = spike.n ? spike.wins / spike.n : null;
    const nr = normal.n ? normal.wins / normal.n : null;
    if (sr !== null && nr !== null && sr < nr) note = `Intrările pe spike câștigă mai rar (${Math.round(sr * 100)}%) decât cele pe tracțiune normală (${Math.round(nr * 100)}%).`;
    else if (sr !== null && spike.pnl < 0) note = `Intrările pe spike au pierdut ${fmtUsd(Math.abs(spike.pnl))} în total.`;
    else note = `Win-rate ${Math.round((wins / closed.length) * 100)}% pe ${closed.length} trade-uri. Sub 50 de cazuri diferențele pot fi întâmplătoare.`;
  }
  return {
    realizedUsd: closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0),
    unrealizedUsd: open.reduce((s, t) => s + markToMarket(t, priceOf(t.tokenId) ?? t.entryPrice), 0),
    closed: closed.length,
    winRate: closed.length ? wins / closed.length : null,
    spike, normal, brakeHits, note,
  };
}
