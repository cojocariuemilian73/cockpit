import { useEffect, useRef, useState } from "react";
import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Chain, Check, Mode, Preset, Settings, SessionView, ThesisTag, Token, Trade } from "../domain/types";
import { countWords, fmtPct, fmtUsd } from "../domain/rules";
import type { BrakeAction, BuyView } from "../domain/brake";
import type { RiskView } from "../domain/risk";
import { PRESETS } from "../domain/defaults";
import { markToMarket, positionValue } from "../execution/executor";
import { NATIVE } from "../data/market";
import { NATIVE_PRESETS, type Draft, type PendingBuy } from "../store/cockpit";
import { fmtPrice } from "./TokenStrip";

const TAGS: ThesisTag[] = ["narativă", "momentum", "smart money", "revenire", "altceva"];
const ACTION: Record<BrakeAction, string> = { proceed: "Poți intra", confirm: "Confirmă conștient", reduce: "Redu miza", wait: "Așteaptă" };
const PRESET_ORDER: Preset[] = ["turbo", "normal", "safe", "advanced"];

let nonceSeq = 0;
const nextNonce = () => `${Date.now().toString(36)}-${++nonceSeq}`;

/** Buton „ține apăsat”: fricțiune intenționată. Un singur declanșator per apăsare (nonce nou de fiecare dată). */
function HoldButton({ enabled, holdMs, tone, onConfirm, children }: { enabled: boolean; holdMs: number; tone: "buy" | "brake"; onConfirm: () => void; children: React.ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>();
  const start = () => {
    if (!enabled || holding) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); onConfirm(); }, holdMs);
  };
  const cancel = () => { window.clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (!enabled) cancel(); }, [enabled]);
  return (
    <button
      className={`hold hold-${tone} ${holding ? "holding" : ""}`}
      disabled={!enabled}
      style={{ ["--hold" as string]: `${holdMs}ms` }}
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") cancel(); }}
      onClick={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden />
      <span className="hold-text">{children}</span>
    </button>
  );
}

function RiskMeter({ risk }: { risk: RiskView }) {
  const lvl = risk.score >= 7 ? "hi" : risk.score >= 4 ? "mid" : "lo";
  return (
    <div className="risk" title={risk.reasons.join(" · ") || "Nimic semnalat"}>
      <span className="risk-label">Risc</span>
      <div className={`risk-cells risk-${lvl}`} role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={risk.score} aria-label={`Scor de risc ${risk.score} din 10`}>
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < risk.score ? "on" : ""} />)}
      </div>
      <span className={`risk-num num risk-${lvl}`}>{risk.score}/10</span>
    </div>
  );
}

interface Props {
  token: Token;
  chain: Chain;
  nativeUsd: number;
  draft: Draft;
  session: SessionView;
  mode: Mode;
  settings: Settings;
  buy: BuyView;
  confirm: PendingBuy | null;
  sellConfirm: string | null;
  openTrades: Trade[];
  thesisRef: React.RefObject<HTMLTextAreaElement>;
  onDraft: (p: Partial<Draft>) => void;
  onSettings: (p: Partial<Settings>) => void;
  onPreset: (p: Preset) => void;
  onBuy: (nonce: string, snapshotPrice: number) => void;
  onConfirm: (id: string) => void;
  onCancel: () => void;
  onSell: (pct: number, confirmed?: boolean) => void;
  onCancelSell: () => void;
  onRules: () => void;
}

function Advanced({ settings, sym, onSettings }: { settings: Settings; sym: string; onSettings: (p: Partial<Settings>) => void }) {
  const num = (v: string, f: (n: number) => void) => { const n = parseFloat(v); if (Number.isFinite(n) && n >= 0) f(n); };
  return (
    <div className="quick">
      <label>Slip <input className="in num xs" type="number" step={0.5} min={0} value={settings.slippageBps / 100} onChange={(e) => num(e.target.value, (n) => onSettings({ slippageBps: Math.round(n * 100) }))} aria-label="Alunecare maximă, procent" />%</label>
      <label>Prio <input className="in num xs wide" type="number" step={0.0005} min={0} value={settings.priorityFeeSol} onChange={(e) => num(e.target.value, (n) => onSettings({ priorityFeeSol: n }))} aria-label={`Taxă de prioritate în ${sym}`} /></label>
      <label>Spike ≥ <input className="in num xs" type="number" step={10} min={5} value={settings.spikePct} onChange={(e) => num(e.target.value, (n) => onSettings({ spikePct: Math.max(5, n) }))} aria-label="Pragul de spike pe 5 minute, procent" />%</label>
    </div>
  );
}

function Checks({ checks, onRules }: { checks: Check[]; onRules: () => void }) {
  const pass = checks.filter((c) => c.status === "pass").length;
  return <button className="chk-more" onClick={onRules}>{pass}/{checks.length} reguli respectate · editează regulile</button>;
}

