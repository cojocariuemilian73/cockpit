import type { Settings } from "../domain/types";
import { fmtUsd } from "../domain/rules";

export function SettingsPanel({ settings: s, solUsd, speed, onChange, onSpeed, onResetDay, onResetAll }: {
  settings: Settings; solUsd: number; speed: number;
  onChange: (p: Partial<Settings>) => void; onSpeed: (s: number) => void; onResetDay: () => void; onResetAll: () => void;
}) {
  const num = (v: string, f: (n: number) => void) => { const n = parseFloat(v); if (Number.isFinite(n) && n >= 0) f(n); };

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
          <li className="rule"><span className="rule-text">Alunecare maximă <input className="num-in num" type="number" step={0.5} value={s.slippageBps / 100} onChange={(e) => num(e.target.value, (n) => onChange({ slippageBps: Math.round(n * 100) }))} aria-label="Alunecare, procent" /> %</span></li>
          <li className="rule"><span className="rule-text">Taxă de prioritate <input className="num-in num wide" type="number" step={0.0005} value={s.priorityFeeSol} onChange={(e) => num(e.target.value, (n) => onChange({ priorityFeeSol: n }))} aria-label="Taxă de prioritate în SOL" /> SOL <span className="dim">≈ {fmtUsd(s.priorityFeeSol * solUsd)} pe tranzacție</span></span></li>
          <li className="rule"><span className="rule-text">Ordinele limită expiră după <input className="num-in num" type="number" step={15} value={s.orderTtlMin} onChange={(e) => num(e.target.value, (n) => onChange({ orderTtlMin: Math.max(5, n) }))} aria-label="Expirare ordin, minute" /> min</span></li>
          <li className="rule"><span className="rule-text">Mărimi rapide (% din cont)
            {s.sizePresetsPct.map((p, i) => (
              <input key={i} className="num-in num" type="number" step={0.5} value={p} aria-label={`Mărimea ${i + 1}`}
                onChange={(e) => num(e.target.value, (n) => onChange({ sizePresetsPct: s.sizePresetsPct.map((x, j) => (j === i ? n : x)) }))} />
            ))}</span></li>
        </ul>
        <p className="dim small">Comisionul platformei: 0%. Când există execuție reală, apare aici, înainte de fiecare tranzacție.</p>
      </section>

      <section className="group">
        <h3>Notificări</h3>
        <ul>
          <li className="rule">
            <button role="switch" aria-checked={s.notifications} className="switch" onClick={() => toggleNotifications(!s.notifications)} aria-label="Notificări de sistem"><i /></button>
            <span className="rule-text">Notificări de sistem când fereastra nu e activă (TP, SL, alerte, cooldown)</span>
          </li>
        </ul>
      </section>

      <section className="group demo">
        <h3>Simulare</h3>
        <div className="demo-row">
          <span>Viteza timpului pentru tokenurile demo</span>
          <div className="seg" role="radiogroup" aria-label="Viteza simulării">
            {[1, 10, 60].map((v) => <button key={v} role="radio" aria-checked={speed === v} onClick={() => onSpeed(v)}>×{v}</button>)}
          </div>
        </div>
        <div className="row-gap">
          <button className="btn-ghost danger" onClick={onResetDay}>Șterge trade-urile de azi</button>
          <button className="btn-ghost danger" onClick={() => { if (confirm("Ștergi tot: reguli, trade-uri, idei, setări?")) onResetAll(); }}>Resetează tot</button>
        </div>
      </section>
    </div>
  );
}
