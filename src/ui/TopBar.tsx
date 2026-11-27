import { Radar as RadarIcon, ScrollText, Wallet, Settings as Cog, Keyboard } from "lucide-react";
import type { SessionView } from "../domain/types";
import { fmtDuration, fmtUsd } from "../domain/rules";

type PanelTab = "reguli" | "portofel" | "setari";

interface Props {
  session: SessionView;
  now: number;
  equityUsd: number;
  bankrollUsd: number;
  panel: PanelTab | null;
  radar: boolean;
  onPanel: (t: PanelTab) => void;
  onRadar: () => void;
  onHelp: () => void;
}

export function TopBar({ session: s, now, equityUsd, bankrollUsd, panel, radar, onPanel, onRadar, onHelp }: Props) {
  const riskFrac = s.riskMaxPct ? Math.min(1, s.riskUsedPct / s.riskMaxPct) : 0;
  const dayPnl = equityUsd - bankrollUsd;

  return (
    <header className="topbar">
      <button className={`icon-btn ${radar ? "on" : ""}`} onClick={onRadar} aria-pressed={radar} title="Radar (A)">
        <RadarIcon size={17} strokeWidth={1.75} aria-hidden /><span className="icon-btn-label">Radar</span>
      </button>
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Cockpit</span>
      </div>

      <dl className="gauges">
        <div className="gauge">
          <dt>Trade-uri azi</dt>
          <dd className="num">
            {s.tradesMax === null ? s.tradesUsed : <>{s.tradesUsed}<span className="dim"> / {s.tradesMax}</span></>}
          </dd>
          {s.tradesMax !== null && (
            <div className="pips" aria-hidden>
              {Array.from({ length: s.tradesMax }, (_, i) => <i key={i} className={i < s.tradesUsed ? "on" : ""} />)}
            </div>
          )}
        </div>

        <div className="gauge">
          <dt>Risc zi</dt>
          <dd className="num">
            {s.riskUsedPct.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%
            {s.riskMaxPct !== null && <span className="dim"> / {s.riskMaxPct}%</span>}
          </dd>
          {s.riskMaxPct !== null && (
            <div className={`meter ${riskFrac >= 1 ? "full" : riskFrac >= 0.66 ? "high" : ""}`} aria-hidden>
              <i style={{ transform: `scaleX(${riskFrac})` }} />
            </div>
          )}
        </div>

        <div className="gauge">
          <dt>Rezultat zi</dt>
          <dd className={`num ${dayPnl > 0.005 ? "pos" : dayPnl < -0.005 ? "neg" : ""}`}>
            {dayPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(dayPnl))}
          </dd>
        </div>
      </dl>

      <div className={`state state-${s.state}`} role="status" aria-live="polite">
        <span className="state-dot" aria-hidden />
        <span className="state-label">
          {s.state === "active" && "Activ"}
          {s.state === "cooldown" && <>Cooldown <span className="num">{fmtDuration((s.cooldownUntil ?? now) - now)}</span></>}
          {s.state === "limit" && "Oprit pe azi"}
        </span>
        {s.reason && <span className="state-reason">{s.reason}</span>}
      </div>

      <nav className="top-actions" aria-label="Panouri">
        <button className={`icon-btn ${panel === "reguli" ? "on" : ""}`} onClick={() => onPanel("reguli")} aria-pressed={panel === "reguli"} title="Reguli (R)">
          <ScrollText size={17} strokeWidth={1.75} aria-hidden /><span className="icon-btn-label">Reguli</span>
        </button>
        <button className={`icon-btn ${panel === "portofel" ? "on" : ""}`} onClick={() => onPanel("portofel")} aria-pressed={panel === "portofel"} title="Portofel (P)">
          <Wallet size={17} strokeWidth={1.75} aria-hidden /><span className="icon-btn-label">Portofel</span>
        </button>
        <button className={`icon-btn sq ${panel === "setari" ? "on" : ""}`} onClick={() => onPanel("setari")} aria-pressed={panel === "setari"} aria-label="Setări" title="Setări (S)">
          <Cog size={17} strokeWidth={1.75} aria-hidden />
        </button>
        <button className="icon-btn sq hide-sm" onClick={onHelp} aria-label="Scurtături" title="Scurtături (?)">
          <Keyboard size={17} strokeWidth={1.75} aria-hidden />
        </button>
      </nav>
    </header>
  );
}
