// Starea aplicației: un reducer + persistență locală.
// Mai târziu: aceeași formă în Supabase (rules, ideas, trades, orders, alerts, settings), RLS pe user_id.

import { useEffect, useReducer, useRef } from "react";
import type { Chain, Idea, LimitOrder, PriceAlert, Rule, Settings, ThesisTag, Token, TrackedWallet, Trade } from "../domain/types";
import { DEFAULT_BANKROLL, DEFAULT_RULES, DEFAULT_SETTINGS } from "../domain/defaults";
import { buyGate, evaluateSession, evaluateToken, fmtUsd, DEFAULT_EXIT } from "../domain/rules";
import { applyExitPlan, paperBuy, sellPart } from "../execution/executor";
import { market } from "../data/market";
import type { LivePatch } from "../data/live";

export interface Draft {
  side: "buy" | "sell";
  /** suma în moneda nativă a rețelei (SOL / ETH / BNB), ca text editabil */
  amount: string;
  thesis: string;
  tag: ThesisTag;
  ack: boolean;
  orderType: "market" | "limit";
  limitPrice: string;
  /** TP automat din regula de ieșire; stopul rămâne mereu activ */
  autoTp: boolean;
}

export interface Toast { id: string; text: string; tone: "info" | "good" | "bad" | "warn"; at: number }

export interface State {
  chain: Chain;
  bankrollUsd: number;
  rules: Rule[];
  ideas: Idea[];
  trades: Trade[];
  orders: LimitOrder[];
  alerts: PriceAlert[];
  settings: Settings;
  tokens: Token[];
  selectedId: string | null;
  tracked: TrackedWallet[];
  wallet: { connected: boolean; label: string };
  draft: Draft;
  toasts: Toast[];
  now: number;
  speed: number;
  natives: Record<Chain, number>;
}

export type Action =
  | { type: "tick"; dtSec: number }
  | { type: "livePatch"; patches: Record<string, LivePatch> }
  | { type: "enrich"; id: string; patch: Partial<Token> }
  | { type: "chain"; chain: Chain }
  | { type: "select"; id: string }
  | { type: "addToken"; token: Token; amount?: string }
  | { type: "removeToken"; id: string }
  | { type: "draft"; patch: Partial<Draft> }
  | { type: "buy" }
  | { type: "placeOrder" }
  | { type: "cancelOrder"; id: string }
  | { type: "sell"; tradeId: string; pct: number }
  | { type: "sellToken"; tokenId: string; pct: number }
  | { type: "editExit"; tradeId: string; tpPct?: number; slPct?: number; trailPct?: number }
  | { type: "rule"; rule: Rule }
  | { type: "removeRule"; id: string }
  | { type: "addIdea"; text: string }
  | { type: "removeIdea"; id: string }
  | { type: "addAlert"; op: "above" | "below"; price: number }
  | { type: "removeAlert"; id: string }
  | { type: "track"; address: string; label: string }
  | { type: "untrack"; address: string }
  | { type: "wallet"; connected: boolean }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "bankroll"; usd: number }
  | { type: "dismiss"; id: string }
  | { type: "speed"; speed: number }
  | { type: "natives"; prices: Record<Chain, number> }
  | { type: "resetDay" }
  | { type: "resetAll" };

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const KEY = "cockpit.v3";
const PERSIST = ["chain", "bankrollUsd", "rules", "ideas", "trades", "orders", "alerts", "settings", "tokens", "selectedId", "tracked", "wallet"] as const;

export const NATIVE_PRESETS: Record<Chain, number[]> = { solana: [0.1, 0.5, 1, 5], base: [0.005, 0.01, 0.05, 0.1], bsc: [0.01, 0.05, 0.1, 0.5] };

function base(): State {
  const tokens = market.watchlist();
  return {
    chain: "solana",
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
    tracked: [],
    wallet: { connected: false, label: "Portofel de hârtie" },
    draft: { side: "buy", amount: "0.5", thesis: "", tag: "narativă", ack: false, orderType: "market", limitPrice: "", autoTp: true },
    toasts: [],
    now: Date.now(),
    speed: 1,
    natives: { solana: 150, base: 3000, bsc: 600 },
  };
}

function initial(): State {
  const s = base();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State>;
      const merged = { ...s, ...saved, settings: { ...s.settings, ...saved.settings } };
      merged.rules = merged.rules.map((r) => (r.kind === "exit" ? { ...DEFAULT_EXIT, ...r } : r));
      return merged;
    }
  } catch { /* stare coruptă: pornim curat */ }
  return s;
}

