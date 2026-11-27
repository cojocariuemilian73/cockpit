// Date fixe pentru teste. Nu e importat de aplicație.

import type { Token, Trade } from "./types";

export const DAY = "2026-11-27";
export const NOW = new Date("2026-11-27T12:00:00").getTime();

export const goodToken: Token = {
  id: "a", ca: "a", chain: "solana", symbol: "A", name: "A", priceUsd: 1, change1hPct: 2, change5mPct: 1, source: "mock", updatedAt: NOW,
  metrics: { liquidityUsd: 150_000, mcapUsd: 1e6, ageMin: 400, holders: 3000, top10Pct: 18, devHoldPct: 0, bundlePct: 2, buyRatioPct: 55 },
  flags: { mintRenounced: true, freezeRenounced: true, lpBurned: true },
  txns5m: { buys: 70, sells: 30 },
};

export function openTrade(p: Partial<Trade> = {}): Trade {
  return {
    id: "t", day: DAY, tokenId: "a", symbol: "A", ca: "a", sizeUsd: 50, feeUsd: 0, entryPrice: 1, qty: 50, remainingQty: 50,
    realizedUsd: 0, tpPct: 80, slPct: 20, partialPct: 50, maxHoldMin: 240, tpHit: false, trailPct: 15, peakPrice: 1,
    exec: { platformFeeBps: 0, slippageBps: 0, priorityFeeUsd: 0 }, openedAt: NOW, thesis: { text: "x", tag: "momentum" },
    checksAtEntry: [], acceptedWarnings: false, mode: "paper", auto2x: true, entryMove: "normal", brakeReasons: [], ...p,
  };
}

export function closedTrade(closedAt: number, pnlUsd: number, p: Partial<Trade> = {}): Trade {
  return openTrade({ id: String(closedAt), openedAt: closedAt - 1000, closedAt, remainingQty: 0, realizedUsd: 50 + pnlUsd, pnlUsd, exitReason: pnlUsd < 0 ? "sl" : "tp", ...p });
}
