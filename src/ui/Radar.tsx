import { useEffect, useMemo, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { Rule, Token } from "../domain/types";
import { evaluateToken, fmtMetric } from "../domain/rules";
import { market, type RadarKind } from "../data/market";

function age(min?: number) {
  if (min === undefined) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 2880) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}z`;
}

/**
 * Radarul: pool-uri noi sau în trend, trecute prin regulile tale înainte să le vezi.
 * Nu e un feed infinit: arată doar ce nu încalcă nicio regulă critică; restul e un număr.
 */
export function Radar({ open, rules, onPick, onClose }: { open: boolean; rules: Rule[]; onPick: (t: Token) => void; onClose: () => void }) {
  const [kind, setKind] = useState<RadarKind>("trend");
  const [rows, setRows] = useState<Token[] | null>(null);
  const [err, setErr] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    setRows(null);
    setErr(false);
    const load = async () => {
      try {
        const r = await market.radar(kind);
        if (!stop) { setRows(r); setErr(false); }
      } catch { if (!stop) setErr(true); }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [open, kind, tick]);

  const graded = useMemo(() => (rows ?? []).map((t) => {
    const checks = evaluateToken(t, rules);
    const fail = checks.find((c) => c.status === "fail");
    const warn = checks.filter((c) => c.status === "warn" || c.status === "unknown").length;
    return { t, fail, warn };
  }), [rows, rules]);
  const passed = graded.filter((g) => !g.fail);
  const rejected = graded.filter((g) => g.fail);

  return (
    <aside className={`radar ${open ? "open" : ""}`} aria-label="Radar">
      <div className="panel-head">
        <h2>Radar</h2>
        <div className="seg" role="radiogroup" aria-label="Sursa radarului">
          <button role="radio" aria-checked={kind === "trend"} onClick={() => setKind("trend")}>în trend</button>
          <button role="radio" aria-checked={kind === "noi"} onClick={() => setKind("noi")}>noi</button>
        </div>
        <button className="icon-btn small" onClick={() => setTick((x) => x + 1)} aria-label="Reîmprospătează"><RefreshCw size={14} strokeWidth={1.75} /></button>
        <button className="icon-btn small radar-close" onClick={onClose} aria-label="Închide radarul"><X size={16} strokeWidth={1.75} /></button>
      </div>
      <p className="radar-note">Filtrat prin regulile tale. Dev-ul, bundle-ul și holderii se verifică abia când deschizi tokenul.</p>

      <div className="radar-body">
        {err && <p className="dim small pad">Sursa nu răspunde acum (limită de cereri). Reîncerc într-un minut.</p>}
        {!rows && !err && <p className="dim small pad">Se încarcă…</p>}
        {rows && passed.length === 0 && (
          <p className="dim small pad">Niciun pool nu trece de regulile tale critice acum. Asta e frâna care lucrează.</p>
        )}
        <ul className="radar-list">
          {passed.slice(0, 10).map(({ t, warn }) => (
            <li key={t.id}>
              <button className="radar-row" onClick={() => onPick(t)}>
                <span className="radar-sym"><span className={`dot dot-${warn ? "warn" : "pass"}`} aria-hidden />{t.symbol}</span>
                <span className="num">{t.metrics.liquidityUsd !== undefined ? fmtMetric("liquidityUsd", t.metrics.liquidityUsd) : "—"}</span>
                <span className="num dim">{age(t.metrics.ageMin)}</span>
                <span className="radar-sub dim">{warn ? `${warn} de verificat` : "fără atenționări"} · {t.dex}</span>
              </button>
            </li>
          ))}
        </ul>
        {rejected.length > 0 && (
          <div className="rejected">
            <button className="link-btn" onClick={() => setShowRejected((v) => !v)} aria-expanded={showRejected}>
              {rejected.length} respinse de reguli {showRejected ? "· ascunde" : "· arată"}
            </button>
            {showRejected && (
              <ul className="rej-list">
                {rejected.map(({ t, fail }) => (
                  <li key={t.id}><b>{t.symbol}</b> <span className="dim">{fail!.label}: are {fail!.actual}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
