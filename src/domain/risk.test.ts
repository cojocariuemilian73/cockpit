import { describe, expect, it } from "vitest";
import { riskScore } from "./risk";
import { evaluateToken } from "./rules";
import { DEFAULT_RULES } from "./defaults";
import { goodToken as base } from "./fixtures";

describe("scor de risc", () => {
  it("un token curat are risc scăzut", () => {
    expect(riskScore(base, evaluateToken(base, DEFAULT_RULES)).score).toBeLessThanOrEqual(3);
  });
  it("mint activ, lichiditate mică și pool nou dau risc ridicat", () => {
    const t = { ...base, metrics: { ...base.metrics, liquidityUsd: 8000, ageMin: 5, top10Pct: 60 }, flags: { mintRenounced: false, freezeRenounced: false } };
    expect(riskScore(t, evaluateToken(t, DEFAULT_RULES)).score).toBeGreaterThanOrEqual(7);
  });
});
