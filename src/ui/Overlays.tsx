import { X } from "lucide-react";
import type { Toast } from "../store/cockpit";

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          <button className="ibtn sm" onClick={() => onDismiss(t.id)} aria-label="Închide"><X size={13} strokeWidth={2} /></button>
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
  ["B · V", "BUY / SELL în panoul de swap"],
  ["Esc", "închide panourile"],
  ["?", "lista asta"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Scurtături" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>Scurtături</h2><button className="ibtn sm" onClick={onClose} aria-label="Închide" autoFocus><X size={14} strokeWidth={2} /></button></div>
        <dl>{KEYS.map(([k, v]) => <div key={k}><dt><kbd className="kbd">{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
        <p className="dim small">Cumpărarea nu are scurtătură. Se face doar ținând butonul apăsat.</p>
      </div>
    </div>
  );
}

/** Portofelul. Simulat: pregătit pentru Wallet Adapter (Phantom), dar fără conexiune reală. */
export function WalletModal({ connected, balanceUsd, nativeUsd, symbol, onConnect, onDisconnect, onClose }: {
  connected: boolean; balanceUsd: number; nativeUsd: number; symbol: string;
  onConnect: () => void; onDisconnect: () => void; onClose: () => void;
}) {
  return (
    <div className="help-scrim" onClick={onClose}>
      <div className="help" role="dialog" aria-modal="true" aria-label="Portofel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><h2>Portofel</h2><button className="ibtn sm" onClick={onClose} aria-label="Închide" autoFocus><X size={14} strokeWidth={2} /></button></div>
        <div className="modal-body">
          <p>Cockpit merge acum doar <b>pe hârtie</b>: prețuri reale, bani simulați. Conectarea Phantom sau a altui portofel real e dezactivată până când o strategie se dovedește pe date noi.</p>
          <p className="dim">Când va exista, cheia rămâne în portofelul tău. Cockpit doar va cere semnătura, după ce frâna a trecut.</p>
          <div className="kv-row"><span className="dim">Sold pe hârtie</span><span className="num">{(balanceUsd / nativeUsd).toLocaleString("ro-RO", { maximumFractionDigits: 3 })} {symbol} · ${Math.round(balanceUsd).toLocaleString("ro-RO")}</span></div>
          <div className="row-gap">
            {connected
              ? <button className="btn" onClick={onDisconnect}>Deconectează portofelul de hârtie</button>
              : <button className="btn primary" onClick={onConnect}>Folosește portofelul de hârtie</button>}
            <button className="btn" disabled title="Dezactivat: fără bani reali în această etapă">Phantom</button>
          </div>
        </div>
      </div>
    </div>
  );
}
