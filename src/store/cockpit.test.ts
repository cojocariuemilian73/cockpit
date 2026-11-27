// Teste de stres pe reducerul pur: fiecare scenariu cerut, plus invariantele după o secvență lungă de acțiuni aleatoare.

import { describe, expect, it } from "vitest";
import { createState, durableOf, reducer, selectBuy, type Action, type State } from "./cockpit";
import { checkInvariants } from "../domain/invariants";
import { exportDurable } from "../domain/schema";
import { antiTilt, consecutiveLosses } from "../domain/tilt";
import { seeded } from "../domain/rng";
import { NOW } from "../domain/fixtures";

const THESIS = "lichiditatea crește constant și dev-ul nu vinde";

/** Stare de test: prețuri controlate manual (Live Tick oprit), limitele de sesiune oprite ca să nu ascundă scenariul. */
function start(p: Partial<State["settings"]> = {}): State {
  const s = createState(NOW);
  return run({ ...s, rules: s.rules.map((r) => (r.kind === "session" && r.type !== "minThesisWords" ? { ...r, enabled: false } : r)) },
    { type: "settings", patch: { liveTick: false, ...p } }, { type: "draft", patch: { thesis: THESIS, amount: "0.5" } });
}
const run = (s: State, ...as: Action[]) => as.reduce(reducer, s);
const tok = (s: State, sym: string) => s.tokens.find((t) => t.symbol === sym)!;
const pick = (s: State, sym: string) => run(s, { type: "select", id: tok(s, sym).id }, { type: "draft", patch: { thesis: THESIS } });
/** Mută prețul și lasă motorul să reacționeze (tick cu Live Tick oprit = doar decontare). */
function price(s: State, sym: string, factor: number, dtMs = 1000): State {
  const t = tok(s, sym);
  const now = s.now + dtMs;
  return reducer({ ...s, tokens: s.tokens.map((x) => (x.id === t.id ? { ...x, priceUsd: t.priceUsd * factor, updatedAt: now } : x)) }, { type: "tick", now, dtSec: dtMs / 1000 });
}
let n = 0;
/** Apasă BUY așa cum o face UI-ul: teza scrisă, prețul văzut la previzualizare, un nonce nou. */
function buy(s: State, nonce = `n${n++}`): State {
  const t = run(s, { type: "draft", patch: { thesis: THESIS } });
  const sel = t.tokens.find((x) => x.id === t.selectedId)!;
  return reducer(t, { type: "buy", nonce, tokenId: sel.id, snapshotPrice: sel.priceUsd });
}
const ok = (s: State) => expect(checkInvariants(durableOf(s))).toEqual([]);
const open = (s: State) => s.trades.filter((t) => t.closedAt === undefined);

describe("stres: bani și cantități", () => {
  it("balanță insuficientă: nimic nu se execută, balanța rămâne", () => {
    let s = run(start(), { type: "draft", patch: { amount: "20" } });
    expect(selectBuy(s).decision.reasons[0]).toMatch(/Balanța DEMO/);
    s = buy(s);
    expect(s.trades).toHaveLength(0);
    expect(s.cashUsd).toBe(s.bankrollUsd);
    ok(s);
  });

  it("vânzare peste deținere: se limitează la 100%, apoi nu mai e nimic de vândut", () => {
    let s = buy(start());
    expect(s.trades).toHaveLength(1);
    const id = s.trades[0].id;
    s = run(s, { type: "sell", tradeId: id, pct: 150 });
    expect(s.trades[0]).toMatchObject({ remainingQty: 0, exitReason: "manual" });
    const after = s;
    expect(run(s, { type: "sell", tradeId: id, pct: 50 })).toBe(after);
    expect(run(s, { type: "sell", tradeId: id, pct: NaN })).toBe(after);
    expect(s.cashUsd).toBeGreaterThan(0);
    ok(s);
  });

  it("resturile infime de cantitate se închid", () => {
    let s = buy(start());
    const id = s.trades[0].id;
    s = run(s, { type: "sell", tradeId: id, pct: 99.99999995 });
    expect(s.trades[0].closedAt).toBeDefined();
    ok(s);
  });

  it("dump pe poziție: stopul închide, vânzarea nu e blocată, registrul se închide", () => {
    let s = buy(start());
    s = price(s, "PUFF", 0.4);
    expect(s.trades[0]).toMatchObject({ exitReason: "sl" });
    expect(s.trades[0].pnlUsd!).toBeLessThan(0);
    expect(s.cashUsd).toBeGreaterThanOrEqual(0);
    ok(s);
  });
});

