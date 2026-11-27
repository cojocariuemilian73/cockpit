// Starea aplicației: un reducer pur + un hook subțire care leagă marginile (ceas, rețea, localStorage).
// Reducerul nu citește Date.now, Math.random sau localStorage: ora vine în acțiuni, aleatorul din `seed`,
// id-urile din `seq`. Aceeași secvență de acțiuni dă mereu aceeași stare, deci se poate testa.

import { useEffect, useReducer, useRef } from "react";
import type { Chain, Durable, LimitOrder, Mode, Preset, Rule, Settings, ThesisTag, Token, Trade } from "../domain/types";
import { DEFAULT_RULES, DEFAULT_SETTINGS, DEMO_SOL, PRESETS } from "../domain/defaults";
import { evaluateSession, evaluateToken, fmtUsd, fmtPct, DEFAULT_EXIT } from "../domain/rules";
import { assessBuy, needsSellConfirm, type BrakeAction, type BrakeSeverity, type BuyInput, type BuyView } from "../domain/brake";
import { consecutiveLosses, entriesInWindow } from "../domain/tilt";
import type { RadarFilter } from "../domain/signals";
import { exportDurable, parseImport } from "../domain/schema";
import { seeded } from "../domain/rng";
import { applyExitPlan, positionValue, quoteBuy, sellPart } from "../execution/executor";
import { marketData, security, stepDemo } from "../data/market";
import type { LivePatch } from "../data/live";

export interface Draft {
  side: "buy" | "sell";
  /** suma în moneda nativă a rețelei (SOL / ETH / BNB), ca text editabil */
  amount: string;
  thesis: string;
  tag: ThesisTag;
  orderType: "market" | "limit";
  limitPrice: string;
  /** TP automat din regula de ieșire; stopul rămâne mereu activ */
  autoTp: boolean;
  /** 2x Auto-Breakeven pe poziția nouă */
  auto2x: boolean;
}

export interface Toast { id: string; text: string; tone: "info" | "good" | "bad" | "warn"; at: number; action?: "undoReset" }

/** O cumpărare oprită de frână, care așteaptă confirmarea explicită. */
export interface PendingBuy {
  id: string;
  tokenId: string;
  sizeUsd: number;
  snapshotPrice: number;
  severity: BrakeSeverity;
  reasons: string[];
  recommendedAction: BrakeAction;
}

/** Starea efemeră: nu se salvează; se curăță la schimbarea tokenului / rețelei, la Reset Demo și la Import. */
export interface Ephemeral {
  confirm: PendingBuy | null;
  /** Sell 100% pe o poziție mare, care așteaptă confirmarea (cheia = trade sau token) */
  sellConfirm: string | null;
  radarFilters: RadarFilter[];
  xQuery: string;
  /** starea dinaintea unui Reset Demo, pentru Undo */
  undo: Durable | null;
  /** ultimul declanșator de cumpărare procesat: un al doilea cu același nonce e ignorat */
  lastNonce: string | null;
}

export interface State extends Durable {
  draft: Draft;
  eph: Ephemeral;
  toasts: Toast[];
  now: number;
  seed: number;
  seq: number;
  natives: Record<Chain, number>;
  feed: { okAt: number | null; errAt: number | null };
}

export type Action =
  | { type: "tick"; now: number; dtSec: number }
  | { type: "livePatch"; patches: Record<string, LivePatch> }
  | { type: "feed"; ok: boolean }
  | { type: "enrich"; id: string; patch: Partial<Token> }
  | { type: "chain"; chain: Chain }
  | { type: "select"; id: string }
  | { type: "addToken"; token: Token; amount?: string }
  | { type: "star"; token: Token }
  | { type: "draft"; patch: Partial<Draft> }
  | { type: "buy"; nonce: string; tokenId: string; snapshotPrice: number }
  | { type: "confirmBuy"; id: string }
  | { type: "cancelBuy" }
  | { type: "cancelOrder"; id: string }
  | { type: "sell"; tradeId: string; pct: number; confirmed?: boolean }
  | { type: "sellToken"; tokenId: string; pct: number; confirmed?: boolean }
  | { type: "cancelSell" }
  | { type: "editExit"; tradeId: string; tpPct?: number; slPct?: number; trailPct?: number }
  | { type: "toggle2x"; tradeId: string }
  | { type: "noteTrade"; tradeId: string; note: string }
  | { type: "rule"; rule: Rule }
  | { type: "removeRule"; id: string }
  | { type: "addIdea"; text: string }
  | { type: "removeIdea"; id: string }
  | { type: "addAlert"; op: "above" | "below"; price: number }
  | { type: "removeAlert"; id: string }
  | { type: "track"; address: string; label: string }
  | { type: "untrack"; address: string }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "preset"; preset: Preset }
  | { type: "mode"; mode: Mode }
  | { type: "dismiss"; id: string }
  | { type: "natives"; prices: Record<Chain, number> }
  | { type: "radarFilter"; filter: RadarFilter | null }
  | { type: "xQuery"; q: string }
  | { type: "tilt"; act: "minSize" | "hide" }
  | { type: "resetDemo" }
  | { type: "undoReset" }
  | { type: "import"; text: string };

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const STORAGE_KEY = "cockpit.v4";
export const NATIVE_PRESETS: Record<Chain, number[]> = { solana: [0.1, 0.5, 1, 5], base: [0.005, 0.01, 0.05, 0.1], bsc: [0.01, 0.05, 0.1, 0.5] };
export const REASON: Record<string, string> = { tp: "take profit", sl: "stop loss", breakeven: "stop la intrare", trailing: "trailing stop", timp: "timp expirat", manual: "vândut", "2x": "2x: inițial recuperat" };

