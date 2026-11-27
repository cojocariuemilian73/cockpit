import { describe, expect, it } from "vitest";
import { contractVerdict, filterTokens, filterTweets, lessons, traction, xSignal } from "./signals";
import { evaluateToken } from "./rules";
import { riskScore } from "./risk";
import { DEFAULT_RULES } from "./defaults";
import type { Tweet } from "./types";
import { NOW, closedTrade, goodToken } from "./fixtures";

const tweet = (p: Partial<Tweet>): Tweet => ({
  id: Math.random().toString(), author: { name: "Demo", handle: "demo_a", verified: false, avatarSeed: "demo_a", kol: false },
  text: "", ts: NOW - 60_000, views: 1, likes: 1, demo: true, ...p,
});

describe("cele trei răspunsuri", () => {
  it("siguranța contractului: curat / atenție / pericol", () => {
    const v = (t = goodToken) => contractVerdict(t, evaluateToken(t, DEFAULT_RULES), riskScore(t, evaluateToken(t, DEFAULT_RULES)));
    expect(v().level).toBe("curat");
    expect(v({ ...goodToken, flags: { ...goodToken.flags, lpBurned: undefined } }).level).toBe("atentie");
    expect(v({ ...goodToken, flags: { ...goodToken.flags, mintRenounced: false } })).toMatchObject({ level: "pericol", reason: expect.stringMatching(/mint/) });
  });
  it("tracțiunea pe 5 minute", () => {
    expect(traction(goodToken).label).toBe("Cumpărătorii domină");
    expect(traction({ ...goodToken, txns5m: { buys: 20, sells: 60 } }).tone).toBe("neg");
    expect(traction({ ...goodToken, txns5m: undefined }).label).toBe("Date lipsă");
  });
  it("semnalul X numără mențiunile recente, KOL-urile dublu", () => {
    const tw = [tweet({ ca: "a" }), tweet({ text: "$A urcă", author: { ...tweet({}).author, kol: true } }), tweet({ ca: "a", ts: NOW - 3 * 3600_000 })];
    expect(xSignal(tw, goodToken, NOW)).toMatchObject({ mentions: 2, kols: 1, label: "Moderat", demo: true });
    expect(xSignal([], goodToken, NOW).label).toBe("Liniște");
  });
});

describe("filtre, căutare, X", () => {
  const mintOn = { ...goodToken, id: "m", flags: { ...goodToken.flags, mintRenounced: false } };
  const unknown = { ...goodToken, id: "u", flags: {}, socials: undefined };
  const list = [goodToken, mintOn, unknown];

  it("un filtru fără date nu trece", () => {
    const r = filterTokens(list, ["noMint"], DEFAULT_RULES, false);
    expect(r.shown.map((t) => t.id)).toEqual(["a"]);
    expect(r.total).toBe(3);
  });
  it("regulile critice ascund tokenurile, cu contor (necunoscutul rămâne vizibil, dar nu trece filtrele)", () => {
    const r = filterTokens(list, [], DEFAULT_RULES, true);
    expect(r.shown.map((t) => t.id)).toEqual(["a", "u"]);
    expect(r.hiddenByRules).toBe(1);
  });
  it("filtrul text din X caută în text și în autor", () => {
    const tw = [tweet({ text: "LP burned azi" }), tweet({ text: "nimic", author: { ...tweet({}).author, handle: "demo_lp" } }), tweet({ text: "altceva" })];
    expect(filterTweets(tw, "lp")).toHaveLength(2);
    expect(filterTweets(tw, "  ")).toHaveLength(3);
  });
});

describe("Istoric & Lecții", () => {
  it("separă spike de tracțiunea normală și numără frâna", () => {
    const trades = [
      closedTrade(NOW - 3000, -10, { entryMove: "spike" }), closedTrade(NOW - 2000, -8, { entryMove: "spike" }),
      closedTrade(NOW - 1000, 12, { entryMove: "normal" }),
    ];
    const l = lessons(trades, () => 1, 4);
    expect(l).toMatchObject({ closed: 3, brakeHits: 4, spike: { n: 2, wins: 0 }, normal: { n: 1, wins: 1 } });
    expect(l.realizedUsd).toBeCloseTo(-6);
    expect(l.winRate).toBeCloseTo(1 / 3);
    expect(l.note).toMatch(/spike/);
  });
});
