import { X } from "lucide-react";
import type { Mode } from "../domain/types";
import { fmtUsd } from "../domain/rules";
import type { Toast } from "../store/cockpit";

export function Toasts({ toasts, onDismiss, onUndo }: { toasts: Toast[]; onDismiss: (id: string) => void; onUndo: () => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          {t.action === "undoReset" && <button className="toast-act" onClick={() => { onUndo(); onDismiss(t.id); }}>Undo</button>}
          <button className="ibtn sm" onClick={() => onDismiss(t.id)} aria-label="Închide"><X size={13} strokeWidth={2} /></button>
        </div>
      ))}
    </div>
  );
}

/** Anti-Tilt: un banner calm, fără alarmă. Două ieșiri: miza minimă sau ascuns pentru azi. */
export function TiltBanner({ reasons, minLabel, onMin, onHide }: { reasons: string[]; minLabel: string; onMin: () => void; onHide: () => void }) {
  return (
    <div className="tilt" role="status">
      <p><b>Pauză scurtă?</b> {reasons.join(" și ")}. După o serie ca asta, deciziile se grăbesc.</p>
      <div className="row-gap">
        <button className="btn small" onClick={onMin}>Setează miza la {minLabel}</button>
        <button className="btn-ghost small" onClick={onHide}>Ascunde pentru sesiunea asta</button>
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["/", "caută token (Esc șterge)"],
  ["1 – 4", "alege suma"],
  ["B · V", "BUY / SELL în panoul de swap"],
  ["F", "Focus: doar graficul și execuția"],
  ["R · P · S", "reguli · portofel · setări"],
  ["Esc", "închide panourile, renunță la o confirmare"],
  ["?", "lista asta"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Scurtături" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>Scurtături</h2><button className="ibtn sm" onClick={onClose} aria-label="Închide" autoFocus><X size={14} strokeWidth={2} /></button></div>
        <dl>{KEYS.map(([k, v]) => <div key={k}><dt><kbd className="kbd">{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <p className="dim small">Cumpărarea nu are scurtătură. Se face doar ținând butonul apăsat, iar frâna poate cere o confirmare.</p>
      </div>
    </div>
  );
}

/** Portofelul: DEMO cu 10 SOL simulați; LIVE e doar pregătit (wallet/RPC), fără nicio execuție reală. */
export function WalletModal({ mode, cashUsd, equityUsd, solUsd, onMode, onClose }: {
  mode: Mode; cashUsd: number; equityUsd: number; solUsd: number; onMode: (m: Mode) => void; onClose: () => void;
}) {
  const sol = (usd: number) => (usd / solUsd).toLocaleString("ro-RO", { maximumFractionDigits: 3 });
  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Portofel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>Portofel · {mode === "demo" ? "DEMO" : "LIVE pregătit"}</h2><button className="ibtn sm" onClick={onClose} aria-label="Închide" autoFocus><X size={14} strokeWidth={2} /></button></div>
        <div className="modal-body">
          <div className="kv-row"><span className="dim">Numerar</span><span className="num">{sol(cashUsd)} SOL · {fmtUsd(cashUsd)}</span></div>
          <div className="kv-row"><span className="dim">Cu pozițiile deschise</span><span className="num">{sol(equityUsd)} SOL · {fmtUsd(equityUsd)}</span></div>
          {mode === "demo" ? (
            <p>DEMO pornește cu <b>10 SOL simulați</b>. Prețurile pot fi reale, banii nu. Reset Demo din bara de sus readuce 10 SOL și se poate anula.</p>
          ) : (
            <p><b>LIVE e doar pregătit.</b> Structura e gata pentru un portofel (Wallet Adapter) și un RPC, dar nu există nicio conexiune: niciun ordin nu pleacă nicăieri, iar cumpărarea e blocată.</p>
          )}
          <p className="dim">Când va exista execuție reală, cheia rămâne în portofelul tău. Cockpit doar cere semnătura, după ce frâna a trecut.</p>
          <div className="row-gap">
            <button className="btn" onClick={() => onMode(mode === "demo" ? "live" : "demo")}>{mode === "demo" ? "Vezi modul LIVE (pregătit)" : "Înapoi la DEMO"}</button>
            <button className="btn" disabled title="Dezactivat: fără bani reali în această etapă">Conectează Phantom</button>
          </div>
        </div>
      </div>
    </div>
  );
}
