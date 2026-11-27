import { useEffect, useRef, useState } from "react";
import { Lock, ShieldAlert } from "lucide-react";
import type { BuyGate, Chain, Check, Settings, SessionView, ThesisTag, Token, Trade } from "../domain/types";
import { countWords, fmtPct, fmtUsd, sizeCeilingUsd } from "../domain/rules";
import type { FomoBrake, RiskView } from "../domain/risk";
import { markToMarket } from "../execution/executor";
import { NATIVE } from "../data/market";
import { NATIVE_PRESETS, type Draft } from "../store/cockpit";

const TAGS: ThesisTag[] = ["narativă", "momentum", "smart money", "revenire", "altceva"];

/** Buton „ține apăsat”: fricțiune intenționată; durata crește când frâna anti-FOMO e activă. */
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

function Checks({ checks, onRules }: { checks: Check[]; onRules: () => void }) {
  const bad = checks.filter((c) => c.status !== "pass");
  const pass = checks.length - bad.length;
  return (
    <div className="checks">
      {bad.map((c) => (
        <div key={c.ruleId} className={`chk chk-${c.status}`}>
          <span className={`dot dot-${c.status}`} aria-hidden />
          <span className="ell">{c.label}</span>
          <span className="num chk-val">{c.actual}</span>
        </div>
      ))}
      <button className="chk-more" onClick={onRules}>{pass} {pass === 1 ? "regulă respectată" : "reguli respectate"} · editează regulile</button>
    </div>
  );
}

interface Props {
  token: Token;
  chain: Chain;
  nativeUsd: number;
  draft: Draft;
  session: SessionView;
  bankrollUsd: number;
  settings: Settings;
  gate: BuyGate;
  checks: Check[];
  risk: RiskView;
  brake: FomoBrake;
  sizeUsd: number;
  openTrades: Trade[];
  thesisRef: React.RefObject<HTMLTextAreaElement>;
  onDraft: (p: Partial<Draft>) => void;
  onSettings: (p: Partial<Settings>) => void;
  onBuy: () => void;
  onOrder: () => void;
  onSell: (pct: number) => void;
  onRules: () => void;
}