const DEFAULT_NATIVES: Record<Chain, number> = { solana: 150, base: 3000, bsc: 600 };
const MAX_TOASTS = 4;
const MAX_TOKENS = 60;

const DURABLE_KEYS = ["mode", "chain", "cashUsd", "bankrollUsd", "rules", "ideas", "trades", "orders", "alerts", "settings", "tokens", "selectedId", "watchlist", "tracked", "brakeHits", "tiltHiddenDay"] as const;

export function durableOf(s: State): Durable {
  const out = {} as Record<string, unknown>;
  for (const k of DURABLE_KEYS) out[k] = s[k];
  return out as unknown as Durable;
}

const freshEph = (undo: Durable | null = null): Ephemeral => ({ confirm: null, sellConfirm: null, radarFilters: [], xQuery: "", undo, lastNonce: null });
const freshDraft = (d: Draft): Draft => ({ ...d, thesis: "", limitPrice: "" });

/** id-uri deterministe: `seq` crește cu fiecare acțiune care schimbă starea. */
function ids(seq: number) {
  let k = 0;
  return (p: string) => `${p}${seq.toString(36)}-${k++}`;
}

export function createState(now: number, seed = 20261127): State {
  const tokens = marketData.watchlist(now);
  const cash = DEMO_SOL * DEFAULT_NATIVES.solana;
  return {
    mode: "demo", chain: "solana", cashUsd: cash, bankrollUsd: cash,
    rules: DEFAULT_RULES,
    ideas: [
      { id: "i1", text: "Intru doar pe tokenuri care au supraviețuit primelor 30 de minute după migrare.", createdAt: now },
      { id: "i2", text: "Dacă un token a făcut deja ×3 în ultima oră, am întârziat.", createdAt: now },
    ],
    trades: [], orders: [], alerts: [],
    settings: DEFAULT_SETTINGS,
    tokens, selectedId: tokens[0].id, watchlist: tokens.map((t) => t.id), tracked: [],
    brakeHits: 0, tiltHiddenDay: null,
    draft: { side: "buy", amount: "0.5", thesis: "", tag: "narativă", orderType: "market", limitPrice: "", autoTp: true, auto2x: true },
    eph: freshEph(), toasts: [], now, seed, seq: 1, natives: { ...DEFAULT_NATIVES }, feed: { okAt: null, errAt: null },
  };
}

/** Starea salvată trece prin aceeași validare strictă ca un import; orice abatere → pornim curat. */
export function hydrate(raw: string | null, now: number): State {
  const s = createState(now);
  if (!raw) return s;
  const r = parseImport(raw);
  if (!r.ok) return s;
  return { ...s, ...r.data, tokens: r.data.tokens.length ? r.data.tokens : s.tokens };
}

const pushToast = (s: State, id: string, text: string, tone: Toast["tone"] = "info", action?: Toast["action"]): Toast[] =>
  [...s.toasts, { id, text, tone, at: s.now, action }].slice(-MAX_TOASTS);

const parseAmount = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Valoarea în $ a sumei din panoul de swap, la prețul nativ al rețelei tokenului. */
export function draftUsd(s: Pick<State, "draft" | "natives">, chain: Chain): number {
  return parseAmount(s.draft.amount) * s.natives[chain];
}

export const selected = (s: State) => s.tokens.find((t) => t.id === s.selectedId) ?? null;

export type DataStatus = "simulat" | "live" | "pauza" | "fallback";

/** Starea datelor pentru tokenul ales: Simulat (demo), Live, Pauză (Live Tick oprit) sau Fallback (sursa nu răspunde). */
export function dataStatus(s: State): DataStatus {
  if (!s.settings.liveTick) return "pauza";
  if (selected(s)?.source !== "live") return "simulat";
  return s.feed.errAt !== null && (s.feed.okAt === null || s.feed.errAt > s.feed.okAt) ? "fallback" : "live";
}

