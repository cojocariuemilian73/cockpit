// Anti-Tilt și Burst Cadence. Funcții pure peste istoricul de trade-uri.

import type { Settings, Trade } from "./types";

/** Pierderi la rând, din cel mai recent trade închis înapoi. Un câștig resetează la 0; un rezultat 0 nu schimbă nimic. */
export function consecutiveLosses(trades: Trade[]): number {
  const closed = trades.filter((t) => t.closedAt !== undefined).sort((a, b) => a.closedAt! - b.closedAt!);
  let n = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const pnl = closed[i].pnlUsd ?? 0;
    if (pnl > 0) break;
    if (pnl < 0) n++;
  }
  return n;
}

/** Câte intrări s-au deschis în ultimele `windowMin` minute. */
export function entriesInWindow(trades: Trade[], now: number, windowMin: number): number {
  const from = now - windowMin * 60_000;
  return trades.filter((t) => t.openedAt > from && t.openedAt <= now).length;
}

export interface TiltView {
  active: boolean;
  reasons: string[];
  consecutiveLosses: number;
  entriesInWindow: number;
}

/** Bannerul calm: apare la ≥ N pierderi la rând sau la un ritm prea rapid, dacă nu a fost ascuns azi. */
export function antiTilt(trades: Trade[], now: number, s: Settings, hiddenDay: string | null, day: string): TiltView {
  const losses = consecutiveLosses(trades);
  const entries = entriesInWindow(trades, now, s.burstWindowMin);
  const reasons: string[] = [];
  if (losses >= s.tiltLosses) reasons.push(`${losses} pierderi la rând`);
  if (entries >= s.burstMax) reasons.push(`${entries} intrări în ${s.burstWindowMin} min`);
  return { active: reasons.length > 0 && hiddenDay !== day, reasons, consecutiveLosses: losses, entriesInWindow: entries };
}
