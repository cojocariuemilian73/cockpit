// Execuția. Prototipul rulează doar pe hârtie, dar cu costurile reale ale unei execuții:
// alunecare, taxă de prioritate, comisionul platformei. Un executor live (cotație Jupiter,
// tranzacție semnată în portofelul utilizatorului; cheia nu ajunge niciodată la noi)
// se pune în locul funcțiilor de mai jos, fără să se schimbe UI-ul sau motorul de reguli.

import type { ExecConfig, Trade } from "../domain/types";

export const DEFAULT_EXEC: ExecConfig = { platformFeeBps: 0, slippageBps: 100, priorityFeeUsd: 0.15 };

export interface Fill { price: number; qty: number; feeUsd: number }

export function paperBuy(priceUsd: number, sizeUsd: number, cfg: ExecConfig): Fill {
  const feeUsd = (sizeUsd * cfg.platformFeeBps) / 10_000 + cfg.priorityFeeUsd;
  const price = priceUsd * (1 + cfg.slippageBps / 10_000);
  return { price, qty: Math.max(0, sizeUsd - feeUsd) / price, feeUsd };
}

/** încasarea netă pentru o cantitate vândută la prețul dat */
function proceeds(qty: number, priceUsd: number, cfg: ExecConfig): number {
  const gross = qty * priceUsd * (1 - cfg.slippageBps / 10_000);
  return gross - (gross * cfg.platformFeeBps) / 10_000 - cfg.priorityFeeUsd;
}

/** Vinde o parte din poziție. pct = 100 închide trade-ul. */
export function sellPart(t: Trade, priceUsd: number, now: number, pct: number, reason: Trade["exitReason"] = "manual"): Trade {
  if (t.closedAt !== undefined) return t;
  if (pct >= 100) return closeTrade(t, priceUsd, now, reason);
  const q = t.remainingQty * (pct / 100);
  return { ...t, remainingQty: t.remainingQty - q, realizedUsd: t.realizedUsd + proceeds(q, priceUsd, t.exec), feeUsd: t.feeUsd + t.exec.priorityFeeUsd };
}

export function closeTrade(t: Trade, priceUsd: number, now: number, reason: Trade["exitReason"]): Trade {
  const realized = t.realizedUsd + proceeds(t.remainingQty, priceUsd, t.exec);
  return {
    ...t, remainingQty: 0, realizedUsd: realized, exitPrice: priceUsd, closedAt: now,
    exitReason: reason, pnlUsd: realized - t.sizeUsd, feeUsd: t.feeUsd + t.exec.priorityFeeUsd,
  };
}

/** Prețul la care se declanșează stopul acum (stop inițial, apoi intrare sau trailing după TP). */
export function stopPrice(t: Trade): number {
  if (!t.tpHit) return t.entryPrice * (1 - t.slPct / 100);
  if (t.trailPct > 0) return Math.max(t.entryPrice, t.peakPrice * (1 - t.trailPct / 100));
  return t.entryPrice;
}

export function tpPrice(t: Trade): number {
  return t.entryPrice * (1 + t.tpPct / 100);
}

/** Aplică planul de ieșire la prețul curent. */
export function applyExitPlan(t: Trade, priceUsd: number, now: number): Trade {
  if (t.closedAt !== undefined) return t;
  let next: Trade = priceUsd > t.peakPrice ? { ...t, peakPrice: priceUsd } : t;

  if (!next.tpHit && priceUsd >= tpPrice(next)) {
    next = { ...sellPart(next, priceUsd, now, next.partialPct, "tp"), tpHit: true };
    if (next.closedAt !== undefined || next.remainingQty <= 1e-12) return next.closedAt ? next : closeTrade(next, priceUsd, now, "tp");
  }
  if (priceUsd <= stopPrice(next)) {
    const reason = !next.tpHit ? "sl" : next.trailPct > 0 && stopPrice(next) > next.entryPrice ? "trailing" : "breakeven";
    return closeTrade(next, priceUsd, now, reason);
  }
  if (now - next.openedAt >= next.maxHoldMin * 60_000) return closeTrade(next, priceUsd, now, "timp");
  return next;
}

export function markToMarket(t: Trade, priceUsd: number): number {
  if (t.closedAt !== undefined) return t.pnlUsd ?? 0;
  return t.realizedUsd + Math.max(0, proceeds(t.remainingQty, priceUsd, t.exec)) - t.sizeUsd;
}
