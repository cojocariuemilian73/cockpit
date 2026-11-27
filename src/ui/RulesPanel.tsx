import { useState } from "react";
import { Plus, Trash2, Lock } from "lucide-react";
import type { Idea, Metric, MetricRule, Rule, SessionRule, SessionView } from "../domain/types";
import { FLAGS, METRICS } from "../domain/rules";

interface Props {
  rules: Rule[];
  ideas: Idea[];
  session: SessionView;
  onRule: (r: Rule) => void;
  onRemoveRule: (id: string) => void;
  onAddIdea: (text: string) => void;
  onRemoveIdea: (id: string) => void;
}

function Num({ value, onChange, step = 1, min = 0, label, disabled }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; label: string; disabled?: boolean;
}) {
  return (
    <input
      className="num-in num"
      type="number"
      inputMode="decimal"
      value={value}
      min={min}
      step={step}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= min) onChange(v); }}
    />
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

function SessionRow({ r, locked, onRule }: { r: SessionRule; locked: boolean; onRule: (r: Rule) => void }) {
  const set = (p: Partial<SessionRule>) => onRule({ ...r, ...p });
  const n = (label: string, key: "value" | "minutes", step = 1) => (
    <Num label={label} value={(r[key] as number) ?? 0} step={step} disabled={locked} onChange={(v) => set({ [key]: v })} />
  );
  let body: React.ReactNode;
  switch (r.type) {
    case "maxTradesPerDay": body = <>Maxim {n("Trade-uri pe zi", "value")} trade-uri pe zi</>; break;
    case "maxDailyRiskPct": body = <>Risc zilnic maxim {n("Risc zilnic, procent", "value", 0.5)} % din cont</>; break;
    case "cooldownAfterLosses": body = <>Pauză {n("Minute de pauză", "minutes", 5)} min după {n("Pierderi la rând", "value")} pierderi la rând</>; break;
    case "maxPositionPct": body = <>O poziție are maxim {n("Poziție maximă, procent", "value", 0.5)} % din cont</>; break;
    case "noSizeUpAfterLoss": body = <>După o pierdere nu măresc miza</>; break;
    case "minThesisWords": body = <>Teza are minim {n("Cuvinte minime", "value")} cuvinte</>; break;
  }
  return (
    <li className={`rule ${r.enabled ? "" : "off"}`}>
      <Toggle on={r.enabled} label="Activă" disabled={locked} onChange={(v) => set({ enabled: v })} />
      <span className="rule-text">{body}</span>
    </li>
  );
}

function MetricRow({ r, onRule, onRemove }: { r: MetricRule; onRule: (r: Rule) => void; onRemove: () => void }) {
  const m = METRICS[r.metric];
  return (
    <li className={`rule ${r.enabled ? "" : "off"}`}>
      <Toggle on={r.enabled} label="Activă" onChange={(v) => onRule({ ...r, enabled: v })} />
      <span className="rule-text">
        {m.label} {r.op === "min" ? "minim" : "maxim"}{" "}
        <Num label={m.label} value={r.value / m.scale} step={m.scale > 1 ? 5 : 1} onChange={(v) => onRule({ ...r, value: v * m.scale })} />{" "}
        {m.unit}
      </span>
      <button className="sev" data-sev={r.severity} onClick={() => onRule({ ...r, severity: r.severity === "block" ? "warn" : "block" })}
        title="Schimbă: blochează sau doar atenționează">
        {r.severity === "block" ? "blochează" : "atenționează"}
      </button>
      <button className="icon-btn small" onClick={onRemove} title="Șterge regula" aria-label="Șterge regula"><Trash2 size={14} strokeWidth={1.75} /></button>
    </li>
  );
}

const NEW_METRIC: Record<Metric, Pick<MetricRule, "op" | "value">> = {
  liquidityUsd: { op: "min", value: 50_000 }, mcapUsd: { op: "max", value: 5_000_000 }, ageMin: { op: "min", value: 30 },
  holders: { op: "min", value: 300 }, top10Pct: { op: "max", value: 30 }, devHoldPct: { op: "max", value: 5 },
  bundlePct: { op: "max", value: 15 }, buyRatioPct: { op: "min", value: 55 },
};

