import { X } from "lucide-react";
import type { Toast } from "../store/cockpit";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          <button className="icon-btn small" onClick={() => onDismiss(t.id)} aria-label="Închide"><X size={13} strokeWidth={2} /></button>
        </div>
      ))}
    </div>
  );
}

const KEYS: [string, string][] = [
  ["/", "caută token"],
  ["R", "regulile mele"],
  ["P", "portofel și statistici"],
  ["S", "setări"],
  ["A", "radar"],
  ["1 · 2 · 3", "mărimile rapide"],
  ["Esc", "închide panourile"],
  ["?", "lista asta"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Scurtături" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>Scurtături</h2><button className="icon-btn small" onClick={onClose} aria-label="Închide" autoFocus><X size={16} strokeWidth={1.75} /></button></div>
        <dl>{KEYS.map(([k, v]) => <div key={k}><dt><kbd className="kbd">{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <p className="dim small">Cumpărarea nu are scurtătură. Se face doar ținând butonul apăsat.</p>
      </div>
    </div>
  );
}
