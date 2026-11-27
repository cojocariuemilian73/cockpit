// Execuția pe hârtie, cu costurile unei execuții reale: alunecare (cost maxim acceptat), taxă de prioritate,
// comisionul platformei. Un executor live (cotație Jupiter, semnătură în portofelul utilizatorului; cheia nu
// ajunge niciodată la noi) se pune în locul funcțiilor de mai jos, fără să se schimbe UI-ul sau motorul.

import type { ExecConfig, Trade } from "../domain/types";

/** Sub atâta din cantitatea inițială, restul unei poziții se închide (praf). */
export const DUST = 1e-6;

export interface Quote {
  sizeUsd: number;
  /** taxa de prioritate */
  feeUsd: number;
  /** comisionul platformei */
  commissionUsd: number;
  /** ce intră efectiv în swap */
  netUsd: number;
  /** cât mută ordinul prețul într-un pool x·y=k; null când lichiditatea nu e cunoscută */
  impactPct: number | null;
  fillPrice: number;
  qty: number;
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Cotația de cumpărare: o singură sursă pentru linia de previzualizare și pentru execuție. */
export function quoteBuy(priceUsd: number, sizeUsd: number, cfg: ExecConfig, liquidityUsd?: number): Quote {
  const size = Math.max(0, finite(sizeUsd));
  const commissionUsd = (size * cfg.platformFeeBps) / 10_000;
  const feeUsd = Math.min(size, cfg.priorityFeeUsd);
  const netUsd = Math.max(0, size - feeUsd - commissionUsd);
  const reserve = liquidityUsd !== undefined && liquidityUsd > 0 ? liquidityUsd / 2 : null;
  const impactPct = reserve === null ? null : (netUsd / (reserve + netUsd)) * 100;
  const fillPrice = priceUsd > 0 ? priceUsd * (1 + cfg.slippageBps / 10_000) : 0;
  return { sizeUsd: size, feeUsd, commissionUsd, netUsd, impactPct, fillPrice, qty: fillPrice > 0 ? netUsd / fillPrice : 0 };
}

/** încasarea netă pentru o cantitate vândută la prețul dat; niciodată negativă */
function proceeds(qty: number, priceUsd: number, cfg: ExecConfig): number {
  const gross = qty * Math.max(0, priceUsd) * (1 - cfg.slippageBps / 10_000);
  return Math.max(0, gross - (gross * cfg.platformFeeBps) / 10_000 - cfg.priorityFeeUsd);
}

/** Vinde o parte din poziție. Procentul se limitează la [0, 100]; restul de praf se închide. */
export function sellPart(t: Trade, priceUsd: number, now: number, pct: number, reason: Trade["exitReason"] = "manual"): Trade {
  if (t.closedAt !== undefined || !Number.isFinite(pct) || pct <= 0) return t;
  if (pct >= 100) return closeTrade(t, priceUsd, now, reason);
  const q = t.remainingQty * (pct / 100);
  const next = { ...t, remainingQty: t.remainingQty - q, realizedUsd: t.realizedUsd + proceeds(q, priceUsd, t.exec), feeUsd: t.feeUsd + t.exec.priorityFeeUsd };
  return next.remainingQty <= t.qty * DUST ? closeTrade(next, priceUsd, now, reason) : next;
}

export function closeTrade(t: Trade, priceUsd: number, now: number, reason: Trade["exitReason"]): Trade {
  const realized = t.realizedUsd + (t.remainingQty > 0 ? proceeds(t.remainingQty, priceUsd, t.exec) : 0);
  return {
    ...t, remainingQty: 0, realizedUsd: realized, exitPrice: priceUsd, closedAt: now,
    exitReason: reason, pnlUsd: realized - t.sizeUsd, feeUsd: t.feeUsd + (t.remainingQty > 0 ? t.exec.priorityFeeUsd : 0),
  };
}

/** Prețul la care se declanșează stopul acum: stop inițial, apoi intrare (după TP sau 2x) sau trailing din vârf. */
export function stopPrice(t: Trade): number {
  if (!t.tpHit && !t.recovered) return t.entryPrice * (1 - t.slPct / 100);
  if (t.tpHit && t.trailPct > 0) return Math.max(t.entryPrice, t.peakPrice * (1 - t.trailPct / 100));
  return t.entryPrice;
}

export function tpPrice(t: Trade): number {
  return t.entryPrice * (1 + t.tpPct / 100);
}

/** Aplică planul de ieșire la prețul curent: 2x Auto-Breakeven, TP parțial, stop/trailing, timp. */
export function applyExitPlan(t: Trade, priceUsd: number, now: number): Trade {
  if (t.closedAt !== undefined || !(priceUsd > 0)) return t;
  let next: Trade = priceUsd > t.peakPrice ? { ...t, peakPrice: priceUsd } : t;

  if (next.auto2x && !next.recovered && priceUsd >= 2 * next.entryPrice) {
    const before = next.realizedUsd;
    next = sellPart(next, priceUsd, now, 50, "2x");
    next = { ...next, recovered: { at: now, price: priceUsd, usd: next.realizedUsd - before } };
    if (next.closedAt !== undefined) return next;
  }
  if (!next.tpHit && priceUsd >= tpPrice(next)) {
    next = { ...sellPart(next, priceUsd, now, next.partialPct, "tp"), tpHit: true };
    if (next.closedAt !== undefined) return next;
  }
  if (priceUsd <= stopPrice(next)) {
    const reason = !next.tpHit && !next.recovered ? "sl" : next.tpHit && next.trailPct > 0 && stopPrice(next) > next.entryPrice ? "trailing" : "breakeven";
    return closeTrade(next, priceUsd, now, reason);
  }
  if (now - next.openedAt >= next.maxHoldMin * 60_000) return closeTrade(next, priceUsd, now, "timp");
  return next;
}

export function markToMarket(t: Trade, priceUsd: number): number {
  if (t.closedAt !== undefined) return t.pnlUsd ?? 0;
  return t.realizedUsd + proceeds(t.remainingQty, priceUsd, t.exec) - t.sizeUsd;
}

/** Valoarea curentă a ce a rămas din poziție. */
export function positionValue(t: Trade, priceUsd: number): number {
  return t.closedAt !== undefined ? 0 : proceeds(t.remainingQty, priceUsd, t.exec);
}

/** Prețul mediu de intrare pe ce e încă deschis pe token, ponderat cu cantitatea rămasă. */
export function avgEntry(trades: Trade[], tokenId: string): number | null {
  let q = 0;
  let cost = 0;
  for (const t of trades) {
    if (t.tokenId !== tokenId || t.closedAt !== undefined) continue;
    q += t.remainingQty;
    cost += t.remainingQty * t.entryPrice;
  }
  return q > 0 ? cost / q : null;
}