export function RulesPanel(p: Props) {
  const [idea, setIdea] = useState("");
  const [newMetric, setNewMetric] = useState<Metric>("buyRatioPct");
  const locked = p.session.state !== "active";
  const session = p.rules.filter((r): r is SessionRule => r.kind === "session");
  const metric = p.rules.filter((r): r is MetricRule => r.kind === "metric");
  const flags = p.rules.filter((r) => r.kind === "flag");
  const exit = p.rules.find((r) => r.kind === "exit");

  return (
    <div className="panel-body">
        <section className="group">
          <h3>Limite de sesiune</h3>
          {locked && (
            <p className="lock-note"><Lock size={13} strokeWidth={2} aria-hidden /> Blocate cât durează pauza sau limita. Nu poți slăbi frâna din mers.</p>
          )}
          <ul>{session.map((r) => <SessionRow key={r.id} r={r} locked={locked} onRule={p.onRule} />)}</ul>
        </section>

        <section className="group">
          <h3>Filtre pentru token</h3>
          <ul>
            {metric.map((r) => <MetricRow key={r.id} r={r} onRule={p.onRule} onRemove={() => p.onRemoveRule(r.id)} />)}
            {flags.map((r) => r.kind === "flag" && (
              <li key={r.id} className={`rule ${r.enabled ? "" : "off"}`}>
                <Toggle on={r.enabled} label="Activă" onChange={(v) => p.onRule({ ...r, enabled: v })} />
                <span className="rule-text">{FLAGS[r.flag]}</span>
                <button className="sev" data-sev={r.severity} onClick={() => p.onRule({ ...r, severity: r.severity === "block" ? "warn" : "block" })}>
                  {r.severity === "block" ? "blochează" : "atenționează"}
                </button>
              </li>
            ))}
          </ul>
          <div className="add-rule">
            <select value={newMetric} onChange={(e) => setNewMetric(e.target.value as Metric)} aria-label="Criteriu nou">
              {(Object.keys(METRICS) as Metric[]).map((m) => <option key={m} value={m}>{METRICS[m].label}</option>)}
            </select>
            <button className="btn-ghost" onClick={() => p.onRule({
              id: `m-${Date.now()}`, kind: "metric", enabled: true, metric: newMetric, severity: "warn", ...NEW_METRIC[newMetric],
            })}><Plus size={14} strokeWidth={2} aria-hidden /> Adaugă filtru</button>
          </div>
        </section>

        {exit && exit.kind === "exit" && (
          <section className="group">
            <h3>Ieșire</h3>
            <ul>
              <li className="rule"><span className="rule-text">Take profit la +<Num label="Take profit" value={exit.tpPct} step={5} onChange={(v) => p.onRule({ ...exit, tpPct: v })} /> %, vând <Num label="Procent vândut la TP" value={exit.partialPct} step={10} onChange={(v) => p.onRule({ ...exit, partialPct: Math.min(100, v) })} /> %</span></li>
              <li className="rule"><span className="rule-text">Stop loss la −<Num label="Stop loss" value={exit.slPct} step={5} min={1} onChange={(v) => p.onRule({ ...exit, slPct: Math.min(95, v) })} /> %</span></li>
              <li className="rule"><span className="rule-text">După TP, restul iese la −<Num label="Trailing" value={exit.trailPct} step={5} onChange={(v) => p.onRule({ ...exit, trailPct: Math.min(90, v) })} /> % din vârf (0 = stop la intrare)</span></li>
              <li className="rule"><span className="rule-text">Ies oricum după <Num label="Minute maxime" value={exit.maxHoldMin} step={30} min={5} onChange={(v) => p.onRule({ ...exit, maxHoldMin: v })} /> min</span></li>
            </ul>
          </section>
        )}

        <section className="group">
          <h3>Idei și teze de joc</h3>
          <form className="idea-form" onSubmit={(e) => { e.preventDefault(); if (idea.trim()) { p.onAddIdea(idea.trim()); setIdea(""); } }}>
            <textarea rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="O idee pe care vrei s-o testezi" aria-label="Idee nouă" />
            <button className="btn-ghost" type="submit" disabled={!idea.trim()}>Notează</button>
          </form>
          {p.ideas.length === 0 ? <p className="empty">Încă nicio idee notată.</p> : (
            <ul className="ideas">
              {p.ideas.map((i) => (
                <li key={i.id}>
                  <span>{i.text}</span>
                  <button className="icon-btn small" onClick={() => p.onRemoveIdea(i.id)} aria-label="Șterge ideea"><Trash2 size={14} strokeWidth={1.75} /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>

  );
}