/** Numerar + valoarea de acum a pozițiilor deschise. */
export function equityUsd(s: State): number {
  return s.cashUsd + s.trades.reduce((sum, t) => sum + positionValue(t, priceOf(s, t.tokenId)), 0);
}

function execCfg(s: State, chain: Chain) {
  return { platformFeeBps: 0, slippageBps: s.settings.slippageBps, priorityFeeUsd: s.settings.priorityFeeSol * s.natives[chain] };
}

function buyInput(s: State, token: Token | null, sizeUsd: number, thesisText: string, snapshotPrice?: number): BuyInput {
  return {
    token, rules: s.rules, bankrollUsd: s.bankrollUsd, cashUsd: s.cashUsd, sizeUsd, thesisText,
    session: evaluateSession(s.rules, s.trades, s.bankrollUsd, dayKey(s.now), s.now),
    exec: execCfg(s, token?.chain ?? s.chain), settings: s.settings, mode: s.mode, now: s.now,
    consecutiveLosses: consecutiveLosses(s.trades), entriesInWindow: entriesInWindow(s.trades, s.now, s.settings.burstWindowMin), snapshotPrice,
  };
}

/** Ce vede panoul de swap acum: o singură evaluare, aceeași pe care o refolosește execuția. */
export function selectBuy(s: State): BuyView {
  const t = selected(s);
  return assessBuy(buyInput(s, t, draftUsd(s, t?.chain ?? s.chain), s.draft.thesis));
}

function openTrade(s: State, id: string, token: Token, sizeUsd: number, thesis: Trade["thesis"], view: BuyView, ack: boolean, autoTp: boolean, auto2x: boolean): Trade {
  const exit = (s.rules.find((r) => r.kind === "exit") ?? DEFAULT_EXIT) as typeof DEFAULT_EXIT;
  const exec = execCfg(s, token.chain);
  const q = quoteBuy(token.priceUsd, sizeUsd, exec, token.metrics.liquidityUsd);
  return {
    id, day: dayKey(s.now), tokenId: token.id, symbol: token.symbol, ca: token.ca,
    sizeUsd: q.sizeUsd, feeUsd: q.feeUsd + q.commissionUsd, entryPrice: q.fillPrice, qty: q.qty, remainingQty: q.qty,
    realizedUsd: 0, tpPct: autoTp ? exit.tpPct : 1e9, slPct: exit.slPct, partialPct: exit.partialPct, maxHoldMin: exit.maxHoldMin,
    tpHit: false, trailPct: exit.trailPct, peakPrice: q.fillPrice, exec,
    openedAt: s.now, thesis, checksAtEntry: evaluateToken(token, s.rules), acceptedWarnings: ack, mode: "paper",
    auto2x, entryMove: view.decision.move, brakeReasons: view.decision.reasons.slice(0, 6),
  };
}

/** Numerarul urmează registrul: intrările scad costul, vânzările adaugă încasarea. Nu coboară sub 0. */
function syncCash(before: State, after: State): number {
  const prev = new Map(before.trades.map((t) => [t.id, t]));
  let cash = before.cashUsd;
  for (const t of after.trades) {
    const p = prev.get(t.id);
    cash += p ? t.realizedUsd - p.realizedUsd : t.realizedUsd - t.sizeUsd;
  }
  return Math.max(0, cash);
}

