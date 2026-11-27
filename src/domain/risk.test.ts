import { describe, expect, it } from "vitest";
import { fomoBrake, riskScore } from "./risk";
import { evaluateToken } from "./rules";
import { DEFAULT_RULES } from "./defaults";
import type { Token } from "./types";

const base: Token = {
  id: "a", ca: "a", chain: "solana", symbol: "A", name: "A", priceUsd: 1, change1hPct: 2, change5mPct: 1, source: "mock", updatedAt: 0,
  metrics: { liquidityUsd: 150_000, mcapUsd: 1e6, ageMin: 400, holders: 3000, top10Pct: 18, devHoldPct: 0, bundlePct: 2, buyRatioPct: 55 },
  flags: { mintRenounced: true, freezeRenounced: true, lpBurned: true },
};

describe("scor de risc și frâna anti-FOMO", () => {
  it("un token curat are risc scăzut și nicio frână", () => {
    const r = riskScore(base, evaluateToken(base, DEFAULT_RULES));
    expect(r.score).toBeLessThanOrEqual(3);
    expect(fomoBrake(base, r).active).toBe(false);
  });
  it("+250% în 5 minute pornește frâna de 2 s chiar dacă restul e curat", () => {
    const t = { ...base, change5mPct: 250 };
    const b = fomoBrake(t, riskScore(t, evaluateToken(t, DEFAULT_RULES)));
    expect(b.active).toBe(true);
    expect(b.holdMs).toBe(2000);
  });
  it("mint activ, lichiditate mică și pool nou dau risc ridicat", () => {
    const t = { ...base, metrics: { ...base.metrics, liquidityUsd: 8000, ageMin: 5, top10Pct: 60 }, flags: { mintRenounced: false, freezeRenounced: false } };
    const r = riskScore(t, evaluateToken(t, DEFAULT_RULES));
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(fomoBrake(t, r).active).toBe(true);
  });
});
