import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Trash2, X as XIcon } from "lucide-react";
import type { Chain, Rule, Token, TrackedWallet, WalletActivity } from "../domain/types";
import { evaluateToken, fmtMetric, fmtUsd } from "../domain/rules";
import { riskScore } from "../domain/risk";
import { market, type RadarKind } from "../data/market";
import { walletActivity, walletsAreDemo } from "../data/wallets";
import { TokenLogo } from "./TokenStrip";

type Tab = "noi" | "trend" | "wallets";
type Filter = "noMint" | "lpBurned" | "top10" | "hasX";
const FILTERS: [Filter, string][] = [["noMint", "No Mint"], ["lpBurned", "LP Burned"], ["top10", "Top10 < 20%"], ["hasX", "Has X"]];

export function age(min?: number) {
  if (min === undefined) return "—";
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  if (min < 2880) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}z`;
}

const money = (v?: number) => (v === undefined ? "—" : fmtMetric("liquidityUsd", v).replace(" ", ""));

/** Un filtru trece doar dacă valoarea e știută și bună. Necunoscutul nu trece. */
function passes(t: Token, f: Filter): boolean {
  switch (f) {
    case "noMint": return t.flags.mintRenounced === true;
    case "lpBurned": return t.flags.lpBurned === true;
    case "top10": return t.metrics.top10Pct !== undefined ? t.metrics.top10Pct < 20 : false;
    case "hasX": return !!t.socials?.x;
  }
}

function RiskBadge({ score }: { score: number }) {
  const lvl = score >= 7 ? "hi" : score >= 4 ? "mid" : "lo";
  return <span className={`rbadge rbadge-${lvl}`} title={`Scor de risc ${score}/10`}>{score}</span>;
}

function Row({ t, rules, active, onPick }: { t: Token; rules: Rule[]; active: boolean; onPick: () => void }) {
  const checks = evaluateToken(t, rules);
  const r = riskScore(t, checks);
  const blocked = checks.some((c) => c.status === "fail");
  return (
    <button className={`trow ${active ? "sel" : ""} ${blocked ? "blocked" : ""}`} onClick={onPick} title={blocked ? `Încalcă: ${checks.filter((c) => c.status === "fail").map((c) => c.label).join(", ")}` : undefined}>
      <TokenLogo token={t} size={26} />
      <span className="trow-main">
        <span className="trow-top"><b className="ell">{t.symbol}</b><span className="num dim">{age(t.metrics.ageMin)}</span></span>
        <span className="trow-sub num"><span className="dim">MC</span> {money(t.metrics.mcapUsd)} <span className="dim">V</span> {money(t.volume1hUsd)}</span>
      </span>
      <RiskBadge score={r.score} />
    </button>
  );
}

function Wallets({ tracked, tokens, onTrack, onUntrack, onPick }: {
  tracked: TrackedWallet[]; tokens: Token[]; onTrack: (a: string, l: string) => void; onUntrack: (a: string) => void; onPick: (t: Token) => void;
}) {
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [rows, setRows] = useState<WalletActivity[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () => walletActivity(tracked, tokens).then((r) => !stop && setRows(r)).catch(() => undefined);
    load();
    const id = window.setInterval(load, 30_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [tracked, tokens.length]);
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/.test(addr.trim());
  return (
    <div className="wt">
      <form className="wt-form" onSubmit={(e) => { e.preventDefault(); if (valid) { onTrack(addr.trim(), label.trim() || `${addr.trim().slice(0, 4)}…`); setAddr(""); setLabel(""); } }}>
        <input className="in" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Adresa portofelului" aria-label="Adresa portofelului" spellCheck={false} />
        <input className="in short" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nume" aria-label="Numele portofelului" />
        <button className="ibtn" type="submit" disabled={!valid} aria-label="Urmărește portofelul"><Plus size={14} strokeWidth={2} /></button>
      </form>
      {tracked.length === 0 ? (
        <p className="empty">Adaugă un portofel ca să-i vezi cumpărările și vânzările aici.</p>
      ) : (
        <>
          <ul className="wt-list">
            {tracked.map((w) => (
              <li key={w.address}><b>{w.label}</b><span className="num dim">{w.address.slice(0, 4)}…{w.address.slice(-4)}</span>
                <button className="ibtn sm" onClick={() => onUntrack(w.address)} aria-label={`Nu mai urmări ${w.label}`}><Trash2 size={12} strokeWidth={1.75} /></button></li>
            ))}
          </ul>
          {walletsAreDemo && <p className="demo-note">Activitate DEMO: urmărirea reală cere un indexer (Helius/Birdeye) pe server.</p>}
          <ul className="wt-acts">
            {rows.map((a) => (
              <li key={a.id}>
                <button className="wt-act" onClick={() => onPick(a.token)}>
                  <span className={a.side === "buy" ? "pos" : "neg"}>{a.side === "buy" ? "C" : "V"}</span>
                  <b className="ell">{a.label}</b>
                  <span className="ell">{a.token.symbol}</span>
                  <span className="num">{fmtUsd(a.usd)}</span>
                  <span className="num dim">{age((Date.now() - a.ts) / 60_000)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function RadarColumn({ chain, rules, tokens, selectedId, tracked, onPick, onRemove, onTrack, onUntrack }: {
  chain: Chain; rules: Rule[]; tokens: Token[]; selectedId: string | null; tracked: TrackedWallet[];
  onPick: (t: Token) => void; onRemove: (id: string) => void; onTrack: (a: string, l: string) => void; onUntrack: (a: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("trend");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [rows, setRows] = useState<Token[] | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [hideBlocked, setHideBlocked] = useState(true);

  useEffect(() => {
    if (tab === "wallets") return;
    let stop = false;
    setRows(null); setErr(false);
    const load = async () => {
      try {
        const r = await market.radar(chain, tab as RadarKind);
        if (stop) return;
        setRows(r); setErr(false);
        // RugCheck pe rând, în coadă: completează filtrele No Mint / LP / Top10
        for (const t of r.slice(0, 20)) {
          market.rugcheck(t).then((p) => {
            if (!stop && Object.keys(p).length) setRows((cur) => cur?.map((x) => (x.id === t.id ? { ...x, ...p, flags: { ...x.flags, ...p.flags } } : x)) ?? cur);
          }).catch(() => undefined);
        }
      } catch { if (!stop) setErr(true); }
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [tab, chain, tick]);

  const visible = useMemo(() => {
    const list = rows ?? [];
    return list.filter((t) => [...filters].every((f) => passes(t, f)));
  }, [rows, filters]);
  const blocked = visible.filter((t) => evaluateToken(t, rules).some((c) => c.status === "fail"));
  const shown = hideBlocked ? visible.filter((t) => !blocked.includes(t)) : visible;
  const watch = tokens.filter((t) => t.chain === chain || t.source === "mock");

  const toggle = (f: Filter) => setFilters((cur) => { const n = new Set(cur); n.has(f) ? n.delete(f) : n.add(f); return n; });

  return (
    <section className="col col-left" aria-label="Radar">
      {watch.length > 0 && (
        <div className="watch">
          {watch.map((t) => (
            <span key={t.id} className={`wchip ${t.id === selectedId ? "sel" : ""}`}>
              <button onClick={() => onPick(t)}>{t.symbol}{t.source === "mock" && <i className="demo-dot" title="demo" />}</button>
              <button className="wchip-x" onClick={() => onRemove(t.id)} aria-label={`Scoate ${t.symbol}`}><XIcon size={10} strokeWidth={2.25} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="col-head">
        <div className="tabs" role="tablist">
          {([["noi", "New Pairs"], ["trend", "Trending"], ["wallets", "Wallet Tracker"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab !== "wallets" && <button className="ibtn sm" onClick={() => setTick((x) => x + 1)} aria-label="Reîmprospătează"><RefreshCw size={12} strokeWidth={2} /></button>}
      </div>

      {tab === "wallets" ? (
        <Wallets tracked={tracked} tokens={rows ?? tokens} onTrack={onTrack} onUntrack={onUntrack} onPick={onPick} />
      ) : (
        <>
          <div className="pills" role="group" aria-label="Filtre rapide">
            {FILTERS.map(([k, l]) => <button key={k} className="pill" aria-pressed={filters.has(k)} onClick={() => toggle(k)}>{l}</button>)}
          </div>
          <div className="tlist">
            {err && <p className="empty">Sursa nu răspunde acum (limită de cereri). Reîncerc automat.</p>}
            {!rows && !err && <p className="empty">Se încarcă…</p>}
            {rows && shown.length === 0 && (
              <p className="empty">{filters.size ? "Nimic nu trece de filtrele alese. Un filtru fără date nu trece." : "Nimic nu trece de regulile tale critice acum. Asta e frâna care lucrează."}</p>
            )}
            {shown.map((t) => <Row key={t.id} t={t} rules={rules} active={t.id === selectedId} onPick={() => onPick(t)} />)}
          </div>
          {blocked.length > 0 && (
            <button className="tlist-foot" onClick={() => setHideBlocked((v) => !v)} aria-pressed={!hideBlocked}>
              {hideBlocked ? `${blocked.length} ascunse de regulile tale · arată` : `ascunde cele ${blocked.length} care încalcă reguli`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
