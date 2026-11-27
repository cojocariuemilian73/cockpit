import { useEffect, useMemo, useRef, useState } from "react";
import { X, Radar as RadarIcon, CandlestickChart, ArrowLeftRight } from "lucide-react";
import { useCockpit, dayKey, draftUsd } from "./store/cockpit";
import { buyGate, evaluateSession, evaluateToken } from "./domain/rules";
import { fomoBrake, riskScore } from "./domain/risk";
import type { Chain, Token } from "./domain/types";
import { NATIVE, market } from "./data/market";
import { Header, type DrawerTab } from "./ui/Header";
import { RadarColumn } from "./ui/RadarColumn";
import { TokenStrip } from "./ui/TokenStrip";
import { Chart } from "./ui/Chart";
import { BottomPanel } from "./ui/BottomPanel";
import { SwapPanel } from "./ui/SwapPanel";
import { XFeed } from "./ui/XFeed";
import { RulesPanel } from "./ui/RulesPanel";
import { Portfolio } from "./ui/Portfolio";
import { SettingsPanel } from "./ui/SettingsPanel";
import { ShortcutHelp, Toasts, WalletModal } from "./ui/Overlays";

const TABS: [DrawerTab, string][] = [["reguli", "Reguli"], ["portofel", "Portofel"], ["setari", "Setări"]];
type MobileView = "radar" | "chart" | "trade";

