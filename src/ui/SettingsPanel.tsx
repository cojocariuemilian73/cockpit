import type { Settings } from "../domain/types";
import { fmtUsd } from "../domain/rules";

export function SettingsPanel({ settings: s, solUsd, onChange }: { settings: Settings; solUsd: number; onChange: (p: Partial<Settings>) => void }) {
  const num = (v: string, f: (n: number) => void) => { const n = parseFloat(v); if (Number.isFinite(n) && n >= 0) f(n); };
  const field = (label: string, value: number, unit: string, set: (n: number) => void, step = 1, wide = false) => (
    <li className="rule"><span className="rule-text">{label} <input className={`num-in num ${wide ? "wide" : ""}`} type="number" step={step} min={0} value={value} onChange={(e) => num(e.target.value, set)} aria-label={label} /> {unit}</span></li>
  );

  async function toggleNotifications(on: boolean) {
    if (on && "Notification" in window && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return;
    }
    onChange({ notifications: on });
  }

  return (
    <div className="panel-body">
      <section className="group">
        <h3>Execuție</h3>
        <ul>
          {field("Alunecare maximă", s.slippageBps / 100, "%", (n) => onChange({ slippageBps: Math.round(n * 100) }), 0.5)}
          <li className="rule"><span className="rule-text">Taxă de prioritate <input className="num-in num wide" type="number" step={0.0005} min={0} value={s.priorityFeeSol} onChange={(e) => num(e.target.value, (n) => onChange({ priorityFeeSol: n }))} aria-label="Taxă de prioritate în SOL" /> SOL <span className="dim">≈ {fmtUsd(s.priorityFeeSol * solUsd)} pe tranzacție</span></span></li>
          {field("Ordinele limită expiră după", s.orderTtlMin, "min", (n) => onChange({ orderTtlMin: Math.max(5, n) }), 15)}
        </ul>
        <p className="dim small">Schimbarea manuală trece presetarea pe Advanced. Comisionul platformei: 0%.</p>
      </section>

      <section className="group">
        <h3>Frâna</h3>
        <ul>
          {field("Spike de la", s.spikePct, "% în 5 min", (n) => onChange({ spikePct: Math.max(5, n) }), 10)}
          {field("Burst: cel mult", s.burstMax, "intrări", (n) => onChange({ burstMax: Math.max(1, Math.round(n)) }))}
          {field("în fereastra de", s.burstWindowMin, "min", (n) => onChange({ burstWindowMin: Math.max(1, n) }))}
          {field("Anti-Tilt după", s.tiltLosses, "pierderi la rând", (n) => onChange({ tiltLosses: Math.max(1, Math.round(n)) }))}
          {field("Datele sunt vechi după", s.staleSec, "s", (n) => onChange({ staleSec: Math.max(5, n) }), 5)}
          {field("Reconfirmare la o mișcare de", s.requotePct, "%", (n) => onChange({ requotePct: Math.max(0.5, n) }), 0.5)}
          {field("Sell 100% cere confirmare peste", s.bigPositionPct, "% din capital", (n) => onChange({ bigPositionPct: n }), 5)}
        </ul>
      </section>

      <section className="group">
        <h3>Notificări</h3>
        <ul>
          <li className="rule">
            <button role="switch" aria-checked={s.notifications} className="switch" onClick={() => toggleNotifications(!s.notifications)} aria-label="Notificări de sistem"><i /></button>
            <span className="rule-text">Notificări de sistem când fereastra nu e activă (TP, SL, 2x, alerte, cooldown)</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
