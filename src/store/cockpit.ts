// Starea aplicației: un reducer + persistență locală.
// Mai târziu: aceeași formă în Supabase (rules, ideas, trades, orders, alerts, settings), RLS pe user_id.

import { useEffect, useReducer, useRef } from "react";
import type { Idea, LimitOrder, PriceAlert, Rule, Settings, ThesisTag, Token, Trade } from "../domain/types";
import { DEFAULT_BANKROLL, DEFAULT_RULES, DEFAULT_SETTINGS } from "../domain/defaults";
import { buyGate, evaluateSession, evaluateToken, fmtUsd, DEFAULT_EXIT } from "../domain/rules";
import { applyExitPlan, paperBuy, sellPart } from "../execution/executor";
import { market } from "../data/market";
import type { LivePatch } from "../data/live";
import { solPriceUsd } from "../data/live";

export interface Draft {
  thesis: string;
  tag: ThesisTag;
  sizeUsd: number;
  ack: boolean;
  orderType: "market" | "limit";
  limitPrice: string;
}

export interface Toast { id: string; text: string; tone: "info" | "good" | "bad" | "warn"; at: number }

export interface State {
  bankrollUsd: number;
  rules: Rule[];
  ideas: Idea[];
  trades: Trade[];
  orders: LimitOrder[];
  alerts: PriceAlert[];
  settings: Settings;
  tokens: Token[];
  selectedId: string | null;
  draft: Draft;
  toasts: Toast[];
  now: number;
  speed: number;
  solUsd: number;
}

export type Action =
  | { type: "tick"; dtSec: number }
  | { type: "livePatch"; patches: Record<string, LivePatch> }
  | { type: "enrich"; id: string; patch: Partial<Token> }
  | { type: "select"; id: string }
  | { type: "addToken"; token: Token }
  | { type: "removeToken"; id: string }
  | { type: "draft"; patch: Partial<Draft> }
  | { type: "buy" }
  | { type: "placeOrder" }
  | { type: "cancelOrder"; id: string }
  | { type: "sell"; tradeId: string; pct: number }
  | { type: "editExit"; tradeId: string; tpPct?: number; slPct?: number; trailPct?: number }
  | { type: "rule"; rule: Rule }
  | { type: "removeRule"; id: string }
  | { type: "addIdea"; text: string }
  | { type: "removeIdea"; id: string }
  | { type: "addAlert"; op: "above" | "below"; price: number }
  | { type: "removeAlert"; id: string }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "bankroll"; usd: number }
  | { type: "dismiss"; id: string }
  | { type: "speed"; speed: number }
  | { type: "solUsd"; usd: number }
  | { type: "resetDay" }
  | { type: "resetAll" };

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "cockpit.v2";
const PERSIST = ["bankrollUsd", "rules", "ideas", "trades", "orders", "alerts", "settings", "tokens", "selectedId"] as const;

function base(): State {
  const tokens = market.watchlist();
  return {
    bankrollUsd: DEFAULT_BANKROLL,
    rules: DEFAULT_RULES,
    ideas: [
      { id: uid(), text: "Intru doar pe tokenuri care au supraviețuit primelor 30 de minute după migrare.", createdAt: Date.now() },
      { id: uid(), text: "Dacă un token a făcut deja ×3 în ultima oră, am întârziat.", createdAt: Date.now() },
    ],
    trades: [], orders: [], alerts: [],
    settings: DEFAULT_SETTINGS,
    tokens,
    selectedId: tokens[0].id,
    draft: { thesis: "", tag: "narativă", sizeUsd: 50, ack: false, orderType: "market", limitPrice: "" },
    toasts: [],
    now: Date.now(),
    speed: 1,
    solUsd: 150,
  };
}

function initial(): State {
  const s = base();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State>;
      const merged = { ...s, ...saved, settings: { ...s.settings, ...saved.settings } };
      // regulile vechi de ieșire fără trailing primesc valoarea implicită
      merged.rules = merged.rules.map((r) => (r.kind === "exit" ? { ...DEFAULT_EXIT, ...r } : r));
      return merged;
    }
  } catch { /* stare coruptă: pornim curat */ }
  return s;
}

const toast = (s: State, text: string, tone: Toast["tone"] = "info"): Toast[] =>
  [...s.toasts, { id: uid(), text, tone, at: Date.now() }].slice(-4);

function execCfg(s: State) {
  return { platformFeeBps: 0, slippageBps: s.settings.slippageBps, priorityFeeUsd: s.settings.priorityFeeSol * s.solUsd };
}

