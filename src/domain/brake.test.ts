import { describe, expect, it } from "vitest";
import { assessBuy, needsSellConfirm, type BuyInput } from "./brake";
import { evaluateSession } from "./rules";
import { DEFAULT_RULES, DEFAULT_SETTINGS } from "./defaults";
import { antiTilt, consecutiveLosses, entriesInWindow } from "./tilt";
import { DAY, NOW, closedTrade, goodToken, openTrade } from "./fixtures";

const input = (p: Partial<BuyInput> = {}): BuyInput => ({
  token: goodToken, rules: DEFAULT_RULES, session: evaluateSession(DEFAULT_RULES, [], 2000, DAY, NOW), bankrollUsd: 2000, cashUsd: 2000,
  sizeUsd: 50, thesisText: "a supraviețuit migrării și lichiditatea crește", exec: { platformFeeBps: 0, slippageBps: 100, priorityFeeUsd: 0.15 },
  settings: DEFAULT_SETTINGS, mode: "demo", now: NOW, consecutiveLosses: 0, entriesInWindow: 0, ...p,
});

describe("frâna: contractul BrakeDecision", () => {
  it("un token curat trece fără frână", () => {
    const d = assessBuy(input()).decision;
    expect(d).toMatchObject({ triggered: false, severity: "none", recommendedAction: "proceed", requiresConfirmation: false, snapshotPrice: 1, reasons: [] });
  });

  it("spike-ul cere confirmare și recomandă așteptarea; mișcarea controlată nu", () => {
    const spike = assessBuy(input({ token: { ...goodToken, change5mPct: 80 } })).decision;
    expect(spike).toMatchObject({ severity: "high", requiresConfirmation: true, recommendedAction: "wait", move: "spike" });
    expect(spike.reasons[0]).toMatch(/5 min/);
    expect(assessBuy(input({ token: { ...goodToken, change5mPct: 20 } })).decision.move).toBe("normal");
  });

  it("impactul pe lichiditate: mic trece, mare cere confirmare, peste alunecare blochează", () => {
    const thin = { ...goodToken, metrics: { ...goodToken.metrics, liquidityUsd: 60_000 } };
    expect(assessBuy(input({ token: thin, sizeUsd: 30 })).decision.severity).toBe("none");
    const big = { bankrollUsd: 1e5, cashUsd: 1e5, session: evaluateSession(DEFAULT_RULES, [], 1e5, DAY, NOW) };
    const v = assessBuy(input({ ...big, token: thin, sizeUsd: 1000, exec: { platformFeeBps: 0, slippageBps: 1000, priorityFeeUsd: 0 } }));
    expect(v.quote.impactPct!).toBeGreaterThan(3);
    expect(v.decision.severity).toBe("high");
    expect(assessBuy(input({ token: thin, sizeUsd: 1000 })).decision.severity).toBe("block");
  });

  it("lichiditatea necunoscută nu trece niciodată fără confirmare", () => {
    const d = assessBuy(input({ token: { ...goodToken, metrics: { ...goodToken.metrics, liquidityUsd: undefined } } })).decision;
    expect(d.requiresConfirmation || d.severity === "block").toBe(true);
    expect(d.reasons.join(" ")).toMatch(/[Ll]ichiditate/);
  });

  it("datele vechi cer confirmare", () => {
    const d = assessBuy(input({ token: { ...goodToken, updatedAt: NOW - 90_000 } })).decision;
    expect(d.severity).toBe("caution");
    expect(d.reasons[0]).toMatch(/90 s/);
  });

  it("Anti-Tilt și Burst Cadence ridică frâna", () => {
    expect(assessBuy(input({ consecutiveLosses: 3 })).decision.reasons).toContain("3 pierderi la rând.");
    expect(assessBuy(input({ entriesInWindow: 3 })).decision.recommendedAction).toBe("wait");
  });

  it("prețul mutat de la previzualizare cere reconfirmare", () => {
    const d = assessBuy(input({ snapshotPrice: 0.95 })).decision;
    expect(d.requote).toBe(true);
    expect(d.requiresConfirmation).toBe(true);
    expect(assessBuy(input({ snapshotPrice: 0.99 })).decision.requote).toBe(false);
  });

  it("balanța insuficientă și modul LIVE blochează", () => {
    expect(assessBuy(input({ cashUsd: 10 })).decision.reasons[0]).toMatch(/Balanța DEMO/);
    expect(assessBuy(input({ mode: "live" })).decision.severity).toBe("block");
  });

  it("nicio valoare NaN în decizie, nici pentru sume absurde", () => {
    const v = assessBuy(input({ sizeUsd: NaN, token: { ...goodToken, priceUsd: 0 } }));
    expect(v.decision.severity).toBe("block");
    expect(Number.isFinite(v.quote.qty) && Number.isFinite(v.quote.fillPrice) && Number.isFinite(v.capUsd)).toBe(true);
  });

  it("la vânzare doar Sell 100% pe o poziție mare cere confirmare", () => {
    expect(needsSellConfirm(100, 500, 2000, 20)).toBe(true);
    expect(needsSellConfirm(50, 500, 2000, 20)).toBe(false);
    expect(needsSellConfirm(100, 100, 2000, 20)).toBe(false);
  });
});

describe("Anti-Tilt", () => {
  it("3 pierderi la rând îl pornesc; un câștig resetează la 0", () => {
    const losses = [closedTrade(NOW - 3000, -5), closedTrade(NOW - 2000, -5), closedTrade(NOW - 1000, -5)];
    expect(consecutiveLosses(losses)).toBe(3);
    expect(antiTilt(losses, NOW, DEFAULT_SETTINGS, null, DAY).active).toBe(true);
    expect(consecutiveLosses([...losses, closedTrade(NOW, 4)])).toBe(0);
  });
  it("ascuns pentru sesiune nu mai apare azi", () => {
    const losses = [closedTrade(NOW - 3000, -5), closedTrade(NOW - 2000, -5), closedTrade(NOW - 1000, -5)];
    expect(antiTilt(losses, NOW, DEFAULT_SETTINGS, DAY, DAY).active).toBe(false);
  });
  it("ritmul prea rapid îl pornește", () => {
    const entries = [1, 2, 3].map((i) => openTrade({ id: `e${i}`, openedAt: NOW - i * 60_000 }));
    expect(entriesInWindow(entries, NOW, 10)).toBe(3);
    expect(antiTilt(entries, NOW, DEFAULT_SETTINGS, null, DAY).reasons[0]).toMatch(/intrări/);
  });
});