describe("stres: curse și dublu click", () => {
  it("dublu declanșator cu același nonce → o singură cumpărare", () => {
    let s = start();
    s = buy(s, "x");
    s = buy(s, "x");
    expect(s.trades).toHaveLength(1);
    ok(s);
  });

  it("dublu click pe confirmare → o singură cumpărare", () => {
    let s = buy(pick(start(), "GRUB")); // GRUB are atenționări: cere confirmare
    expect(s.eph.confirm).not.toBeNull();
    const cid = s.eph.confirm!.id;
    s = run(s, { type: "confirmBuy", id: cid }, { type: "confirmBuy", id: cid });
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].acceptedWarnings).toBe(true);
    ok(s);
  });

  it("cursă cu Live Tick între previzualizare și confirmare: execută la prețul de acum, o singură dată", () => {
    let s = buy(pick(start({ liveTick: true }), "GRUB"));
    const cid = s.eph.confirm!.id;
    for (let i = 1; i <= 3; i++) s = run(s, { type: "tick", now: s.now + 1000, dtSec: 1 });
    s = run(s, { type: "confirmBuy", id: s.eph.confirm?.id ?? cid });
    if (s.eph.confirm) s = run(s, { type: "confirmBuy", id: s.eph.confirm.id }); // reconfirmare după un salt mare
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].entryPrice).toBeCloseTo(tok(s, "GRUB").priceUsd * 1.01, 12);
    ok(s);
  });

  it("schimbarea tokenului în timpul confirmării anulează confirmarea", () => {
    let s = buy(pick(start(), "GRUB"));
    const cid = s.eph.confirm!.id;
    s = run(s, { type: "select", id: tok(s, "PUFF").id });
    expect(s.eph.confirm).toBeNull();
    s = run(s, { type: "confirmBuy", id: cid });
    expect(s.trades).toHaveLength(0);
  });

  it("token schimbat între previzualizare și execuție → nimic executat", () => {
    let s = start();
    const grub = tok(s, "GRUB");
    s = run(s, { type: "buy", nonce: "y", tokenId: grub.id, snapshotPrice: grub.priceUsd }); // ales e PUFF
    expect(s.trades).toHaveLength(0);
    expect(s.toasts.at(-1)!.text).toMatch(/s-a schimbat/);
  });

  it("salt de preț înainte de confirmare → cere reconfirmare explicită", () => {
    let s = buy(pick(start(), "GRUB"));
    const first = s.eph.confirm!;
    s = price(s, "GRUB", 1.06);
    s = run(s, { type: "confirmBuy", id: first.id });
    expect(s.trades).toHaveLength(0);
    expect(s.eph.confirm!.id).not.toBe(first.id);
    expect(s.eph.confirm!.snapshotPrice).toBeCloseTo(first.snapshotPrice * 1.06);
    s = run(s, { type: "confirmBuy", id: s.eph.confirm!.id });
    expect(s.trades).toHaveLength(1);
    ok(s);
  });

  it("saltul între previzualizare și apăsare cere confirmare chiar pe un token curat", () => {
    let s = start();
    const puff = tok(s, "PUFF");
    s = price(s, "PUFF", 1.05);
    s = run(s, { type: "buy", nonce: "z", tokenId: puff.id, snapshotPrice: puff.priceUsd });
    expect(s.trades).toHaveLength(0);
    expect(s.eph.confirm!.reasons.join(" ")).toMatch(/previzualizare/);
  });
});

