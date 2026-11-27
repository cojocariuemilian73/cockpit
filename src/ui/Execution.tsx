import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import type { BuyGate, SessionView, ThesisTag } from "../domain/types";
import { countWords, fmtUsd, sizeCeilingUsd } from "../domain/rules";
import type { Draft } from "../store/cockpit";

const TAGS: ThesisTag[] = ["narativă", "momentum", "smart money", "revenire", "altceva"];

export function ThesisField({ draft, minWords, onChange, disabled }: {
  draft: Draft; minWords: number; onChange: (p: Partial<Draft>) => void; disabled: boolean;
}) {
  const words = countWords(draft.thesis);
  const ok = words >= minWords;
  return (
    <section className="thesis">
      <label htmlFor="thesis" className="thesis-q">De ce intru aici?</label>
      <textarea
        id="thesis"
        rows={2}
        value={draft.thesis}
        disabled={disabled}
        onChange={(e) => onChange({ thesis: e.target.value, ack: false })}
        placeholder="Ex.: a trecut de 30 min după migrare, lichiditatea crește, narativa e nouă"
        aria-describedby="thesis-count"
      />
      <div className="thesis-foot">
        <div className="tags" role="radiogroup" aria-label="Tipul tezei">
          {TAGS.map((t) => (
            <button key={t} role="radio" aria-checked={draft.tag === t} className="tag" disabled={disabled} onClick={() => onChange({ tag: t })}>{t}</button>
          ))}
        </div>
        {minWords > 0 && (
          <span id="thesis-count" className={`num count ${ok ? "ok" : ""}`}>{Math.min(words, minWords)}/{minWords} cuvinte</span>
        )}
      </div>
    </section>
  );
}

/** Buton „ține apăsat”: fricțiune intenționată de ~1 s în locul unui click reflex. */
function HoldButton({ enabled, onConfirm, children }: { enabled: boolean; onConfirm: () => void; children: React.ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>();
  const HOLD_MS = 1000;

  const start = () => {
    if (!enabled || holding) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { setHolding(false); onConfirm(); }, HOLD_MS);
  };
  const cancel = () => { window.clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      className={`hold ${holding ? "holding" : ""}`}
      disabled={!enabled}
      style={{ ["--hold" as string]: `${HOLD_MS}ms` }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") cancel(); }}
      onClick={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden />
      <span className="hold-text">{children}</span>
    </button>
  );
}

export function ExecutionPanel({ draft, session, bankrollUsd, gate, presetsPct, priceUsd, costUsd, onChange, onBuy, onOrder }: {
  draft: Draft; session: SessionView; bankrollUsd: number; gate: BuyGate; presetsPct: number[]; priceUsd: number;
  /** alunecare + taxe estimate pe un dus-întors, în $ */
  costUsd: number;
  onChange: (p: Partial<Draft>) => void; onBuy: () => void; onOrder: () => void;
}) {
  const limit = draft.orderType === "limit";
  const trigger = parseFloat(draft.limitPrice.replace(",", "."));
  const limitOk = !limit || (trigger > 0 && trigger < priceUsd);
  const cap = sizeCeilingUsd(session, bankrollUsd);
  const e = session.exit;
  const riskUsd = draft.sizeUsd * (e.slPct / 100);
  const closed = session.state !== "active";

  return (
    <section className="exec" aria-label="Execuție">
      <div className="exec-top">
        <div className="seg" role="radiogroup" aria-label="Tipul ordinului">
          <button role="radio" aria-checked={!limit} onClick={() => onChange({ orderType: "market" })}>La piață</button>
          <button role="radio" aria-checked={limit} onClick={() => onChange({ orderType: "limit" })}>Limită</button>
        </div>
        {limit && (
          <label className="limit-in">
            Cumpără când prețul scade la
            <input className="num-in num wide" inputMode="decimal" value={draft.limitPrice} placeholder={(priceUsd * 0.9).toPrecision(3)}
              onChange={(e) => onChange({ limitPrice: e.target.value })} aria-invalid={draft.limitPrice !== "" && !limitOk} />
            $
          </label>
        )}
      </div>
      {limit && draft.limitPrice !== "" && !limitOk && <p className="field-error">Prețul limită trebuie să fie sub prețul curent ({priceUsd.toPrecision(4)} $).</p>}
      <div className="sizes" role="radiogroup" aria-label="Mărime poziție">
        {presetsPct.map((pct) => {
          const usd = Math.round((bankrollUsd * pct) / 100);
          const over = usd > cap + 0.005;
          return (
            <button
              key={pct}
              role="radio"
              aria-checked={draft.sizeUsd === usd}
              className="size"
              disabled={over || closed}
              title={over ? `Peste plafonul de acum (${fmtUsd(cap)})` : undefined}
              onClick={() => onChange({ sizeUsd: usd })}
            >
              <span className="num size-usd">{fmtUsd(usd)}</span>
              <span className="size-pct">{pct}% din cont</span>
              {over && <Lock size={12} strokeWidth={2} className="size-lock" aria-hidden />}
            </button>
          );
        })}
      </div>

      <p className="plan">
        <span>Ieșire</span>
        <b className="num">TP +{e.tpPct}%</b>
        <span className="sep" aria-hidden>·</span>
        <b className="num">SL −{e.slPct}%</b>
        <span className="sep" aria-hidden>·</span>
        <span>vinde {e.partialPct}% la TP, apoi stop la intrare</span>
        <span className="sep" aria-hidden>·</span>
        <span>max {e.maxHoldMin >= 60 ? `${Math.round(e.maxHoldMin / 60)} h` : `${e.maxHoldMin} min`}</span>
        {e.trailPct > 0 && <><span className="sep" aria-hidden>·</span><span>trailing {e.trailPct}%</span></>}
        <span className="plan-risk num">risc {fmtUsd(riskUsd)} · costuri ~{fmtUsd(costUsd)}</span>
      </p>

      {gate.needsAck && gate.blockers.length === 0 && (
        <div className="ack">
          <ul>{gate.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          <label className="ack-box">
            <input type="checkbox" checked={draft.ack} onChange={(ev) => onChange({ ack: ev.target.checked })} />
            <span>Am citit atenționările și intru oricum. Rămâne notat pe trade.</span>
          </label>
        </div>
      )}

      {gate.blockers.length > 0 && (
        <ul className="blockers" aria-live="polite">
          {gate.blockers.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}

      <HoldButton enabled={gate.allowed && limitOk} onConfirm={limit ? onOrder : onBuy}>
        {gate.allowed && limitOk
          ? <>{limit ? "Ține apăsat pentru ordin limită" : "Ține apăsat pentru a cumpăra"} <span className="num">{fmtUsd(draft.sizeUsd)}</span></>
          : <><Lock size={15} strokeWidth={2} aria-hidden /> Cumpărare blocată</>}
      </HoldButton>
      <p className="paper-note">Pe hârtie, la prețuri reale. Niciun portofel conectat. {limit && "Ordinul limită trece din nou prin reguli când se declanșează."}</p>
    </section>
  );
}