function openTrade(s: State, token: Token, sizeUsd: number, thesis: Trade["thesis"], ack: boolean): Trade {
  const exit = (s.rules.find((r) => r.kind === "exit") ?? DEFAULT_EXIT) as typeof DEFAULT_EXIT;
  const exec = execCfg(s);
  const fill = paperBuy(token.priceUsd, sizeUsd, exec);
  return {
    id: uid(), day: dayKey(s.now), tokenId: token.id, symbol: token.symbol, ca: token.ca,
    sizeUsd, feeUsd: fill.feeUsd, entryPrice: fill.price, qty: fill.qty, remainingQty: fill.qty,
    realizedUsd: 0, tpPct: exit.tpPct, slPct: exit.slPct, partialPct: exit.partialPct, maxHoldMin: exit.maxHoldMin,
    tpHit: false, trailPct: exit.trailPct, peakPrice: fill.price, exec,
    openedAt: s.now, thesis, checksAtEntry: evaluateToken(token, s.rules), acceptedWarnings: ack, mode: "paper",
  };
}

const REASON: Record<string, string> = { tp: "take profit", sl: "stop loss", breakeven: "stop la intrare", trailing: "trailing stop", timp: "timp expirat", manual: "vândut" };

/** Prețuri noi → ieșiri automate, ordine limită, alerte, notificări de cooldown. */
function settle(prev: State, next: State): State {
  const price = new Map(next.tokens.map((t) => [t.id, t.priceUsd]));
  let s = { ...next, trades: next.trades.map((t) => (t.closedAt === undefined ? applyExitPlan(t, price.get(t.tokenId) ?? t.entryPrice, next.now) : t)) };

  for (const t of s.trades) {
    const before = next.trades.find((x) => x.id === t.id);
    if (before && before.closedAt === undefined && t.closedAt !== undefined) {
      const pnl = t.pnlUsd ?? 0;
      s = { ...s, toasts: toast(s, `${t.symbol}: ${REASON[t.exitReason!]}, ${pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(pnl))}`, pnl >= 0 ? "good" : "bad") };
    } else if (before && !before.tpHit && t.tpHit && t.closedAt === undefined) {
      s = { ...s, toasts: toast(s, `${t.symbol}: TP atins, ${t.partialPct}% vândut. Restul are stop ${t.trailPct ? `trailing ${t.trailPct}%` : "la intrare"}.`, "good") };
    }
  }

  // ordine limită: la declanșare, poarta se verifică din nou cu starea de acum
  const day = dayKey(s.now);
  for (const o of s.orders) {
    if (o.status !== "open") continue;
    const token = s.tokens.find((t) => t.id === o.tokenId);
    if (s.now >= o.expiresAt) {
      s = { ...s, orders: s.orders.map((x) => (x.id === o.id ? { ...x, status: "expired" } : x)), toasts: toast(s, `Ordinul pe ${o.symbol} a expirat.`) };
      continue;
    }
    if (!token || token.priceUsd > o.triggerPrice) continue;
    const session = evaluateSession(s.rules, s.trades, s.bankrollUsd, day, s.now);
    const gate = buyGate({ token, checks: evaluateToken(token, s.rules), session, bankrollUsd: s.bankrollUsd, sizeUsd: o.sizeUsd, thesisText: o.thesis.text, ack: o.acceptedWarnings, now: s.now });
    if (!gate.allowed) {
      const note = gate.blockers[0] ?? "atenționări noi neconfirmate";
      s = { ...s, orders: s.orders.map((x) => (x.id === o.id ? { ...x, status: "cancelled", note } : x)), toasts: toast(s, `Ordinul pe ${o.symbol} anulat: ${note}`, "warn") };
      continue;
    }
    const trade = openTrade(s, token, o.sizeUsd, o.thesis, o.acceptedWarnings);
    s = { ...s, trades: [...s.trades, trade], orders: s.orders.map((x) => (x.id === o.id ? { ...x, status: "filled" } : x)), toasts: toast(s, `Ordin executat: ${o.symbol} ${fmtUsd(o.sizeUsd)}`, "good") };
  }

  for (const a of s.alerts) {
    if (a.firedAt) continue;
    const p = price.get(a.tokenId);
    if (p === undefined) continue;
    if ((a.op === "above" && p >= a.price) || (a.op === "below" && p <= a.price)) {
      s = { ...s, alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, firedAt: s.now } : x)), toasts: toast(s, `Alertă ${a.symbol}: prețul e ${a.op === "above" ? "peste" : "sub"} ${a.price.toPrecision(4)} $`, "info") };
    }
  }

  const was = evaluateSession(prev.rules, prev.trades, prev.bankrollUsd, dayKey(prev.now), prev.now).state;
  const is = evaluateSession(s.rules, s.trades, s.bankrollUsd, day, s.now).state;
  if (was !== "cooldown" && is === "cooldown") s = { ...s, toasts: toast(s, "Cooldown pornit. Ia o pauză, regulile de sesiune sunt blocate.", "warn") };
  if (was === "cooldown" && is === "active") s = { ...s, toasts: toast(s, "Pauza s-a terminat. Poți tranzacționa din nou.", "info") };
  return s;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "tick": {
      const now = s.now + a.dtSec * 1000;
      return settle(s, { ...s, now, tokens: market.step(s.tokens, a.dtSec) });
    }
    case "livePatch": {
      const tokens = s.tokens.map((t) => {
        const p = a.patches[t.ca];
        if (!p || t.source !== "live") return t;
        const metrics = { ...t.metrics };
        for (const [k, v] of Object.entries(p.metrics)) if (v !== undefined) (metrics as Record<string, number>)[k] = v;
        return { ...t, priceUsd: p.priceUsd, change1hPct: p.change1hPct, volume1hUsd: p.volume1hUsd, pairAddress: t.pairAddress ?? p.pairAddress, metrics, updatedAt: Date.now() };
      });
      return settle(s, { ...s, tokens });
    }
    case "enrich":
      return { ...s, tokens: s.tokens.map((t) => (t.id === a.id ? { ...t, ...a.patch, metrics: { ...t.metrics, ...a.patch.metrics }, flags: { ...t.flags, ...a.patch.flags } } : t)) };
    case "select":
      return { ...s, selectedId: a.id, draft: { ...s.draft, thesis: "", ack: false, limitPrice: "" } };
    case "addToken": {
      const exists = s.tokens.some((t) => t.id === a.token.id);
      return { ...s, tokens: exists ? s.tokens : [...s.tokens, a.token], selectedId: a.token.id, draft: { ...s.draft, thesis: "", ack: false, limitPrice: "" } };
    }
    case "removeToken": {
      const busy = s.trades.some((t) => t.tokenId === a.id && t.closedAt === undefined) || s.orders.some((o) => o.tokenId === a.id && o.status === "open");
      if (busy) return { ...s, toasts: toast(s, "Are o poziție sau un ordin deschis; închide-l întâi.", "warn") };
      const tokens = s.tokens.filter((t) => t.id !== a.id);
      return { ...s, tokens, selectedId: s.selectedId === a.id ? tokens[0]?.id ?? null : s.selectedId };
    }
    case "draft":
      return { ...s, draft: { ...s.draft, ...a.patch } };
    case "buy": {
      // Poarta e verificată în UI; reducerul nu deschide nimic fără token și teză.
      const token = s.tokens.find((t) => t.id === s.selectedId);
      if (!token || !s.draft.thesis.trim()) return s;
      const trade = openTrade(s, token, s.draft.sizeUsd, { text: s.draft.thesis.trim(), tag: s.draft.tag }, s.draft.ack);
      return { ...s, trades: [...s.trades, trade], draft: { ...s.draft, thesis: "", ack: false }, toasts: toast(s, `Cumpărat ${token.symbol} ${fmtUsd(s.draft.sizeUsd)} (hârtie)`, "info") };
    }
    case "placeOrder": {
      const token = s.tokens.find((t) => t.id === s.selectedId);
      const trigger = parseFloat(s.draft.limitPrice.replace(",", "."));
      if (!token || !s.draft.thesis.trim() || !(trigger > 0)) return s;
      const o: LimitOrder = {
        id: uid(), tokenId: token.id, symbol: token.symbol, triggerPrice: trigger, sizeUsd: s.draft.sizeUsd,
        thesis: { text: s.draft.thesis.trim(), tag: s.draft.tag }, acceptedWarnings: s.draft.ack,
        createdAt: s.now, expiresAt: s.now + s.settings.orderTtlMin * 60_000, status: "open",
      };
      return { ...s, orders: [...s.orders, o], draft: { ...s.draft, thesis: "", ack: false, limitPrice: "" }, toasts: toast(s, `Ordin limită pus pe ${token.symbol} la ${trigger.toPrecision(4)} $`) };
    }
    case "cancelOrder":
      return { ...s, orders: s.orders.map((o) => (o.id === a.id && o.status === "open" ? { ...o, status: "cancelled", note: "anulat de tine" } : o)) };
    case "sell": {
      // Ieșirea nu se blochează niciodată.
      const next = { ...s, trades: s.trades.map((t) => {
        if (t.id !== a.tradeId || t.closedAt !== undefined) return t;
        const p = s.tokens.find((k) => k.id === t.tokenId)?.priceUsd ?? t.entryPrice;
        return sellPart(t, p, s.now, a.pct);
      }) };
      return settle(s, next);
    }
    case "editExit": {
      return { ...s, trades: s.trades.map((t) => {
        if (t.id !== a.tradeId || t.closedAt !== undefined) return t;
        // stopul se poate doar strânge, niciodată lărgi după intrare
        const slPct = a.slPct !== undefined ? Math.min(t.slPct, Math.max(1, a.slPct)) : t.slPct;
        return { ...t, slPct, tpPct: a.tpPct !== undefined ? Math.max(1, a.tpPct) : t.tpPct, trailPct: a.trailPct !== undefined ? Math.max(0, a.trailPct) : t.trailPct };
      }) };
    }
    case "rule": {
      const has = s.rules.some((r) => r.id === a.rule.id);
      return { ...s, rules: has ? s.rules.map((r) => (r.id === a.rule.id ? a.rule : r)) : [...s.rules, a.rule] };
    }
    case "removeRule":
      return { ...s, rules: s.rules.filter((r) => r.id !== a.id) };
    case "addIdea":
      return { ...s, ideas: [{ id: uid(), text: a.text, createdAt: s.now }, ...s.ideas] };
    case "removeIdea":
      return { ...s, ideas: s.ideas.filter((i) => i.id !== a.id) };
    case "addAlert": {
      const token = s.tokens.find((t) => t.id === s.selectedId);
      if (!token) return s;
      return { ...s, alerts: [...s.alerts, { id: uid(), tokenId: token.id, symbol: token.symbol, op: a.op, price: a.price, createdAt: s.now }] };
    }
    case "removeAlert":
      return { ...s, alerts: s.alerts.filter((x) => x.id !== a.id) };
    case "settings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "bankroll":
      return { ...s, bankrollUsd: a.usd };
    case "dismiss":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "speed":
      return { ...s, speed: a.speed };
    case "solUsd":
      return { ...s, solUsd: a.usd };
    case "resetDay":
      return { ...s, trades: s.trades.filter((t) => t.day !== dayKey(s.now)), orders: s.orders.filter((o) => o.status !== "open") };
    case "resetAll":
      localStorage.removeItem(KEY);
      return base();
  }
}

