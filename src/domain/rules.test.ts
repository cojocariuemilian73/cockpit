import { describe, expect, it } from "vitest";
import { evaluateSession, evaluateToken } from "./rules";
import { DEFAULT_RULES } from "./defaults";
import type { Trade } from "./types";
import { applyExitPlan } from "../execution/executor";
import { DAY, NOW, closedTrade, goodToken, openTrade } from "./fixtures";

describe("reguli", () => {
  it("un câmp lipsă nu trece niciodată", () => {
    const t = { ...goodToken, metrics: { ...goodToken.metrics, holders: undefined } };
    expect(evaluateToken(t, DEFAULT_RULES).find((c) => c.ruleId === "m-holders")?.status).toBe("unknown");
  });

  it("două pierderi la rând pornesc cooldown-ul, care expiră", () => {
    const trades = [closedTrade(NOW - 120_000, -10), closedTrade(NOW - 60_000, -10)];
    expect(evaluateSession(DEFAULT_RULES, trades, 2000, DAY, NOW).state).toBe("cooldown");
    expect(evaluateSession(DEFAULT_RULES, trades, 2000, DAY, NOW + 31 * 60_000).state).toBe("active");
  });

  it("capitalul 0 nu produce NaN în riscul zilei", () => {
    expect(evaluateSession(DEFAULT_RULES, [closedTrade(NOW, -10)], 0, DAY, NOW).riskUsedPct).toBe(0);
  });
});

describe("plan de ieșire", () => {
  const open = (): Trade => openTrade({ auto2x: false });
  it("TP parțial, apoi trailing din vârf", () => {
    let t = applyExitPlan(open(), 1.9, NOW);
    expect(t.tpHit).toBe(true);
    expect(t.remainingQty).toBeCloseTo(25);
    t = applyExitPlan(t, 3, NOW);
    t = applyExitPlan(t, 2.5, NOW); // −16,7% din vârf > trailing 15%
    expect(t.exitReason).toBe("trailing");
    expect(t.pnlUsd!).toBeGreaterThan(0);
  });
  it("stop loss la −20%", () => {
    expect(applyExitPlan(open(), 0.79, NOW).exitReason).toBe("sl");
  });
  it("un preț invalid nu închide și nu strică poziția", () => {
    expect(applyExitPlan(open(), NaN, NOW)).toEqual(open());
    expect(applyExitPlan(open(), 0, NOW)).toEqual(open());
  });
});