export function SwapPanel(p: Props) {
  const { draft: d, session, token, buy } = p;
  const dec = buy.decision;
  const sym = NATIVE[p.chain].symbol;
  const limit = d.orderType === "limit";
  const words = countWords(d.thesis);
  const closed = session.state !== "active";
  const q = buy.quote;
  const blocked = dec.severity === "block";
  const c = p.confirm && p.confirm.tokenId === token.id ? p.confirm : null;

  const position = p.openTrades.reduce((acc, t) => ({ size: acc.size + t.sizeUsd, pnl: acc.pnl + markToMarket(t, token.priceUsd), value: acc.value + positionValue(t, token.priceUsd) }), { size: 0, pnl: 0, value: 0 });
  const sellConfirming = p.sellConfirm === token.id;
  const preset = p.settings.preset;

  return (
    <section className="swap" aria-label="Execuție">
      <div className="side-switch" role="radiogroup" aria-label="Direcție">
        <button role="radio" aria-checked={d.side === "buy"} className="buy" onClick={() => p.onDraft({ side: "buy" })}>BUY</button>
        <button role="radio" aria-checked={d.side === "sell"} className="sell" onClick={() => p.onDraft({ side: "sell" })}>SELL</button>
      </div>

      {d.side === "sell" ? (
        <div className="sell-box">
          {p.openTrades.length ? (
            <>
              <div className="kv-row"><span className="dim">Poziție {token.symbol}</span><span className="num">{fmtUsd(position.value)}</span></div>
              <div className="kv-row"><span className="dim">PnL</span><span className={`num ${position.pnl >= 0 ? "pos" : "neg"}`}>{fmtPct((position.pnl / position.size) * 100)} · {position.pnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(position.pnl))}</span></div>
              {sellConfirming ? (
                <div className="sell-confirm" role="alertdialog" aria-label="Confirmă Sell 100%">
                  <p>Poziție mare: vinzi tot, ≈ <b className="num">{fmtUsd(position.value)}</b>?</p>
                  <div className="row-gap">
                    <button className="amt sell strong" onClick={() => p.onSell(100, true)} autoFocus>Da, Sell 100%</button>
                    <button className="btn-ghost small" onClick={p.onCancelSell}>Nu</button>
                  </div>
                </div>
              ) : (
                <div className="amts three">
                  {[25, 50, 100].map((pct) => <button key={pct} className="amt sell" onClick={() => p.onSell(pct)}>{pct}%</button>)}
                </div>
              )}
              <p className="note">Vânzarea nu are frână și nu cere teză. Doar Sell 100% pe o poziție mare cere o confirmare.</p>
            </>
          ) : <p className="note">Nu ai o poziție deschisă pe {token.symbol}.</p>}
        </div>
      ) : (
        <>
          <div className="seg presets" role="radiogroup" aria-label="Presetare de execuție">
            {PRESET_ORDER.map((k) => (
              <button key={k} role="radio" aria-checked={preset === k} onClick={() => p.onPreset(k)} title={k === "advanced" ? "Alunecare, prioritate și pragul de spike, la alegere" : PRESETS[k].hint}>
                {k === "advanced" ? "Advanced" : PRESETS[k].label}
              </button>
            ))}
          </div>
          {preset === "advanced" && <Advanced settings={p.settings} sym={sym} onSettings={p.onSettings} />}

          <div className="row-between">
            <div className="seg xs" role="radiogroup" aria-label="Tip ordin">
              <button role="radio" aria-checked={!limit} onClick={() => p.onDraft({ orderType: "market" })}>Piață</button>
              <button role="radio" aria-checked={limit} onClick={() => p.onDraft({ orderType: "limit" })}>Limită</button>
            </div>
            {limit && (
              <label className="inline">≤ <input className="in num xs wide" inputMode="decimal" value={d.limitPrice} placeholder={(token.priceUsd * 0.85).toPrecision(3)}
                onChange={(e) => p.onDraft({ limitPrice: e.target.value })} aria-label="Preț limită în dolari" /> $</label>
            )}
            <div className="toggles">
              <button role="switch" aria-checked={d.autoTp} className="tgl" onClick={() => p.onDraft({ autoTp: !d.autoTp })} title={`Vinde automat ${session.exit.partialPct}% la +${session.exit.tpPct}%, apoi trailing ${session.exit.trailPct}%.`}><i aria-hidden /> TP</button>
              <button role="switch" aria-checked={d.auto2x} className="tgl" onClick={() => p.onDraft({ auto2x: !d.auto2x })} title="2x Auto-Breakeven: la ≥ 2× intrarea vinde 50% și restul devine moonbag cu stop la intrare"><i aria-hidden /> 2x</button>
            </div>
          </div>

          <div className="amts">
            {NATIVE_PRESETS[p.chain].map((v, i) => {
              const over = v * p.nativeUsd > buy.capUsd + 0.005;
              return (
                <button key={v} className="amt" aria-pressed={parseFloat(d.amount) === v} disabled={closed}
                  title={over ? `Peste plafonul de acum (${fmtUsd(buy.capUsd)})` : `≈ ${fmtUsd(v * p.nativeUsd)} · tasta ${i + 1}`}
                  onClick={() => p.onDraft({ amount: String(v) })}>
                  {over && <Lock size={10} strokeWidth={2.25} aria-hidden />}{v}<kbd className="amt-k" aria-hidden>{i + 1}</kbd>
                </button>
              );
            })}
          </div>
          <label className="amount-in">
            <input className="in num" inputMode="decimal" value={d.amount} onChange={(e) => p.onDraft({ amount: e.target.value })} aria-label={`Suma în ${sym}`} disabled={closed} />
            <span className="unit">{sym}</span>
            <span className="num dim">≈ {fmtUsd(q.sizeUsd)}</span>
            <span className="num dim cap">max {fmtUsd(buy.capUsd)}</span>
          </label>

          <p className="preview num" aria-live="polite" title={`Preț de umplere ≈ ${fmtPrice(q.fillPrice)} (cu alunecarea maximă)`}>
            <span>≈ {q.qty > 0 ? q.qty.toLocaleString("ro-RO", { maximumFractionDigits: q.qty >= 100 ? 0 : 4 }) : "0"} {token.symbol}</span>
            <span>net {fmtUsd(q.netUsd)}</span>
            <span>taxă {fmtUsd(q.feeUsd)}</span>
            <span>comision {fmtUsd(q.commissionUsd)}</span>
            <span className={q.impactPct !== null && q.impactPct >= 1 ? "warn-t" : ""}>impact {q.impactPct === null ? "?" : `${q.impactPct.toLocaleString("ro-RO", { maximumFractionDigits: 2 })}%`}</span>
          </p>

          <div className={`brake brake-${dec.severity}`}>
            <div className="brake-head">
              {dec.triggered ? <ShieldAlert size={13} strokeWidth={2} aria-hidden /> : <ShieldCheck size={13} strokeWidth={2} aria-hidden />}
              <b>Frâna</b>
              <span className={`brake-act act-${dec.recommendedAction}`}>{blocked ? "Blocat" : ACTION[dec.recommendedAction]}</span>
              {buy.risk && <RiskMeter risk={buy.risk} />}
            </div>
            {dec.reasons.length > 0 && (
              <ul className={`reasons ${blocked ? "blocked" : ""}`} aria-live="polite">
                {dec.reasons.slice(0, 5).map((r) => <li key={r}>{r}</li>)}
                {dec.reasons.length > 5 && <li className="dim">încă {dec.reasons.length - 5}</li>}
              </ul>
            )}
            <Checks checks={buy.checks} onRules={p.onRules} />
            <label className="thesis">
              <span className="thesis-q">De ce intru aici? {session.minThesisWords > 0 && <span className={`num count ${words >= session.minThesisWords ? "ok" : ""}`}>{Math.min(words, session.minThesisWords)}/{session.minThesisWords}</span>}</span>
              <textarea ref={p.thesisRef} rows={2} value={d.thesis} disabled={closed} onChange={(e) => p.onDraft({ thesis: e.target.value })}
                placeholder="ex.: a trecut de 30 min după migrare, lichiditatea crește" />
            </label>
            <div className="tags" role="radiogroup" aria-label="Tipul tezei">
              {TAGS.map((t) => <button key={t} role="radio" aria-checked={d.tag === t} className="tag" disabled={closed} onClick={() => p.onDraft({ tag: t })}>{t}</button>)}
            </div>
          </div>

          {c ? (
            <div className={`confirm confirm-${c.severity}`} role="alertdialog" aria-label="Confirmarea frânei">
              <p className="confirm-head"><b>Frâna cere confirmare</b> · {ACTION[c.recommendedAction]}</p>
              <ul>{c.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="dim small num">Confirmi la {fmtPrice(c.snapshotPrice)}. Dacă prețul se mișcă peste {p.settings.requotePct}%, ți se cere din nou.</p>
              <div className="row-gap">
                <button className="btn confirm-go" onClick={() => p.onConfirm(c.id)}>Confirm BUY {d.amount} {sym}</button>
                <button className="btn-ghost" onClick={p.onCancel} autoFocus>Renunț</button>
              </div>
            </div>
          ) : (
            <HoldButton enabled={!blocked} holdMs={1000} tone={dec.triggered ? "brake" : "buy"} onConfirm={() => p.onBuy(nextNonce(), dec.snapshotPrice)}>
              {blocked
                ? <><Lock size={13} strokeWidth={2.25} aria-hidden /> Cumpărare blocată</>
                : <>Ține apăsat: {limit ? "ordin limită" : "BUY"} <span className="num">{d.amount} {sym}</span>{dec.requiresConfirmation && " · cere confirmare"}</>}
            </HoldButton>
          )}
          <p className="paper">{p.mode === "demo" ? "DEMO: bani simulați, nicio tranzacție reală." : "LIVE pregătit: fără portofel conectat, nu se execută nimic."}</p>
        </>
      )}
    </section>
  );
}