describe("stres: 2x, Anti-Tilt, Sell 100%", () => {
  it("2x Auto-Breakeven vinde 50%, marchează moonbag-ul, mută stopul la intrare", () => {
    let s = run(start(), { type: "draft", patch: { autoTp: false } });
    s = buy(s);
    const q = s.trades[0].qty;
    s = price(s, "PUFF", 2.2);
    const t = s.trades[0];
    expect(t.recovered).toBeDefined();
    expect(t.remainingQty).toBeCloseTo(q / 2);
    expect(t.closedAt).toBeUndefined();
    expect(s.toasts.at(-1)!.text).toMatch(/2x/);
    s = price(s, "PUFF", 0.4); // sub intrare: moonbag-ul iese la intrare, nu la −20%
    expect(s.trades[0].exitReason).toBe("breakeven");
    ok(s);
  });

  it("toggle 2x pe poziție: oprit nu vinde la 2x", () => {
    let s = run(start(), { type: "draft", patch: { autoTp: false } });
    s = buy(s);
    s = run(s, { type: "toggle2x", tradeId: s.trades[0].id });
    s = price(s, "PUFF", 2.2);
    expect(s.trades[0].recovered).toBeUndefined();
  });

  it("3 pierderi → Anti-Tilt; un câștig resetează; miza minimă și ascunderea merg", () => {
    let s = start();
    for (let i = 0; i < 3; i++) { s = buy(s); s = price(s, "PUFF", 0.5, 60_000); s = price(s, "PUFF", 2, 1000); }
    expect(consecutiveLosses(s.trades)).toBe(3);
    expect(antiTilt(s.trades, s.now, s.settings, s.tiltHiddenDay, "2026-11-27").active).toBe(true);
    expect(selectBuy(s).decision.reasons.join(" ")).toMatch(/3 pierderi la rând/);
    s = run(s, { type: "tilt", act: "minSize" });
    expect(s.draft.amount).toBe("0.1");
    s = run(s, { type: "tilt", act: "hide" });
    expect(antiTilt(s.trades, s.now, s.settings, s.tiltHiddenDay, "2026-11-27").active).toBe(false);
    s = run(s, { type: "draft", patch: { thesis: THESIS } });
    s = buy(s);
    if (s.eph.confirm) s = run(s, { type: "confirmBuy", id: s.eph.confirm.id });
    s = run(s, { type: "sellToken", tokenId: tok(s, "PUFF").id, pct: 100 });
    s = price(s, "PUFF", 1.5);
    s = run(s, { type: "draft", patch: { thesis: THESIS } });
    s = buy(s);
    if (s.eph.confirm) s = run(s, { type: "confirmBuy", id: s.eph.confirm.id });
    s = price(s, "PUFF", 1.3);
    s = run(s, { type: "sellToken", tokenId: tok(s, "PUFF").id, pct: 100 });
    expect(s.trades.at(-1)!.pnlUsd!).toBeGreaterThan(0);
    expect(consecutiveLosses(s.trades)).toBe(0);
    ok(s);
  });

  it("Sell 100% pe o poziție mare cere o confirmare vizibilă, apoi vinde", () => {
    let s = buy(start({ bigPositionPct: 1 }));
    const id = s.trades[0].id;
    s = run(s, { type: "sell", tradeId: id, pct: 100 });
    expect(s.eph.sellConfirm).toBe(id);
    expect(open(s)).toHaveLength(1);
    s = run(s, { type: "sell", tradeId: id, pct: 50 }); // parțialul nu cere nimic
    expect(open(s)[0].remainingQty).toBeLessThan(open(s)[0].qty);
    s = run(s, { type: "sell", tradeId: id, pct: 100, confirmed: true });
    expect(open(s)).toHaveLength(0);
    ok(s);
  });

  it("modul LIVE nu execută nimic", () => {
    const s = buy(run(start(), { type: "mode", mode: "live" }));
    expect(s.trades).toHaveLength(0);
    expect(s.toasts.at(-1)!.text).toMatch(/LIVE/);
  });
});

describe("stres: Reset, Undo, Import", () => {
  it("Reset Demo + Undo readuce exact portofoliul", () => {
    let s = buy(start());
    s = price(s, "PUFF", 1.1);
    const before = durableOf(s);
    s = run(s, { type: "resetDemo" });
    expect(s.trades).toHaveLength(0);
    expect(s.cashUsd).toBeCloseTo(10 * s.natives.solana);
    expect(s.toasts.at(-1)!.action).toBe("undoReset");
    s = run(s, { type: "undoReset" });
    expect(durableOf(s)).toEqual(before);
    expect(s.eph.undo).toBeNull();
    ok(s);
  });

  it("import JSON invalid e respins întreg, starea rămâne", () => {
    const s = buy(start());
    const bad = [
      "{nu e json",
      JSON.stringify({ schema: "altceva", version: 4, data: {} }),
      JSON.stringify({ schema: "cockpit.demo", version: 3, data: {} }),
      exportDurable({ ...durableOf(s), cashUsd: -5 }, 0),
      exportDurable({ ...durableOf(s), trades: [{ ...s.trades[0], sizeUsd: "mult" as unknown as number }] }, 0),
      exportDurable({ ...durableOf(s), extra: 1 } as never, 0),
      exportDurable({ ...durableOf(s), trades: [{ ...s.trades[0], remainingQty: s.trades[0].qty * 2 }] }, 0),
    ];
    for (const text of bad) {
      const r = run(s, { type: "import", text });
      expect(durableOf(r)).toEqual(durableOf(s));
      expect(r.toasts.at(-1)!.text).toMatch(/Import respins/);
    }
  });

  it("export → import dă aceeași stare și curăță starea efemeră", () => {
    let s = buy(pick(start(), "GRUB"));
    s = run(s, { type: "radarFilter", filter: "noMint" }, { type: "xQuery", q: "lp" });
    const text = exportDurable(durableOf(s), 0);
    const r = run(createState(NOW), { type: "import", text });
    expect(durableOf(r)).toEqual(durableOf(s));
    const r2 = run(s, { type: "import", text });
    expect(r2.eph).toMatchObject({ confirm: null, radarFilters: [], xQuery: "" });
  });
});