export function useCockpit() {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const ref = useRef(state);
  ref.current = state;

  // ceasul simulării
  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: "tick", dtSec: state.speed }), 1000);
    return () => window.clearInterval(id);
  }, [state.speed]);

  // prețuri reale: la 5 s pentru tokenurile reale din listă
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const cas = ref.current.tokens.filter((t) => t.source === "live").map((t) => t.ca);
      if (!cas.length) return;
      try {
        const patches = await market.refresh(cas);
        if (!stop) dispatch({ type: "livePatch", patches });
      } catch { /* rețea: încercăm la pasul următor */ }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    solPriceUsd().then((usd) => !stop && dispatch({ type: "solUsd", usd }));
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  // holderi și autorități pentru tokenul selectat
  useEffect(() => {
    const t = state.tokens.find((x) => x.id === state.selectedId);
    if (!t || t.source !== "live" || t.holdersDist) return;
    let stop = false;
    market.enrich(t).then((patch) => !stop && dispatch({ type: "enrich", id: t.id, patch })).catch(() => undefined);
    return () => { stop = true; };
  }, [state.selectedId, state.tokens.length]);

  useEffect(() => {
    const out: Record<string, unknown> = {};
    for (const k of PERSIST) out[k] = state[k];
    localStorage.setItem(KEY, JSON.stringify(out));
  }, PERSIST.map((k) => state[k]));

  // notificări de sistem, doar dacă utilizatorul le-a activat
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const t of state.toasts) {
      if (seen.current.has(t.id)) continue;
      seen.current.add(t.id);
      if (state.settings.notifications && document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Cockpit", { body: t.text });
      }
      window.setTimeout(() => dispatch({ type: "dismiss", id: t.id }), 6000);
    }
  }, [state.toasts, state.settings.notifications]);

  return [state, dispatch] as const;
}