/** Prețuri noi → ieșiri automate (2x, TP, stop), ordine limită, alerte, notificări de cooldown. */
function settle(prev: State, next: State, id: (p: string) => string): State {
  const price = new Map(next.tokens.map((t) => [t.id, t.priceUsd]));
  let s = { ...next, trades: next.trades.map((t) => (t.closedAt === undefined ? applyExitPlan(t, price.get(t.tokenId) ?? 0, next.now) : t)) };

  for (const t of s.trades) {
    const before = next.trades.find((x) => x.id === t.id);
    if (!before || before === t) continue;
    if (before.closedAt === undefined && t.closedAt !== undefined) {
      const pnl = t.pnlUsd ?? 0;
      s = { ...s, toasts: pushToast(s, id("n"), `${t.symbol}: ${REASON[t.exitReason!]}, ${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}`, pnl >= 0 ? "good" : "bad") };
    } else if (!before.recovered && t.recovered) {
      s = { ...s, toasts: pushToast(s, id("n"), `${t.symbol}: 2x atins. 50% vândut, inițialul e recuperat; restul e moonbag cu stop la intrare.`, "good") };
    } else if (!before.tpHit && t.tpHit) {
      s = { ...s, toasts: pushToast(s, id("n"), `${t.symbol}: TP atins, ${t.partialPct}% vândut. Restul are stop ${t.trailPct ? `trailing ${t.trailPct}%` : "la intrare"}.`, "good") };
    }
  }

  // ordine limită: la declanșare, frâna se reevaluează cu starea de acum
  for (const o of s.orders) {
    if (o.status !== "open") continue;
    const setOrder = (patch: Partial<LimitOrder>) => s.orders.map((x) => (x.id === o.id ? { ...x, ...patch } : x));
    if (s.now >= o.expiresAt) {
      s = { ...s, orders: setOrder({ status: "expired" }), toasts: pushToast(s, id("n"), `Ordinul pe ${o.symbol} a expirat.`) };
      continue;
    }
    const token = s.tokens.find((t) => t.id === o.tokenId);
    if (!token || token.priceUsd > o.triggerPrice) continue;
    const view = assessBuy(buyInput(s, token, o.sizeUsd, o.thesis.text));
    const d = view.decision;
    if (d.severity === "block" || d.severity === "high" || (d.requiresConfirmation && !o.acceptedWarnings)) {
      const note = d.reasons[0] ?? "atenționări noi neconfirmate";
      s = { ...s, orders: setOrder({ status: "cancelled", note }), toasts: pushToast(s, id("n"), `Ordinul pe ${o.symbol} anulat: ${note}`, "warn") };
      continue;
    }
    const trade = openTrade(s, id("t"), token, o.sizeUsd, o.thesis, view, o.acceptedWarnings, true, s.draft.auto2x);
    s = { ...s, trades: [...s.trades, trade], orders: setOrder({ status: "filled" }), toasts: pushToast(s, id("n"), `Ordin executat: ${o.symbol} ${fmtUsd(o.sizeUsd)}`, "good") };
  }

  for (const a of s.alerts) {
    if (a.firedAt) continue;
    const p = price.get(a.tokenId);
    if (p === undefined) continue;
    if ((a.op === "above" && p >= a.price) || (a.op === "below" && p <= a.price)) {
      s = { ...s, alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, firedAt: s.now } : x)), toasts: pushToast(s, id("n"), `Alertă ${a.symbol}: prețul e ${a.op === "above" ? "peste" : "sub"} ${a.price.toPrecision(4)} $`) };
    }
  }

  const was = evaluateSession(prev.rules, prev.trades, prev.bankrollUsd, dayKey(prev.now), prev.now).state;
  const is = evaluateSession(s.rules, s.trades, s.bankrollUsd, dayKey(s.now), s.now).state;
  if (was !== "cooldown" && is === "cooldown") s = { ...s, toasts: pushToast(s, id("n"), "Cooldown pornit. Ia o pauză, regulile de sesiune sunt blocate.", "warn") };
  if (was === "cooldown" && is === "active") s = { ...s, toasts: pushToast(s, id("n"), "Pauza s-a terminat. Poți tranzacționa din nou.") };
  return s;
}

/** Execută cumpărarea care a trecut de frână: trade de piață sau ordin limită. */
function execute(s: State, id: (p: string) => string, token: Token, sizeUsd: number, view: BuyView, ack: boolean): State {
  const thesis = { text: s.draft.thesis.trim(), tag: s.draft.tag };
  const base = { ...s, draft: freshDraft(s.draft), eph: { ...s.eph, confirm: null } };
  if (s.draft.orderType === "limit") {
    const trigger = parseAmount(s.draft.limitPrice);
    if (!(trigger > 0 && trigger < token.priceUsd)) return { ...s, eph: { ...s.eph, confirm: null }, toasts: pushToast(s, id("n"), "Prețul limită trebuie să fie sub prețul curent.", "warn") };
    const o: LimitOrder = {
      id: id("o"), tokenId: token.id, symbol: token.symbol, triggerPrice: trigger, sizeUsd, thesis, acceptedWarnings: ack,
      createdAt: s.now, expiresAt: s.now + s.settings.orderTtlMin * 60_000, status: "open",
    };
    return { ...base, orders: [...s.orders, o], toasts: pushToast(s, id("n"), `Ordin limită pus pe ${token.symbol} la ${trigger.toPrecision(4)} $`) };
  }
  const trade = openTrade(s, id("t"), token, sizeUsd, thesis, view, ack, s.draft.autoTp, s.draft.auto2x);
  return { ...base, trades: [...s.trades, trade], toasts: pushToast(s, id("n"), `Cumpărat ${token.symbol} ${fmtUsd(sizeUsd)} (DEMO)`) };
}

/** Prețul la care s-ar vinde acum un trade (tokenul lipsă → nu se poate cota → 0, deci nimic nu se vinde fals). */
const priceOf = (s: State, tokenId: string) => s.tokens.find((k) => k.id === tokenId)?.priceUsd ?? 0;

