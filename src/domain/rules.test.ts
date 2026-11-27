import { describe, expect, it } from "vitest";
import { buyGate, evaluateSession, evaluateToken } from "./rules";
import { DEFAULT_RULES } from "./defaults";
import type { Token, Trade } from "./types";
import { applyExitPlan } from "../execution/executor";

const day = "2026-11-27";
const now = new Date("2026-11-27T12:00:00").getTime();
const good: Token = {
  id: "a", ca: "a", chain: "solana", symbol: "A", name: "A", priceUsd: 1, change1hPct: 0, source: "mock", updatedAt: now,
  metrics: { liquidityUsd: 100_000, mcapUsd: 1e6, ageMin: 100, holders: 1000, top10Pct: 20, devHoldPct: 0, bundlePct: 2, buyRatioPct: 60 },
  flags: { mintRenounced: true, freezeRenounced: true, lpBurned: true },
};
const loss = (closedAt: number, sizeUsd = 50): Trade => ({
  id: String(closedAt), day, tokenId: "a", symbol: "A", ca: "a", sizeUsd, feeUsd: 0, entryPrice: 1, qty: 50, remainingQty: 0,
  realizedUsd: 40, tpPct: 80, slPct: 20, partialPct: 50, maxHoldMin: 240, tpHit: false, trailPct: 15, peakPrice: 1, exec: { platformFeeBps: 0, slippageBps: 0, priorityFeeUsd: 0 }, openedAt: closedAt - 1000,
  closedAt, exitReason: "sl", pnlUsd: -10, thesis: { text: "x", tag: "momentum" }, checksAtEntry: [], acceptedWarnings: false, mode: "paper",
});

describe("reguli", () => {
  it("un câmp lipsă nu trece niciodată", () => {
    const t = { ...good, metrics: { ...good.metrics, holders: undefined } };
    expect(evaluateToken(t, DEFAULT_RULES).find((c) => c.ruleId === "m-holders")?.status).toBe("unknown");
  });

  it("două pierderi la rând pornesc cooldown-ul, care expiră", () => {
    const trades = [loss(now - 120_000), loss(now - 60_000)];
    expect(evaluateSession(DEFAULT_RULES, trades, 2000, day, now).state).toBe("cooldown");
    expect(evaluateSession(DEFAULT_RULES, trades, 2000, day, now + 31 * 60_000).state).toBe("active");
  });

  it("după pierdere mărimea e plafonată la ultima miză", () => {
    const s = evaluateSession(DEFAULT_RULES, [loss(now - 60_000, 20)], 2000, day, now);
    const g = buyGate({ token: good, checks: evaluateToken(good, DEFAULT_RULES), session: s, bankrollUsd: 2000, sizeUsd: 50, thesisText: "unu doi trei patru cinci", ack: false, now });
    expect(g.allowed).toBe(false);
  });

  it("teza scurtă blochează, teza completă deblochează", () => {
    const s = evaluateSession(DEFAULT_RULES, [], 2000, day, now);
    const base = { token: good, checks: evaluateToken(good, DEFAULT_RULES), session: s, bankrollUsd: 2000, sizeUsd: 50, ack: false, now };
    expect(buyGate({ ...base, thesisText: "pump" }).allowed).toBe(false);
    expect(buyGate({ ...base, thesisText: "a supraviețuit migrării și lichiditatea crește" }).allowed).toBe(true);
  });
});

describe("plan de ieșire", () => {
  const open = (): Trade => ({ ...loss(0), closedAt: undefined, exitReason: undefined, pnlUsd: undefined, qty: 50, remainingQty: 50, realizedUsd: 0, openedAt: now });
  it("TP parțial, apoi trailing din vârf", () => {
    let t = applyExitPlan(open(), 1.9, now);
    expect(t.tpHit).toBe(true);
    expect(t.remainingQty).toBeCloseTo(25);
    t = applyExitPlan(t, 3, now);
    t = applyExitPlan(t, 2.5, now); // −16,7% din vârf > trailing 15%
    expect(t.exitReason).toBe("trailing");
    expect(t.pnlUsd!).toBeGreaterThan(0);
  });
  it("stop loss la −20%", () => {
    expect(applyExitPlan(open(), 0.79, now).exitReason).toBe("sl");
  });
});