const toast = (s: State, text: string, tone: Toast["tone"] = "info"): Toast[] =>
  [...s.toasts, { id: uid(), text, tone, at: Date.now() }].slice(-4);

/** Valoarea în $ a sumei din panoul de swap, la prețul nativ al rețelei tokenului. */
export function draftUsd(s: Pick<State, "draft" | "natives">, chain: Chain): number {
  const n = parseFloat(s.draft.amount.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n * s.natives[chain] : 0;
}

function execCfg(s: State, chain: Chain) {
  return { platformFeeBps: 0, slippageBps: s.settings.slippageBps, priorityFeeUsd: s.settings.priorityFeeSol * s.natives[chain] };
}

function openTrade(s: State, token: Token, sizeUsd: number, thesis: Trade["thesis"], ack: boolean, autoTp: boolean): Trade {
  const exit = (s.rules.find((r) => r.kind === "exit") ?? DEFAULT_EXIT) as typeof DEFAULT_EXIT;
  const exec = execCfg(s, token.chain);
  const fill = paperBuy(token.priceUsd, sizeUsd, exec);
  return {
    id: uid(), day: dayKey(s.now), tokenId: token.id, symbol: token.symbol, ca: token.ca,
    sizeUsd, feeUsd: fill.feeUsd, entryPrice: fill.price, qty: fill.qty, remainingQty: fill.qty,
    realizedUsd: 0, tpPct: autoTp ? exit.tpPct : 1e9, slPct: exit.slPct, partialPct: exit.partialPct, maxHoldMin: exit.maxHoldMin,
    tpHit: false, trailPct: exit.trailPct, peakPrice: fill.price, exec,
    openedAt: s.now, thesis, checksAtEntry: evaluateToken(token, s.rules), acceptedWarnings: ack, mode: "paper",
  };
}

export const REASON: Record<string, string> = { tp: "take profit", sl: "stop loss", breakeven: "stop la intrare", trailing: "trailing stop", timp: "timp expirat", manual: "vândut" };

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
    const trade = openTrade(s, token, o.sizeUsd, o.thesis, o.acceptedWarnings, true);
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

const freshDraft = (d: Draft): Draft => ({ ...d, thesis: "", ack: false, limitPrice: "" });

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "tick": {
      const now = s.now + a.dtSec * 1000;
      return settle(s, { ...s, now, tokens: market.step(s.tokens, a.dtSec) });
    }
    case "livePatch": {
      const tokens = s.tokens.map((t) => {
        const p = a.patches[t.id];
        if (!p || t.source !== "live") return t;
        const metrics = { ...t.metrics };
        for (const [k, v] of Object.entries(p.metrics)) if (v !== undefined) (metrics as Record<string, number>)[k] = v;
        return {
          ...t, priceUsd: p.priceUsd, change1hPct: p.change1hPct, change5mPct: p.change5mPct ?? t.change5mPct, volume1hUsd: p.volume1hUsd,
          pairAddress: t.pairAddress ?? p.pairAddress, metrics, socials: p.socials ?? t.socials, imageUrl: t.imageUrl ?? p.imageUrl, updatedAt: Date.now(),
        };
      });
      return settle(s, { ...s, tokens });
    }
    case "enrich":
      return { ...s, tokens: s.tokens.map((t) => (t.id === a.id ? { ...t, ...a.patch, metrics: { ...t.metrics, ...a.patch.metrics }, flags: { ...t.flags, ...a.patch.flags } } : t)) };
    case "chain":
      return { ...s, chain: a.chain, draft: { ...freshDraft(s.draft), amount: String(NATIVE_PRESETS[a.chain][1]) } };
    case "select":
      return { ...s, selectedId: a.id, draft: freshDraft(s.draft) };
    case "addToken": {
      const exists = s.tokens.some((t) => t.id === a.token.id);
      const tokens = exists ? s.tokens.map((t) => (t.id === a.token.id ? { ...t, ...a.token, metrics: { ...t.metrics, ...a.token.metrics }, flags: { ...t.flags, ...a.token.flags } } : t)) : [...s.tokens, a.token];
      return { ...s, tokens, selectedId: a.token.id, chain: a.token.source === "live" ? a.token.chain : s.chain, draft: { ...freshDraft(s.draft), side: "buy", amount: a.amount ?? s.draft.amount } };
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
      // Poarta e verificată în UI; reducerul nu deschide nimic fără token, sumă și teză.
      const token = s.tokens.find((t) => t.id === s.selectedId);
      const usd = token ? draftUsd(s, token.chain) : 0;
      if (!token || !s.draft.thesis.trim() || usd <= 0) return s;
      const trade = openTrade(s, token, usd, { text: s.draft.thesis.trim(), tag: s.draft.tag }, s.draft.ack, s.draft.autoTp);
      return { ...s, trades: [...s.trades, trade], draft: freshDraft(s.draft), toasts: toast(s, `Cumpărat ${token.symbol} ${fmtUsd(usd)} (hârtie)`, "info") };
    }
    case "placeOrder": {
      const token = s.tokens.find((t) => t.id === s.selectedId);
      const trigger = parseFloat(s.draft.limitPrice.replace(",", "."));
      const usd = token ? draftUsd(s, token.chain) : 0;
      if (!token || !s.draft.thesis.trim() || !(trigger > 0) || usd <= 0) return s;
      const o: LimitOrder = {
        id: uid(), tokenId: token.id, symbol: token.symbol, triggerPrice: trigger, sizeUsd: usd,
        thesis: { text: s.draft.thesis.trim(), tag: s.draft.tag }, acceptedWarnings: s.draft.ack,
        createdAt: s.now, expiresAt: s.now + s.settings.orderTtlMin * 60_000, status: "open",
      };
      return { ...s, orders: [...s.orders, o], draft: freshDraft(s.draft), toasts: toast(s, `Ordin limită pus pe ${token.symbol} la ${trigger.toPrecision(4)} $`) };
    }
    case "cancelOrder":
      return { ...s, orders: s.orders.map((o) => (o.id === a.id && o.status === "open" ? { ...o, status: "cancelled", note: "anulat de tine" } : o)) };
    case "sell":
    case "sellToken": {
      // Ieșirea nu se blochează niciodată.
      const match = (t: Trade) => (a.type === "sell" ? t.id === a.tradeId : t.tokenId === a.tokenId);
      const next = { ...s, trades: s.trades.map((t) => {
        if (!match(t) || t.closedAt !== undefined) return t;
        const p = s.tokens.find((k) => k.id === t.tokenId)?.priceUsd ?? t.entryPrice;
        return sellPart(t, p, s.now, a.pct);
      }) };
      return settle(s, next);
    }
    case "editExit":
      return { ...s, trades: s.trades.map((t) => {
        if (t.id !== a.tradeId || t.closedAt !== undefined) return t;
        // stopul se poate doar strânge, niciodată lărgi după intrare
        const slPct = a.slPct !== undefined && Number.isFinite(a.slPct) ? Math.min(t.slPct, Math.max(1, a.slPct)) : t.slPct;
        const tpPct = a.tpPct !== undefined && Number.isFinite(a.tpPct) ? Math.max(1, a.tpPct) : t.tpPct;
        const trailPct = a.trailPct !== undefined && Number.isFinite(a.trailPct) ? Math.max(0, a.trailPct) : t.trailPct;
        return { ...t, slPct, tpPct, trailPct };
      }) };
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
    case "track":
      if (s.tracked.some((w) => w.address === a.address)) return s;
      return { ...s, tracked: [...s.tracked, { address: a.address, label: a.label, addedAt: s.now }] };
    case "untrack":
      return { ...s, tracked: s.tracked.filter((w) => w.address !== a.address) };
    case "wallet":
      return { ...s, wallet: { ...s.wallet, connected: a.connected } };
    case "settings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "bankroll":
      return { ...s, bankrollUsd: a.usd };
    case "dismiss":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case "speed":
      return { ...s, speed: a.speed };
    case "natives":
      return { ...s, natives: a.prices };
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

  // prețuri reale la 5 s pentru tokenurile reale; prețul monedelor native la 5 min
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const live = ref.current.tokens.filter((t) => t.source === "live");
      if (!live.length) return;
      try {
        const patches = await market.refresh(live);
        if (!stop) dispatch({ type: "livePatch", patches });
      } catch { /* rețea: încercăm la pasul următor */ }
    };
    const natives = () => market.natives().then((prices) => !stop && dispatch({ type: "natives", prices }));
    poll();
    natives();
    const id = window.setInterval(poll, 5000);
    const id2 = window.setInterval(natives, 300_000);
    return () => { stop = true; window.clearInterval(id); window.clearInterval(id2); };
  }, []);

  // holderi, autorități și RugCheck pentru tokenul selectat
  useEffect(() => {
    const t = state.tokens.find((x) => x.id === state.selectedId);
    if (!t || t.source !== "live" || (t.holdersDist && (t.rug || t.chain !== "solana"))) return;
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
