import { useEffect, useMemo, useRef, useState } from "react";
import { X, Radar as RadarIcon, CandlestickChart, ArrowLeftRight } from "lucide-react";
import { useCockpit, dayKey, durableOf, dataStatus, equityUsd, selectBuy, selected, NATIVE_PRESETS } from "./store/cockpit";
import { evaluateSession } from "./domain/rules";
import { antiTilt } from "./domain/tilt";
import { exportDurable } from "./domain/schema";
import type { Chain, Token } from "./domain/types";
import { NATIVE, marketData } from "./data/market";
import { Header, type DrawerTab } from "./ui/Header";
import { RadarColumn } from "./ui/RadarColumn";
import { TokenStrip } from "./ui/TokenStrip";
import { Answers } from "./ui/Answers";
import { Chart } from "./ui/Chart";
import { BottomPanel } from "./ui/BottomPanel";
import { SwapPanel } from "./ui/SwapPanel";
import { XFeed, useSocialFeed } from "./ui/XFeed";
import { RulesPanel } from "./ui/RulesPanel";
import { Portfolio } from "./ui/Portfolio";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Boundary } from "./ui/Boundary";
import { ShortcutHelp, TiltBanner, Toasts, WalletModal } from "./ui/Overlays";

const TABS: [DrawerTab, string][] = [["reguli", "Reguli"], ["portofel", "Portofel"], ["setari", "Setări"]];
type MobileView = "radar" | "chart" | "trade";

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  const [s, dispatch] = useCockpit();
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [help, setHelp] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [view, setView] = useState<MobileView>("chart");
  const [focus, setFocus] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const thesisRef = useRef<HTMLTextAreaElement>(null);
  const day = dayKey(s.now);

  const token = selected(s);
  const buy = selectBuy(s);
  const session = evaluateSession(s.rules, s.trades, s.bankrollUsd, day, s.now);
  const tilt = antiTilt(s.trades, s.now, s.settings, s.tiltHiddenDay, day);
  const tokenChain: Chain = token?.chain ?? s.chain;
  const others = useMemo(() => s.tokens.filter((t) => t.id !== token?.id), [s.tokens, token?.id]);
  const caFeed = useSocialFeed(token, "ca", others);

  const toggleDrawer = (t: DrawerTab) => setDrawer((d) => (d === t ? null : t));

  function pick(t: Token) {
    dispatch({ type: "addToken", token: t });
    setView("chart");
  }

  /** Quick Buy: doar încarcă tokenul și precompletează suma. Cumpărarea trece tot prin frână. */
  async function quickBuy(ca: string, chain?: Chain) {
    const amount = s.draft.amount;
    const known = s.tokens.find((t) => t.ca === ca);
    if (known) dispatch({ type: "addToken", token: known, amount });
    else {
      const { token: t } = await marketData.lookup(chain ?? s.chain, ca, Date.now());
      if (!t) return;
      dispatch({ type: "addToken", token: t, amount });
    }
    setView("trade");
    window.setTimeout(() => thesisRef.current?.focus(), 60);
  }

  const chainRef = useRef(tokenChain);
  chainRef.current = tokenChain;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (k >= "1" && k <= "4" && k.length === 1) dispatch({ type: "draft", patch: { side: "buy", amount: String(NATIVE_PRESETS[chainRef.current][Number(k) - 1]) } });
      else if (k === "r") toggleDrawer("reguli");
      else if (k === "p") toggleDrawer("portofel");
      else if (k === "s") toggleDrawer("setari");
      else if (k === "f") setFocus((v) => !v);
      else if (k === "b") dispatch({ type: "draft", patch: { side: "buy" } });
      else if (k === "v") dispatch({ type: "draft", patch: { side: "sell" } });
      else if (k === "?") setHelp((v) => !v);
      else if (k === "escape") { setHelp(false); setDrawer(null); setWalletOpen(false); dispatch({ type: "cancelBuy" }); dispatch({ type: "cancelSell" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const equity = equityUsd(s);

  return (
    <div className="term" data-view={view} data-state={session.state} data-focus={focus || undefined}>
      <Boundary name="Bara de sus" className="hdr">
        <Header chain={s.chain} natives={s.natives} mode={s.mode} status={dataStatus(s)} liveTick={s.settings.liveTick} focus={focus}
          session={session} now={s.now} cashUsd={s.cashUsd} drawer={drawer} searchRef={searchRef}
          onChain={(chain) => dispatch({ type: "chain", chain })} onPick={pick} onDrawer={toggleDrawer}
          onMode={(mode) => dispatch({ type: "mode", mode })} onLiveTick={(on) => dispatch({ type: "settings", patch: { liveTick: on } })}
          onFocus={() => setFocus((v) => !v)} onReset={() => dispatch({ type: "resetDemo" })}
          onExport={() => download(`cockpit-demo-${day}.json`, exportDurable(durableOf(s), s.now))}
          onImport={(text) => dispatch({ type: "import", text })}
          onWallet={() => setWalletOpen(true)} onHelp={() => setHelp(true)} />
      </Boundary>

      {!focus && (
        <Boundary name="Radarul" className="col col-left">
          <RadarColumn chain={s.chain} rules={s.rules} tokens={s.tokens} watchlist={s.watchlist} selectedId={s.selectedId} tracked={s.tracked}
            filters={s.eph.radarFilters} onFilter={(filter) => dispatch({ type: "radarFilter", filter })}
            onPick={pick} onStar={(t) => dispatch({ type: "star", token: t })}
            onTrack={(address, label) => dispatch({ type: "track", address, label })} onUntrack={(address) => dispatch({ type: "untrack", address })} />
        </Boundary>
      )}

      <main className="col col-center">
        {token ? (
          <>
            <Boundary name="Banda tokenului"><TokenStrip token={token} starred={s.watchlist.includes(token.id)} onStar={() => dispatch({ type: "star", token })} /></Boundary>
            <Boundary name="Cele trei răspunsuri"><Answers token={token} checks={buy.checks} risk={buy.risk} tweets={caFeed.rows} now={s.now} /></Boundary>
            <div className="chart-wrap">
              <Boundary name="Graficul"><Chart token={token} trades={s.trades} orders={s.orders} /></Boundary>
              {tilt.active && (
                <TiltBanner reasons={tilt.reasons} minLabel={`${NATIVE_PRESETS[tokenChain][0]} ${NATIVE[tokenChain].symbol}`}
                  onMin={() => dispatch({ type: "tilt", act: "minSize" })} onHide={() => dispatch({ type: "tilt", act: "hide" })} />
              )}
            </div>
          </>
        ) : <p className="empty center">Caută un token (tasta /) sau alege unul din radar.</p>}
        <Boundary name="Pozițiile" className="bottom">
          <BottomPanel token={token} tokens={s.tokens} trades={s.trades} orders={s.orders} alerts={s.alerts} brakeHits={s.brakeHits} now={s.now}
            sellConfirm={s.eph.sellConfirm}
            onSell={(id, pct, confirmed) => dispatch({ type: "sell", tradeId: id, pct, confirmed })}
            onCancelSell={() => dispatch({ type: "cancelSell" })}
            onEdit={(id, p) => dispatch({ type: "editExit", tradeId: id, ...p })}
            onToggle2x={(id) => dispatch({ type: "toggle2x", tradeId: id })}
            onNote={(id, note) => dispatch({ type: "noteTrade", tradeId: id, note })}
            onCancelOrder={(id) => dispatch({ type: "cancelOrder", id })}
            onSelect={(id) => dispatch({ type: "select", id })}
            onAddAlert={(op, price) => dispatch({ type: "addAlert", op, price })}
            onRemoveAlert={(id) => dispatch({ type: "removeAlert", id })} />
        </Boundary>
      </main>

      <aside className="col col-right" aria-label="Execuție și X">
        {token ? (
          <>
            <Boundary name="Panoul de swap">
              <SwapPanel token={token} chain={tokenChain} nativeUsd={s.natives[tokenChain]} draft={s.draft} session={session} mode={s.mode}
                settings={s.settings} buy={buy} confirm={s.eph.confirm} sellConfirm={s.eph.sellConfirm}
                openTrades={s.trades.filter((t) => t.tokenId === token.id && t.closedAt === undefined)} thesisRef={thesisRef}
                onDraft={(patch) => dispatch({ type: "draft", patch })} onSettings={(patch) => dispatch({ type: "settings", patch })}
                onPreset={(preset) => dispatch({ type: "preset", preset })}
                onBuy={(nonce, snapshotPrice) => dispatch({ type: "buy", nonce, tokenId: token.id, snapshotPrice })}
                onConfirm={(id) => dispatch({ type: "confirmBuy", id })} onCancel={() => dispatch({ type: "cancelBuy" })}
                onSell={(pct, confirmed) => dispatch({ type: "sellToken", tokenId: token.id, pct, confirmed })}
                onCancelSell={() => dispatch({ type: "cancelSell" })} onRules={() => setDrawer("reguli")} />
            </Boundary>
            {!focus && (
              <Boundary name="Feed-ul X" className="xfeed">
                <XFeed token={token} others={others} caFeed={caFeed} query={s.eph.xQuery} now={s.now}
                  onQuery={(q) => dispatch({ type: "xQuery", q })} onQuickBuy={quickBuy} />
              </Boundary>
            )}
          </>
        ) : <p className="empty center">Alege un token ca să vezi execuția.</p>}
      </aside>

      <nav className="mnav" aria-label="Vederi">
        <button aria-pressed={view === "radar"} onClick={() => { setFocus(false); setView("radar"); }}><RadarIcon size={16} strokeWidth={1.75} />Radar</button>
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
            <Boundary name="Sertarul">
              {drawer === "reguli" && (
                <RulesPanel rules={s.rules} ideas={s.ideas} session={session}
                  onRule={(rule) => dispatch({ type: "rule", rule })} onRemoveRule={(id) => dispatch({ type: "removeRule", id })}
                  onAddIdea={(text) => dispatch({ type: "addIdea", text })} onRemoveIdea={(id) => dispatch({ type: "removeIdea", id })} />
              )}
              {drawer === "portofel" && <Portfolio trades={s.trades} tokens={s.tokens} cashUsd={s.cashUsd} bankrollUsd={s.bankrollUsd} equityUsd={equity} />}
              {drawer === "setari" && <SettingsPanel settings={s.settings} solUsd={s.natives.solana} onChange={(patch) => dispatch({ type: "settings", patch })} />}
            </Boundary>
          </aside>
        </>
      )}

      {walletOpen && <WalletModal mode={s.mode} cashUsd={s.cashUsd} equityUsd={equity} solUsd={s.natives.solana} onMode={(mode) => dispatch({ type: "mode", mode })} onClose={() => setWalletOpen(false)} />}
      <Toasts toasts={s.toasts} onDismiss={(id) => dispatch({ type: "dismiss", id })} onUndo={() => dispatch({ type: "undoReset" })} />
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
