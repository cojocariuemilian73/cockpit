import { useEffect, useRef, useState } from "react";
import { Search, ScrollText, Wallet, Settings as Cog, Keyboard } from "lucide-react";
import type { Chain, SessionView, Token } from "../domain/types";
import { fmtDuration, fmtMetric, fmtUsd } from "../domain/rules";
import { NATIVE, chainOfCa, market } from "../data/market";

export type DrawerTab = "reguli" | "portofel" | "setari";

interface Props {
  chain: Chain;
  natives: Record<Chain, number>;
  priorityFeeSol: number;
  session: SessionView;
  now: number;
  balanceUsd: number;
  walletConnected: boolean;
  drawer: DrawerTab | null;
  searchRef: React.RefObject<HTMLInputElement>;
  onChain: (c: Chain) => void;
  onPick: (t: Token) => void;
  onDrawer: (t: DrawerTab) => void;
  onWallet: () => void;
  onHelp: () => void;
}

function age(min?: number) {
  if (min === undefined) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 2880) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}z`;
}

function TokenSearch({ chain, inputRef, onPick, onChain }: { chain: Chain; inputRef: React.RefObject<HTMLInputElement>; onPick: (t: Token) => void; onChain: (c: Chain) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [results, setResults] = useState<Token[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 || chainOfCa(text, chain)) { setResults(null); return; }
    const id = ++seq.current;
    const h = window.setTimeout(async () => {
      try {
        const r = await market.search(chain, text);
        if (id === seq.current) setResults(r);
      } catch { if (id === seq.current) setMsg("Căutarea nu răspunde acum."); }
    }, 300);
    return () => window.clearTimeout(h);
  }, [q, chain]);

  async function load(text: string) {
    const c = chainOfCa(text, chain);
    if (!c) { if (results?.[0]) pick(results[0]); return; }
    if (c !== chain) onChain(c);
    setBusy(true);
    setMsg(null);
    const { token, offline } = await market.lookup(c, text);
    setBusy(false);
    if (!token) return setMsg(offline ? "Fără conexiune la date." : `Niciun pool pe ${NATIVE[c].label} pentru adresa asta.`);
    pick(token);
  }

  function pick(t: Token) {
    setQ(""); setResults(null); setMsg(null);
    inputRef.current?.blur();
    onPick(t);
  }

  return (
    <div className="search">
      <form onSubmit={(e) => { e.preventDefault(); load(q.trim()); }} role="search">
        <Search size={14} strokeWidth={2} aria-hidden className="search-ico" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setMsg(null); }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").trim();
            if (chainOfCa(text, chain)) { e.preventDefault(); setQ(text); load(text); }
          }}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setResults(null); (e.target as HTMLInputElement).blur(); } }}
          placeholder="CA sau $TICKER"
          aria-label="Caută după adresă sau ticker"
          spellCheck={false}
          autoComplete="off"
        />
        {busy ? <span className="search-hint">caut…</span> : <kbd className="kbd">/</kbd>}
      </form>
      {(results || msg) && (
        <div className="search-pop" role="listbox">
          {msg && <p className="search-msg">{msg}</p>}
          {results?.length === 0 && <p className="search-msg">Nimic pe {NATIVE[chain].label} cu numele ăsta.</p>}
          {results?.map((t) => (
            <button key={t.id} className="search-row" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
              <b>{t.symbol}</b>
              <span className="dim ell">{t.name}</span>
              <span className="num">{t.metrics.liquidityUsd !== undefined ? fmtMetric("liquidityUsd", t.metrics.liquidityUsd) : "—"}</span>
              <span className="num dim">{age(t.metrics.ageMin)}</span>
              <span className="num dim">{t.ca.slice(0, 4)}…{t.ca.slice(-4)}</span>
            </button>
          ))}
          {results && results.length > 1 && <p className="search-warn">Același nume poate fi o copie. Compară lichiditatea, vârsta și adresa.</p>}
        </div>
      )}
    </div>
  );
}

export function Header(p: Props) {
  const s = p.session;
  const native = NATIVE[p.chain];
  const nativeUsd = p.natives[p.chain];
  return (
    <header className="hdr">
      <div className="logo">
        <span className="logo-mark" aria-hidden />
        <span className="logo-name">COCKPIT</span>
        <span className="logo-sub">decizie cu frână</span>
      </div>

      <div className="seg chain-seg" role="radiogroup" aria-label="Rețea">
        {(Object.keys(NATIVE) as Chain[]).map((c) => (
          <button key={c} role="radio" aria-checked={p.chain === c} onClick={() => p.onChain(c)}>{NATIVE[c].label}</button>
        ))}
      </div>

      <TokenSearch chain={p.chain} inputRef={p.searchRef} onPick={p.onPick} onChain={p.onChain} />

      <div className="gas num" title="Prețul monedei native și taxa de prioritate">
        <span>{native.symbol} <b>{fmtUsd(nativeUsd)}</b></span>
        <span className="sep">|</span>
        <span>Prioritate <b>{p.priorityFeeSol} {native.symbol}</b></span>
      </div>

      <div className={`sess sess-${s.state}`} role="status" aria-live="polite" title="Limitele sesiunii, din regulile tale">
        <span className="sess-dot" aria-hidden />
        <span className="num">{s.tradesUsed}/{s.tradesMax ?? "∞"}</span>
        <span className="sess-sep" aria-hidden />
        <span className="num">risc {s.riskUsedPct.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}/{s.riskMaxPct ?? "∞"}%</span>
        <span className="sess-sep" aria-hidden />
        <span>
          {s.state === "active" && "Activ"}
          {s.state === "cooldown" && <>Cooldown <span className="num">{fmtDuration((s.cooldownUntil ?? p.now) - p.now)}</span></>}
          {s.state === "limit" && "Oprit pe azi"}
        </span>
      </div>

      <nav className="hdr-actions" aria-label="Panouri">
        <button className={`ibtn ${p.drawer === "reguli" ? "on" : ""}`} onClick={() => p.onDrawer("reguli")} title="Reguli (R)" aria-label="Reguli"><ScrollText size={15} strokeWidth={1.75} /></button>
        <button className={`ibtn ${p.drawer === "portofel" ? "on" : ""}`} onClick={() => p.onDrawer("portofel")} title="Portofel și statistici (P)" aria-label="Portofel și statistici"><Wallet size={15} strokeWidth={1.75} /></button>
        <button className={`ibtn ${p.drawer === "setari" ? "on" : ""}`} onClick={() => p.onDrawer("setari")} title="Setări (S)" aria-label="Setări"><Cog size={15} strokeWidth={1.75} /></button>
        <button className="ibtn hide-md" onClick={p.onHelp} title="Scurtături (?)" aria-label="Scurtături"><Keyboard size={15} strokeWidth={1.75} /></button>
      </nav>

      <button className={`wallet-btn ${p.walletConnected ? "on" : ""}`} onClick={p.onWallet}>
        {p.walletConnected ? (
          <>
            <span className="wallet-dot" aria-hidden />
            <span className="num">{(p.balanceUsd / nativeUsd).toLocaleString("ro-RO", { maximumFractionDigits: 2 })} {native.symbol}</span>
            <span className="wallet-tag">hârtie</span>
          </>
        ) : "Connect Wallet"}
      </button>
    </header>
  );
}