export function SwapPanel(p: Props) {
  const { draft: d, session, token } = p;
  const sym = NATIVE[p.chain].symbol;
  const cap = sizeCeilingUsd(session, p.bankrollUsd);
  const limit = d.orderType === "limit";
  const trigger = parseFloat(d.limitPrice.replace(",", "."));
  const limitOk = !limit || (trigger > 0 && trigger < token.priceUsd);
  const words = countWords(d.thesis);
  const closed = session.state !== "active";
  const allowed = p.gate.allowed && limitOk && p.sizeUsd > 0;
  const exit = session.exit;

  const position = p.openTrades.reduce((acc, t) => {
    const pnl = markToMarket(t, token.priceUsd);
    return { size: acc.size + t.sizeUsd, pnl: acc.pnl + pnl };
  }, { size: 0, pnl: 0 });

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
              <div className="kv-row"><span className="dim">Poziție {token.symbol}</span><span className="num">{fmtUsd(position.size + position.pnl)}</span></div>
              <div className="kv-row"><span className="dim">PnL</span><span className={`num ${position.pnl >= 0 ? "pos" : "neg"}`}>{fmtPct((position.pnl / position.size) * 100)} · {position.pnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(position.pnl))}</span></div>
              <div className="amts">
                {[25, 50, 100].map((pct) => <button key={pct} className="amt sell" onClick={() => p.onSell(pct)}>{pct}%</button>)}
              </div>
              <p className="note">Vânzarea nu are frână și nu cere teză. Ieșirea trebuie să fie mereu ușoară.</p>
            </>
          ) : <p className="note">Nu ai o poziție deschisă pe {token.symbol}.</p>}
        </div>
      ) : (
        <>
          <div className="row-between">
            <div className="seg xs" role="radiogroup" aria-label="Tip ordin">
              <button role="radio" aria-checked={!limit} onClick={() => p.onDraft({ orderType: "market" })}>Piață</button>
              <button role="radio" aria-checked={limit} onClick={() => p.onDraft({ orderType: "limit" })}>Limită</button>
            </div>
            {limit && (
              <label className="inline">≤ <input className="in num xs wide" inputMode="decimal" value={d.limitPrice} placeholder={(token.priceUsd * 0.85).toPrecision(3)}
                onChange={(e) => p.onDraft({ limitPrice: e.target.value })} aria-label="Preț limită în dolari" aria-invalid={d.limitPrice !== "" && !limitOk} /> $</label>
            )}
          </div>

          <div className="amts">
            {NATIVE_PRESETS[p.chain].map((v) => {
              const over = v * p.nativeUsd > cap + 0.005;
              return (
                <button key={v} className="amt" aria-pressed={parseFloat(d.amount) === v} disabled={closed || over}
                  title={over ? `Peste plafonul de acum (${fmtUsd(cap)})` : `≈ ${fmtUsd(v * p.nativeUsd)}`}
                  onClick={() => p.onDraft({ amount: String(v) })}>
                  {over && <Lock size={10} strokeWidth={2.25} aria-hidden />}{v}
                </button>
              );
            })}
          </div>
          <label className="amount-in">
            <input className="in num" inputMode="decimal" value={d.amount} onChange={(e) => p.onDraft({ amount: e.target.value })} aria-label={`Suma în ${sym}`} disabled={closed} />
            <span className="unit">{sym}</span>
            <span className="num dim">≈ {fmtUsd(p.sizeUsd)}</span>
            <span className="num dim cap">max {Number.isFinite(cap) ? fmtUsd(cap) : "—"}</span>
          </label>

          <div className="quick">
            <label>Slip <input className="in num xs" type="number" step={0.5} min={0} value={p.settings.slippageBps / 100} onChange={(e) => { const n = parseFloat(e.target.value); if (n >= 0) p.onSettings({ slippageBps: Math.round(n * 100) }); }} aria-label="Alunecare, procent" />%</label>
            <label>Prio <input className="in num xs" type="number" step={0.0005} min={0} value={p.settings.priorityFeeSol} onChange={(e) => { const n = parseFloat(e.target.value); if (n >= 0) p.onSettings({ priorityFeeSol: n }); }} aria-label={`Taxă de prioritate în ${sym}`} /></label>
            <button role="switch" aria-checked={d.autoTp} className="tgl" onClick={() => p.onDraft({ autoTp: !d.autoTp })} title={`Vinde automat ${exit.partialPct}% la +${exit.tpPct}%, apoi trailing ${exit.trailPct}%. Stopul de −${exit.slPct}% rămâne mereu.`}>
              <i aria-hidden /> Auto TP
            </button>
          </div>
          <p className="plan num">{d.autoTp ? `TP +${exit.tpPct}% → vinde ${exit.partialPct}%` : "fără TP automat"} · SL −{exit.slPct}% · max {Math.round(exit.maxHoldMin / 60)}h</p>

          <div className={`brake ${p.brake.active ? "brake-on" : ""}`}>
            <div className="brake-head">
              <ShieldAlert size={13} strokeWidth={2} aria-hidden />
              <b>Frâna</b>
              <RiskMeter risk={p.risk} />
            </div>
            {p.brake.active && <ul className="fomo">{p.brake.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            <Checks checks={p.checks} onRules={p.onRules} />
            <label className="thesis">
              <span className="thesis-q">De ce intru aici? {session.minThesisWords > 0 && <span className={`num count ${words >= session.minThesisWords ? "ok" : ""}`}>{Math.min(words, session.minThesisWords)}/{session.minThesisWords}</span>}</span>
              <textarea ref={p.thesisRef} rows={2} value={d.thesis} disabled={closed} onChange={(e) => p.onDraft({ thesis: e.target.value, ack: false })}
                placeholder="ex.: a trecut de 30 min după migrare, lichiditatea crește" />
            </label>
            <div className="tags" role="radiogroup" aria-label="Tipul tezei">
              {TAGS.map((t) => <button key={t} role="radio" aria-checked={d.tag === t} className="tag" disabled={closed} onClick={() => p.onDraft({ tag: t })}>{t}</button>)}
            </div>
            {p.gate.needsAck && p.gate.blockers.length === 0 && (
              <label className="ack">
                <input type="checkbox" checked={d.ack} onChange={(e) => p.onDraft({ ack: e.target.checked })} />
                <span>Intru peste {p.gate.warnings.length} {p.gate.warnings.length === 1 ? "atenționare" : "atenționări"}. Rămâne notat pe trade.</span>
              </label>
            )}
            {(p.gate.blockers.length > 0 || (limit && d.limitPrice !== "" && !limitOk)) && (
              <ul className="blockers" aria-live="polite">
                {limit && d.limitPrice !== "" && !limitOk && <li>Prețul limită trebuie să fie sub prețul curent.</li>}
                {p.gate.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
          </div>

          <HoldButton enabled={allowed} holdMs={p.brake.holdMs} tone={p.brake.active ? "brake" : "buy"} onConfirm={limit ? p.onOrder : p.onBuy}>
            {allowed
              ? <>{p.brake.active ? "Ține 2 s: " : "Ține apăsat: "}{limit ? "ordin limită" : "BUY"} <span className="num">{d.amount} {sym}</span></>
              : <><Lock size={13} strokeWidth={2.25} aria-hidden /> Cumpărare blocată</>}
          </HoldButton>
          <p className="paper">Hârtie, la prețuri reale. Niciun portofel real conectat.</p>
        </>
      )}
    </section>
  );
}