export default function App() {
  const [s, dispatch] = useCockpit();
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [help, setHelp] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [view, setView] = useState<MobileView>("chart");
  const searchRef = useRef<HTMLInputElement>(null);
  const thesisRef = useRef<HTMLTextAreaElement>(null);
  const day = dayKey(s.now);

  const token = s.tokens.find((t) => t.id === s.selectedId) ?? null;
  const checks = useMemo(() => (token ? evaluateToken(token, s.rules) : []), [token, s.rules]);
  const risk = useMemo(() => (token ? riskScore(token, checks) : null), [token, checks]);
  const brake = token && risk ? fomoBrake(token, risk) : null;
  const session = evaluateSession(s.rules, s.trades, s.bankrollUsd, day, s.now);
  const tokenChain: Chain = token?.chain ?? s.chain;
  const sizeUsd = draftUsd(s, tokenChain);
  const gate = buyGate({ token, checks, session, bankrollUsd: s.bankrollUsd, sizeUsd, thesisText: s.draft.thesis, ack: s.draft.ack, now: s.now });

  // sold pe hârtie: capital + rezultate închise − ce e blocat în poziții deschise + ce s-a încasat parțial
  const balanceUsd = s.bankrollUsd + s.trades.reduce((sum, t) => sum + (t.closedAt !== undefined ? t.pnlUsd ?? 0 : t.realizedUsd - t.sizeUsd), 0);

  const toggleDrawer = (t: DrawerTab) => setDrawer((d) => (d === t ? null : t));

  function pick(t: Token) {
    dispatch({ type: "addToken", token: t });
    setView("chart");
  }

  async function quickBuy(ca: string, chain?: Chain) {
    const amount = s.draft.amount;
    const known = s.tokens.find((t) => t.ca === ca);
    if (known) dispatch({ type: "addToken", token: known, amount });
    else {
      const { token: t } = await market.lookup(chain ?? s.chain, ca);
      if (!t) return;
      dispatch({ type: "addToken", token: t, amount });
    }
    setView("trade");
    window.setTimeout(() => thesisRef.current?.focus(), 60);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (k === "r") toggleDrawer("reguli");
      else if (k === "p") toggleDrawer("portofel");
      else if (k === "s") toggleDrawer("setari");
      else if (k === "b") dispatch({ type: "draft", patch: { side: "buy" } });
      else if (k === "v") dispatch({ type: "draft", patch: { side: "sell" } });
      else if (k === "?") setHelp((v) => !v);
      else if (k === "escape") { setHelp(false); setDrawer(null); setWalletOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const others = useMemo(() => s.tokens.filter((t) => t.id !== token?.id), [s.tokens, token?.id]);

  return (
    <div className="term" data-view={view} data-state={session.state}>
      <Header chain={s.chain} natives={s.natives} priorityFeeSol={s.settings.priorityFeeSol} session={session} now={s.now}
        balanceUsd={balanceUsd} walletConnected={s.wallet.connected} drawer={drawer} searchRef={searchRef}
        onChain={(chain) => dispatch({ type: "chain", chain })} onPick={pick} onDrawer={toggleDrawer}
        onWallet={() => setWalletOpen(true)} onHelp={() => setHelp(true)} />

      <RadarColumn chain={s.chain} rules={s.rules} tokens={s.tokens} selectedId={s.selectedId} tracked={s.tracked}
        onPick={pick} onRemove={(id) => dispatch({ type: "removeToken", id })}
        onTrack={(address, label) => dispatch({ type: "track", address, label })} onUntrack={(address) => dispatch({ type: "untrack", address })} />

      <main className="col col-center">
        {token ? (
          <>
            <TokenStrip token={token} />
            <div className="chart-wrap"><Chart token={token} trades={s.trades} orders={s.orders} /></div>
          </>
        ) : <p className="empty center">Caută un token (tasta /) sau alege unul din radar.</p>}
        <BottomPanel token={token} tokens={s.tokens} trades={s.trades} orders={s.orders} alerts={s.alerts}
          onSell={(id, pct) => dispatch({ type: "sell", tradeId: id, pct })}
          onEdit={(id, p) => dispatch({ type: "editExit", tradeId: id, ...p })}
          onCancelOrder={(id) => dispatch({ type: "cancelOrder", id })}
          onSelect={(id) => dispatch({ type: "select", id })}
          onAddAlert={(op, price) => dispatch({ type: "addAlert", op, price })}
          onRemoveAlert={(id) => dispatch({ type: "removeAlert", id })} />
      </main>

      <aside className="col col-right" aria-label="Execuție și X">
        {token && risk && brake ? (
          <>
            <SwapPanel token={token} chain={tokenChain} nativeUsd={s.natives[tokenChain]} draft={s.draft} session={session}
              bankrollUsd={s.bankrollUsd} settings={s.settings} gate={gate} checks={checks} risk={risk} brake={brake} sizeUsd={sizeUsd}
              openTrades={s.trades.filter((t) => t.tokenId === token.id && t.closedAt === undefined)} thesisRef={thesisRef}
              onDraft={(patch) => dispatch({ type: "draft", patch })} onSettings={(patch) => dispatch({ type: "settings", patch })}
              onBuy={() => dispatch({ type: "buy" })} onOrder={() => dispatch({ type: "placeOrder" })}
              onSell={(pct) => dispatch({ type: "sellToken", tokenId: token.id, pct })} onRules={() => setDrawer("reguli")} />
            <XFeed token={token} others={others} onQuickBuy={quickBuy} />
          </>
        ) : <p className="empty center">Alege un token ca să vezi execuția.</p>}
      </aside>

      <nav className="mnav" aria-label="Vederi">
        <button aria-pressed={view === "radar"} onClick={() => setView("radar")}><RadarIcon size={16} strokeWidth={1.75} />Radar</button>
        <button aria-pressed={view === "chart"} onClick={() => setView("chart")}><CandlestickChart size={16} strokeWidth={1.75} />Grafic</button>
        <button aria-pressed={view === "trade"} onClick={() => setView("trade")}><ArrowLeftRight size={16} strokeWidth={1.75} />Swap · X</button>
      </nav>

      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} aria-hidden />
          <aside className="drawer" aria-label="Panou">
            <div className="panel-head">
              <div className="tabs" role="tablist">
                {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={drawer === k} onClick={() => setDrawer(k)}>{label}</button>)}
              </div>
              <button className="ibtn sm" onClick={() => setDrawer(null)} aria-label="Închide panoul"><X size={14} strokeWidth={2} /></button>
            </div>
            {drawer === "reguli" && (
              <RulesPanel rules={s.rules} ideas={s.ideas} session={session}
                onRule={(rule) => dispatch({ type: "rule", rule })} onRemoveRule={(id) => dispatch({ type: "removeRule", id })}
                onAddIdea={(text) => dispatch({ type: "addIdea", text })} onRemoveIdea={(id) => dispatch({ type: "removeIdea", id })} />
            )}
            {drawer === "portofel" && <Portfolio trades={s.trades} tokens={s.tokens} bankrollUsd={s.bankrollUsd} onBankroll={(usd) => dispatch({ type: "bankroll", usd })} />}
            {drawer === "setari" && (
              <SettingsPanel settings={s.settings} solUsd={s.natives[s.chain]} speed={s.speed} onChange={(patch) => dispatch({ type: "settings", patch })}
                onSpeed={(speed) => dispatch({ type: "speed", speed })} onResetDay={() => dispatch({ type: "resetDay" })} onResetAll={() => dispatch({ type: "resetAll" })} />
            )}
          </aside>
        </>
      )}

      {walletOpen && (
        <WalletModal connected={s.wallet.connected} balanceUsd={balanceUsd} nativeUsd={s.natives[s.chain]} symbol={NATIVE[s.chain].symbol}
          onConnect={() => { dispatch({ type: "wallet", connected: true }); setWalletOpen(false); }}
          onDisconnect={() => { dispatch({ type: "wallet", connected: false }); setWalletOpen(false); }}
          onClose={() => setWalletOpen(false)} />
      )}
      <Toasts toasts={s.toasts} onDismiss={(id) => dispatch({ type: "dismiss", id })} />
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