/** Tokenurile păstrate: watchlist, cele cu poziții sau ordine, cel ales; restul se taie la MAX_TOKENS. */
function trimTokens(s: State, tokens: Token[]): Token[] {
  if (tokens.length <= MAX_TOKENS) return tokens;
  const keep = new Set([...s.watchlist, ...s.trades.filter((t) => t.closedAt === undefined).map((t) => t.tokenId), ...s.orders.filter((o) => o.status === "open").map((o) => o.tokenId), s.selectedId]);
  const extra = tokens.filter((t) => !keep.has(t.id));
  const drop = new Set(extra.slice(0, tokens.length - MAX_TOKENS).map((t) => t.id));
  return tokens.filter((t) => !drop.has(t.id));
}

function step(s: State, a: Action): State {
  const id = ids(s.seq);
  switch (a.type) {
    case "tick": {
      const dt = Math.max(0, Math.min(10, a.dtSec));
      if (!s.settings.liveTick) return settle(s, { ...s, now: a.now }, id);
      const r = seeded(s.seed);
      const tokens = stepDemo(s.tokens, dt, r, a.now);
      return settle(s, { ...s, now: a.now, tokens, seed: Math.floor(r() * 2 ** 32) }, id);
    }
    case "livePatch": {
      if (!s.settings.liveTick) return s;
      const tokens = s.tokens.map((t) => {
        const p = a.patches[t.id];
        if (!p || t.source !== "live" || !(p.priceUsd > 0)) return t;
        const metrics = { ...t.metrics };
        for (const [k, v] of Object.entries(p.metrics)) if (v !== undefined && Number.isFinite(v)) (metrics as Record<string, number>)[k] = v;
        return {
          ...t, priceUsd: p.priceUsd, change1hPct: p.change1hPct, change5mPct: p.change5mPct ?? t.change5mPct, volume1hUsd: p.volume1hUsd ?? t.volume1hUsd,
          txns5m: p.txns5m ?? t.txns5m, pairAddress: t.pairAddress ?? p.pairAddress, metrics, socials: p.socials ?? t.socials, imageUrl: t.imageUrl ?? p.imageUrl, updatedAt: s.now,
        };
      });
      return settle(s, { ...s, tokens }, id);
    }
    case "feed":
      return { ...s, feed: a.ok ? { ...s.feed, okAt: s.now } : { ...s.feed, errAt: s.now } };
    case "enrich":
      return { ...s, tokens: s.tokens.map((t) => (t.id === a.id ? { ...t, ...a.patch, metrics: { ...t.metrics, ...a.patch.metrics }, flags: { ...t.flags, ...a.patch.flags } } : t)) };
    case "chain":
      if (a.chain === s.chain) return s;
      return { ...s, chain: a.chain, eph: freshEph(s.eph.undo), draft: { ...freshDraft(s.draft), amount: String(NATIVE_PRESETS[a.chain][1]) } };
    case "select":
      if (a.id === s.selectedId || !s.tokens.some((t) => t.id === a.id)) return s;
      return { ...s, selectedId: a.id, draft: freshDraft(s.draft), eph: { ...s.eph, confirm: null, sellConfirm: null } };
    case "addToken": {
      const exists = s.tokens.some((t) => t.id === a.token.id);
      const tokens = exists
        ? s.tokens.map((t) => (t.id === a.token.id ? { ...t, ...a.token, metrics: { ...t.metrics, ...a.token.metrics }, flags: { ...t.flags, ...a.token.flags }, updatedAt: s.now } : t))
        : [...s.tokens, { ...a.token, updatedAt: s.now }];
      const changed = a.token.id !== s.selectedId;
      return {
        ...s, tokens: trimTokens(s, tokens), selectedId: a.token.id, chain: a.token.source === "live" ? a.token.chain : s.chain,
        draft: changed ? { ...freshDraft(s.draft), side: "buy", amount: a.amount ?? s.draft.amount } : { ...s.draft, side: "buy", amount: a.amount ?? s.draft.amount },
        eph: changed ? { ...s.eph, confirm: null, sellConfirm: null } : s.eph,
      };
    }
    case "star": {
      const on = s.watchlist.includes(a.token.id);
      const tokens = s.tokens.some((t) => t.id === a.token.id) ? s.tokens : [...s.tokens, { ...a.token, updatedAt: s.now }];
      return { ...s, tokens: on ? s.tokens : trimTokens(s, tokens), watchlist: on ? s.watchlist.filter((x) => x !== a.token.id) : [...s.watchlist, a.token.id] };
    }
    case "draft": {
      const draft = { ...s.draft, ...a.patch };
      // o confirmare veche nu acoperă o sumă sau o teză nouă
      const touched = a.patch.amount !== undefined || a.patch.thesis !== undefined || a.patch.orderType !== undefined || a.patch.limitPrice !== undefined;
      return { ...s, draft, eph: touched && s.eph.confirm ? { ...s.eph, confirm: null } : s.eph };
    }
    case "buy": {
      if (a.nonce === s.eph.lastNonce) return s; // dublu declanșator
      const s1 = { ...s, eph: { ...s.eph, lastNonce: a.nonce } };
      const token = selected(s1);
      if (!token || token.id !== a.tokenId) {
        return { ...s1, toasts: pushToast(s1, id("n"), "Tokenul s-a schimbat între previzualizare și execuție. Nimic executat.", "warn") };
      }
      const sizeUsd = draftUsd(s1, token.chain);
      const view = assessBuy(buyInput(s1, token, sizeUsd, s1.draft.thesis, a.snapshotPrice));
      const d = view.decision;
      if (d.severity === "block") return { ...s1, brakeHits: s1.brakeHits + 1, toasts: pushToast(s1, id("n"), d.reasons[0], "warn") };
      if (d.requiresConfirmation) {
        const confirm: PendingBuy = { id: id("c"), tokenId: token.id, sizeUsd, snapshotPrice: d.snapshotPrice, severity: d.severity, reasons: d.reasons, recommendedAction: d.recommendedAction };
        return { ...s1, brakeHits: s1.brakeHits + 1, eph: { ...s1.eph, confirm } };
      }
      return execute(s1, id, token, sizeUsd, view, false);
    }
    case "confirmBuy": {
      const c = s.eph.confirm;
      if (!c || c.id !== a.id) return s; // dublu click sau confirmare expirată
      const token = selected(s);
      if (!token || token.id !== c.tokenId) {
        return { ...s, eph: { ...s.eph, confirm: null }, toasts: pushToast(s, id("n"), "Tokenul s-a schimbat în timpul confirmării. Nimic executat.", "warn") };
      }
      const sizeUsd = draftUsd(s, token.chain);
      const view = assessBuy(buyInput(s, token, sizeUsd, s.draft.thesis, c.snapshotPrice));
      const d = view.decision;
      if (d.severity === "block") return { ...s, eph: { ...s.eph, confirm: null }, toasts: pushToast(s, id("n"), d.reasons[0], "warn") };
      if (d.requote || Math.abs(sizeUsd - c.sizeUsd) > 0.005) {
        const confirm: PendingBuy = { id: id("c"), tokenId: token.id, sizeUsd, snapshotPrice: d.snapshotPrice, severity: d.severity, reasons: d.reasons, recommendedAction: d.recommendedAction };
        const moved = fmtPct((token.priceUsd / c.snapshotPrice - 1) * 100);
        return { ...s, eph: { ...s.eph, confirm }, toasts: pushToast(s, id("n"), `Prețul s-a mișcat ${moved} de la confirmare. Reconfirmă la prețul nou.`, "warn") };
      }
      return execute(s, id, token, sizeUsd, view, true);
    }
    case "cancelBuy":
      return s.eph.confirm ? { ...s, eph: { ...s.eph, confirm: null } } : s;
    case "cancelOrder":
      return { ...s, orders: s.orders.map((o) => (o.id === a.id && o.status === "open" ? { ...o, status: "cancelled", note: "anulat de tine" } : o)) };
    case "sell":
    case "sellToken": {
      // Ieșirea nu se blochează niciodată. Doar Sell 100% pe o poziție mare cere o confirmare vizibilă.
      if (!Number.isFinite(a.pct) || a.pct <= 0) return s;
      const pct = Math.min(100, a.pct);
      const key = a.type === "sell" ? a.tradeId : a.tokenId;
      const match = (t: Trade) => t.closedAt === undefined && (a.type === "sell" ? t.id === a.tradeId : t.tokenId === a.tokenId);
      const targets = s.trades.filter(match);
      if (!targets.length) return s;
      const value = targets.reduce((sum, t) => sum + positionValue(t, priceOf(s, t.tokenId)), 0);
      if (!a.confirmed && needsSellConfirm(pct, value, s.bankrollUsd, s.settings.bigPositionPct)) return { ...s, eph: { ...s.eph, sellConfirm: key } };
      const next = { ...s, eph: { ...s.eph, sellConfirm: null }, trades: s.trades.map((t) => (match(t) ? sellPart(t, priceOf(s, t.tokenId), s.now, pct) : t)) };
      return settle(s, next, id);
    }
    case "cancelSell":
      return s.eph.sellConfirm ? { ...s, eph: { ...s.eph, sellConfirm: null } } : s;
    case "editExit":
      return { ...s, trades: s.trades.map((t) => {
        if (t.id !== a.tradeId || t.closedAt !== undefined) return t;
        // stopul se poate doar strânge, niciodată lărgi după intrare
        const slPct = a.slPct !== undefined && Number.isFinite(a.slPct) ? Math.min(t.slPct, Math.max(1, a.slPct)) : t.slPct;
        const tpPct = a.tpPct !== undefined && Number.isFinite(a.tpPct) ? Math.max(1, a.tpPct) : t.tpPct;
        const trailPct = a.trailPct !== undefined && Number.isFinite(a.trailPct) ? Math.min(90, Math.max(0, a.trailPct)) : t.trailPct;
        return { ...t, slPct, tpPct, trailPct };
      }) };
    case "toggle2x":
      return { ...s, trades: s.trades.map((t) => (t.id === a.tradeId && t.closedAt === undefined && !t.recovered ? { ...t, auto2x: !t.auto2x } : t)) };
    case "noteTrade":
      return { ...s, trades: s.trades.map((t) => (t.id === a.tradeId ? { ...t, note: a.note.slice(0, 280) } : t)) };
    case "rule": {
      const has = s.rules.some((r) => r.id === a.rule.id);
      return { ...s, rules: has ? s.rules.map((r) => (r.id === a.rule.id ? a.rule : r)) : [...s.rules, a.rule] };
    }
    case "removeRule":
      return { ...s, rules: s.rules.filter((r) => r.id !== a.id) };
    case "addIdea":
      return { ...s, ideas: [{ id: id("i"), text: a.text, createdAt: s.now }, ...s.ideas] };
    case "removeIdea":
      return { ...s, ideas: s.ideas.filter((i) => i.id !== a.id) };
    case "addAlert": {
      const token = selected(s);
      if (!token || !(a.price > 0)) return s;
      return { ...s, alerts: [...s.alerts, { id: id("a"), tokenId: token.id, symbol: token.symbol, op: a.op, price: a.price, createdAt: s.now }] };
    }
    case "removeAlert":
      return { ...s, alerts: s.alerts.filter((x) => x.id !== a.id) };
    case "track":
      if (s.tracked.some((w) => w.address === a.address)) return s;
      return { ...s, tracked: [...s.tracked, { address: a.address, label: a.label, addedAt: s.now }] };
    case "untrack":
      return { ...s, tracked: s.tracked.filter((w) => w.address !== a.address) };
    case "settings": {
      const patch = Object.fromEntries(Object.entries(a.patch).filter(([, v]) => typeof v !== "number" || (Number.isFinite(v) && v >= 0)));
      const execTouched = "slippageBps" in patch || "priorityFeeSol" in patch;
      return { ...s, settings: { ...s.settings, ...patch, ...(execTouched ? { preset: "advanced" as const } : {}) } };
    }
    case "preset":
      return { ...s, settings: a.preset === "advanced" ? { ...s.settings, preset: "advanced" } : { ...s.settings, preset: a.preset, slippageBps: PRESETS[a.preset].slippageBps, priorityFeeSol: PRESETS[a.preset].priorityFeeSol } };
    case "mode":
      return a.mode === s.mode ? s : { ...s, mode: a.mode, eph: { ...s.eph, confirm: null } };
    case "dismiss":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "natives": {
      const prices = { ...s.natives };
      for (const c of Object.keys(prices) as Chain[]) if (a.prices[c] > 0) prices[c] = a.prices[c];
      // un cont DEMO neatins pornește cu exact 10 SOL la prețul real
      const pristine = s.trades.length === 0 && s.cashUsd === s.bankrollUsd && s.cashUsd === DEMO_SOL * s.natives.solana;
      return pristine ? { ...s, natives: prices, cashUsd: DEMO_SOL * prices.solana, bankrollUsd: DEMO_SOL * prices.solana } : { ...s, natives: prices };
    }
    case "radarFilter": {
      if (a.filter === null) return { ...s, eph: { ...s.eph, radarFilters: [] } };
      const f = a.filter;
      const has = s.eph.radarFilters.includes(f);
      return { ...s, eph: { ...s.eph, radarFilters: has ? s.eph.radarFilters.filter((x) => x !== f) : [...s.eph.radarFilters, f] } };
    }
    case "xQuery":
      return { ...s, eph: { ...s.eph, xQuery: a.q.slice(0, 80) } };
    case "tilt":
      return a.act === "hide"
        ? { ...s, tiltHiddenDay: dayKey(s.now) }
        : { ...s, draft: { ...s.draft, amount: String(NATIVE_PRESETS[selected(s)?.chain ?? s.chain][0]) } };
    case "resetDemo": {
      const cash = DEMO_SOL * s.natives.solana;
      return {
        ...s, cashUsd: cash, bankrollUsd: cash, trades: [], orders: [], alerts: [], brakeHits: 0, tiltHiddenDay: null,
        draft: freshDraft(s.draft), eph: freshEph(durableOf(s)),
        toasts: pushToast({ ...s, toasts: [] }, id("n"), `Demo resetat: ${DEMO_SOL} SOL, fără poziții.`, "info", "undoReset"),
      };
    }
    case "undoReset": {
      const u = s.eph.undo;
      if (!u) return s;
      return { ...s, ...u, eph: freshEph(), draft: freshDraft(s.draft), toasts: pushToast({ ...s, toasts: [] }, id("n"), "Reset anulat: portofoliul e înapoi.", "good") };
    }
    case "import": {
      const r = parseImport(a.text);
      if (!r.ok) return { ...s, toasts: pushToast(s, id("n"), `Import respins: ${r.error}`, "bad") };
      const tokens = r.data.tokens.length ? r.data.tokens : s.tokens;
      const selectedId = r.data.selectedId && tokens.some((t) => t.id === r.data.selectedId) ? r.data.selectedId : tokens[0]?.id ?? null;
      return { ...s, ...r.data, tokens, selectedId, eph: freshEph(), draft: freshDraft(s.draft), toasts: pushToast(s, id("n"), `Import reușit: ${r.data.trades.length} trade-uri.`, "good") };
    }
  }
}

