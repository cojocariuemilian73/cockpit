import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useCockpit, dayKey } from "./store/cockpit";
import { buyGate, evaluateSession, evaluateToken } from "./domain/rules";
import type { Status, Token } from "./domain/types";
import { markToMarket } from "./execution/executor";
import { TopBar } from "./ui/TopBar";
import { TokenPicker } from "./ui/TokenPicker";
import { RuleChecks, TokenHeader, TokenMetrics } from "./ui/TokenCard";
import { ExecutionPanel, ThesisField } from "./ui/Execution";
import { Positions } from "./ui/Positions";
import { RulesPanel } from "./ui/RulesPanel";
import { Portfolio } from "./ui/Portfolio";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Chart } from "./ui/Chart";
import { Alerts, Holders, Tape } from "./ui/Market";
import { Radar } from "./ui/Radar";
import { ShortcutHelp, Toasts } from "./ui/Overlays";

type PanelTab = "reguli" | "portofel" | "setari";
const TABS: [PanelTab, string][] = [["reguli", "Reguli"], ["portofel", "Portofel"], ["setari", "Setări"]];

export default function App() {
  const [s, dispatch] = useCockpit();
  const [panel, setPanel] = useState<PanelTab | null>(() => (window.innerWidth >= 1180 ? "reguli" : null));
  const [radar, setRadar] = useState(() => window.innerWidth >= 1500);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const day = dayKey(s.now);

  const token = s.tokens.find((t) => t.id === s.selectedId) ?? null;
  const checks = useMemo(() => (token ? evaluateToken(token, s.rules) : []), [token, s.rules]);
  const session = evaluateSession(s.rules, s.trades, s.bankrollUsd, day, s.now);
  const gate = buyGate({ token, checks, session, bankrollUsd: s.bankrollUsd, sizeUsd: s.draft.sizeUsd, thesisText: s.draft.thesis, ack: s.draft.ack, now: s.now });

  const statusOf = (t: Token): Status => {
    const c = evaluateToken(t, s.rules);
    if (c.some((x) => x.status === "fail")) return "fail";
    if (c.some((x) => x.status === "warn" || x.status === "unknown")) return "warn";
    return "pass";
  };

  const priceOf = (id: string, fallback: number) => s.tokens.find((k) => k.id === id)?.priceUsd ?? fallback;
  const equity = s.bankrollUsd + s.trades.filter((t) => t.day === day).reduce((sum, t) => sum + markToMarket(t, priceOf(t.tokenId, t.entryPrice)), 0);
  const costUsd = s.draft.sizeUsd * (s.settings.slippageBps / 10_000) * 2 + s.settings.priorityFeeSol * s.solUsd * 2;
  const presets = s.settings.sizePresetsPct;

  const togglePanel = (t: PanelTab) => setPanel((p) => (p === t ? null : t));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === "r") togglePanel("reguli");
      else if (k === "p") togglePanel("portofel");
      else if (k === "s") togglePanel("setari");
      else if (k === "a") setRadar((v) => !v);
      else if (k === "?") setHelp((v) => !v);
      else if (["1", "2", "3"].includes(k)) {
        const pct = s.settings.sizePresetsPct[Number(k) - 1];
        if (pct) dispatch({ type: "draft", patch: { sizeUsd: Math.round((s.bankrollUsd * pct) / 100) } });
      } else if (k === "escape") { setHelp(false); if (window.innerWidth < 1180) setPanel(null); if (window.innerWidth < 1500) setRadar(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.settings.sizePresetsPct, s.bankrollUsd]);

  return (
    <div className={`app ${panel ? "with-panel" : ""} ${radar ? "with-radar" : ""}`} data-state={session.state}>
      <TopBar session={session} now={s.now} equityUsd={equity} bankrollUsd={s.bankrollUsd}
        panel={panel} radar={radar} onPanel={togglePanel} onRadar={() => setRadar((v) => !v)} onHelp={() => setHelp(true)} />

      <Radar open={radar} rules={s.rules} onClose={() => setRadar(false)}
        onPick={(t) => { dispatch({ type: "addToken", token: t }); if (window.innerWidth < 1500) setRadar(false); }} />

      <main className="stage">
        <TokenPicker tokens={s.tokens} selectedId={s.selectedId} statusOf={statusOf} inputRef={searchRef}
          onSelect={(id) => dispatch({ type: "select", id })} onAdd={(t) => dispatch({ type: "addToken", token: t })}
          onRemove={(id) => dispatch({ type: "removeToken", id })} />

        {token ? (
          <article className="card">
            <TokenHeader token={token} />
            <Chart token={token} trades={s.trades} orders={s.orders} />
            <TokenMetrics token={token} />
            <Holders token={token} />
            <RuleChecks checks={checks} onEdit={() => setPanel("reguli")} />
            <ThesisField draft={s.draft} minWords={session.minThesisWords} disabled={session.state !== "active"} onChange={(patch) => dispatch({ type: "draft", patch })} />
            <ExecutionPanel draft={s.draft} session={session} bankrollUsd={s.bankrollUsd} gate={gate} presetsPct={presets} priceUsd={token.priceUsd} costUsd={costUsd}
              onChange={(patch) => dispatch({ type: "draft", patch })} onBuy={() => dispatch({ type: "buy" })} onOrder={() => dispatch({ type: "placeOrder" })} />
            <Alerts token={token} alerts={s.alerts} onAdd={(op, price) => dispatch({ type: "addAlert", op, price })} onRemove={(id) => dispatch({ type: "removeAlert", id })} />
            <Tape token={token} />
          </article>
        ) : (
          <p className="empty">Caută un token sau alege unul din radar.</p>
        )}

        <Positions trades={s.trades} orders={s.orders} tokens={s.tokens} day={day}
          onSell={(id, pct) => dispatch({ type: "sell", tradeId: id, pct })}
          onEdit={(id, p) => dispatch({ type: "editExit", tradeId: id, ...p })}
          onCancelOrder={(id) => dispatch({ type: "cancelOrder", id })} />
      </main>

      {panel && (
        <aside className="side" aria-label="Panou">
          <div className="panel-head">
            <div className="seg tabs" role="tablist">
              {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}>{label}</button>)}
            </div>
            <button className="icon-btn small" onClick={() => setPanel(null)} aria-label="Închide panoul"><X size={16} strokeWidth={1.75} /></button>
          </div>
          {panel === "reguli" && (
            <RulesPanel rules={s.rules} ideas={s.ideas} session={session}
              onRule={(rule) => dispatch({ type: "rule", rule })} onRemoveRule={(id) => dispatch({ type: "removeRule", id })}
              onAddIdea={(text) => dispatch({ type: "addIdea", text })} onRemoveIdea={(id) => dispatch({ type: "removeIdea", id })} />
          )}
          {panel === "portofel" && <Portfolio trades={s.trades} tokens={s.tokens} bankrollUsd={s.bankrollUsd} onBankroll={(usd) => dispatch({ type: "bankroll", usd })} />}
          {panel === "setari" && (
            <SettingsPanel settings={s.settings} solUsd={s.solUsd} speed={s.speed} onChange={(patch) => dispatch({ type: "settings", patch })}
              onSpeed={(speed) => dispatch({ type: "speed", speed })} onResetDay={() => dispatch({ type: "resetDay" })} onResetAll={() => dispatch({ type: "resetAll" })} />
          )}
        </aside>
      )}
      {(panel || radar) && <div className="scrim" onClick={() => { setPanel(null); setRadar(false); }} aria-hidden />}

      <Toasts toasts={s.toasts} onDismiss={(id) => dispatch({ type: "dismiss", id })} />
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