describe("stres: filtre, watchlist, X, rețea", () => {
  it("watchlist: steaua adaugă și scoate", () => {
    let s = start();
    const t = { ...tok(s, "PUFF"), id: "nou", ca: "nou", symbol: "NOU" };
    s = run(s, { type: "star", token: t });
    expect(s.watchlist).toContain("nou");
    expect(s.tokens.some((x) => x.id === "nou")).toBe(true);
    s = run(s, { type: "star", token: t });
    expect(s.watchlist).not.toContain("nou");
  });

  it("filtrele și căutarea X sunt efemere: se curăță la schimbarea rețelei", () => {
    let s = run(start(), { type: "radarFilter", filter: "noMint" }, { type: "radarFilter", filter: "hasX" }, { type: "xQuery", q: "dev" });
    expect(s.eph.radarFilters).toEqual(["noMint", "hasX"]);
    s = run(s, { type: "radarFilter", filter: "noMint" });
    expect(s.eph.radarFilters).toEqual(["hasX"]);
    s = run(s, { type: "chain", chain: "base" });
    expect(s.eph).toMatchObject({ radarFilters: [], xQuery: "", confirm: null });
  });
});

describe("invariante și determinism", () => {
  const actions = (seed: number, steps: number): Action[] => {
    const r = seeded(seed);
    const out: Action[] = [];
    let now = NOW;
    for (let i = 0; i < steps; i++) {
      const k = Math.floor(r() * 10);
      now += 1000 + Math.floor(r() * 120_000);
      if (k < 4) out.push({ type: "tick", now, dtSec: 1 });
      else if (k === 4) out.push({ type: "select", id: ["PUFF", "GRUB", "OTTO"][Math.floor(r() * 3)] });
      else if (k === 5) out.push({ type: "draft", patch: { amount: String([0.1, 0.5, 1, 5, 50, -1][Math.floor(r() * 6)]), thesis: THESIS } });
      else if (k === 6) out.push({ type: "buy", nonce: `r${i}`, tokenId: "?", snapshotPrice: 0 });
      else if (k === 7) out.push({ type: "confirmBuy", id: "?" });
      else if (k === 8) out.push({ type: "sellToken", tokenId: "?", pct: [10, 50, 100, 250][Math.floor(r() * 4)], confirmed: r() > 0.5 });
      else out.push(r() > 0.5 ? { type: "resetDemo" } : { type: "undoReset" });
    }
    return out;
  };
  /** Rezolvă „?” cu starea curentă (tokenul ales, confirmarea în curs), ca o mână reală pe UI. */
  const resolve = (s: State, a: Action): Action => {
    if (a.type === "select") return { ...a, id: tok(s, a.id).id };
    if (a.type === "buy") { const t = s.tokens.find((x) => x.id === s.selectedId)!; return { ...a, tokenId: t.id, snapshotPrice: t.priceUsd }; }
    if (a.type === "confirmBuy") return { ...a, id: s.eph.confirm?.id ?? "-" };
    if (a.type === "sellToken") return { ...a, tokenId: s.selectedId! };
    return a;
  };
  const play = (seed: number) => {
    let s = createState(NOW);
    s = run({ ...s, rules: s.rules.map((r) => (r.kind === "session" && r.type !== "minThesisWords" ? { ...r, enabled: false } : r)) });
    let opened = 0;
    for (const a of actions(seed, 400)) {
      const before = s.trades.length;
      s = reducer(s, resolve(s, a));
      if (s.trades.length > before) opened++;
      expect(checkInvariants(durableOf(s))).toEqual([]);
    }
    return { s, opened };
  };

  it("400 de acțiuni aleatoare nu încalcă niciun invariant", () => {
    expect(play(7).opened).toBeGreaterThan(3);
  });

  it("aceeași sămânță și aceleași acțiuni dau aceeași stare", () => {
    expect(durableOf(play(11).s)).toEqual(durableOf(play(11).s));
  });
});