/** Reducerul public: pur. `seq` crește doar când starea s-a schimbat; numerarul urmează mereu registrul. */
export function reducer(s: State, a: Action): State {
  let r = step(s, a);
  if (r === s) return s;
  if (r.trades !== s.trades && a.type !== "resetDemo" && a.type !== "undoReset" && a.type !== "import") r = { ...r, cashUsd: syncCash(s, r) };
  return { ...r, seq: s.seq + 1 };
}

// ---------- hook: marginile (ceas, rețea, localStorage, notificări) ----------

export function useCockpit() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* stocare indisponibilă */ }
    return hydrate(raw, Date.now());
  });
  const ref = useRef(state);
  ref.current = state;
  const liveTick = state.settings.liveTick;

  // ceasul: o bătaie pe secundă, cu ora reală
  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: "tick", now: Date.now(), dtSec: 1 }), 1000);
    return () => window.clearInterval(id);
  }, []);

  // prețuri reale la 5 s (doar cu Live Tick pornit); prețul monedelor native la 5 min
  useEffect(() => {
    if (!liveTick) return;
    let stop = false;
    const poll = async () => {
      const live = ref.current.tokens.filter((t) => t.source === "live");
      if (!live.length) return;
      try {
        const patches = await marketData.refresh(live);
        if (!stop) { dispatch({ type: "livePatch", patches }); dispatch({ type: "feed", ok: true }); }
      } catch { if (!stop) dispatch({ type: "feed", ok: false }); }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => { stop = true; window.clearInterval(id); };
  }, [liveTick]);

  useEffect(() => {
    let stop = false;
    const load = () => marketData.natives().then((prices) => !stop && dispatch({ type: "natives", prices })).catch(() => undefined);
    load();
    const id = window.setInterval(load, 300_000);
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  // holderi, autorități și RugCheck pentru tokenul selectat
  const sel = selected(state);
  useEffect(() => {
    const t = ref.current.tokens.find((x) => x.id === ref.current.selectedId);
    if (!t || t.source !== "live" || (t.holdersDist && (t.rug || t.chain !== "solana"))) return;
    let stop = false;
    security.enrich(t).then((patch) => !stop && dispatch({ type: "enrich", id: t.id, patch })).catch(() => undefined);
    return () => { stop = true; };
  }, [sel?.id]);

  // salvarea: aceeași schemă ca exportul, cel mult o dată la 2 s
  const saved = useRef("");
  useEffect(() => {
    const id = window.setInterval(() => {
      const text = exportDurable(durableOf(ref.current), 0);
      if (text === saved.current) return;
      saved.current = text;
      try { localStorage.setItem(STORAGE_KEY, text); } catch { /* plin sau blocat: rămâne în memorie */ }
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  // toasturile dispar singure; notificări de sistem doar dacă utilizatorul le-a activat
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const t of state.toasts) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      if (state.settings.notifications && document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Cockpit", { body: t.text });
      }
      window.setTimeout(() => dispatch({ type: "dismiss", id: t.id }), t.action ? 10_000 : 6000);
    }
    if (seen.current.size > 200) seen.current = new Set(state.toasts.map((t) => t.id));
  }, [state.toasts, state.settings.notifications]);

  return [state, dispatch] as const;
}
