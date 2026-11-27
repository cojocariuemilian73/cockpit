import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Trash2, Star, X as XIcon } from "lucide-react";
import type { Chain, Rule, Token, TrackedWallet, WalletActivity } from "../domain/types";
import { evaluateToken, fmtMetric, fmtPct, fmtUsd } from "../domain/rules";
import { riskScore } from "../domain/risk";
import { filterTokens, type RadarFilter } from "../domain/signals";
import { marketData, security, type RadarKind } from "../data/market";
import { socialFeed } from "../data/x";
import { TokenLogo } from "./TokenStrip";

type Tab = "noi" | "trend" | "watch" | "wallets";
const TABS: [Tab, string][] = [["noi", "New Pairs"], ["trend", "Trending"], ["watch", "Watchlist"], ["wallets", "Wallet Tracker"]];
const FILTERS: [RadarFilter, string][] = [["noMint", "No Mint"], ["lpBurned", "LP Burned"], ["top10", "Top10 < 20%"], ["hasX", "Has X"]];

export function age(min?: number) {
  if (min === undefined || !Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  if (min < 2880) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}z`;
}

const money = (v?: number) => (v === undefined ? "—" : fmtMetric("liquidityUsd", v).replace(" ", ""));

function RiskBadge({ score }: { score: number }) {
  const lvl = score >= 7 ? "hi" : score >= 4 ? "mid" : "lo";
  return <span className={`rbadge rbadge-${lvl}`} title={`Scor de risc ${score}/10`}>{score}</span>;
}

function Row({ t, rules, active, starred, onPick, onStar }: { t: Token; rules: Rule[]; active: boolean; starred: boolean; onPick: () => void; onStar: () => void }) {
  const checks = evaluateToken(t, rules);
  const r = riskScore(t, checks);
  const blocked = checks.some((c) => c.status === "fail");
  const ch = t.change1hPct;
  return (
    <div className={`trow ${active ? "sel" : ""} ${blocked ? "blocked" : ""}`}>
      <button className="trow-pick" onClick={onPick} title={blocked ? `Încalcă: ${checks.filter((c) => c.status === "fail").map((c) => c.label).join(", ")}` : undefined}>
        <TokenLogo token={t} size={26} />
        <span className="trow-main">
          <span className="trow-top"><b className="ell">{t.symbol}</b>{t.source === "mock" && <i className="demo-dot" title="demo" />}<span className="num dim">{age(t.metrics.ageMin)}</span></span>
          <span className="trow-sub num"><span className="dim">MC</span> {money(t.metrics.mcapUsd)} <span className="dim">V</span> {money(t.volume1hUsd)}</span>
        </span>
        <span className="trow-right">
          <span className={`num trow-ch ${ch > 0 ? "pos" : ch < 0 ? "neg" : "dim"}`} title="Variația pe 1 oră">{fmtPct(ch)}</span>
          <RiskBadge score={r.score} />
        </span>
      </button>
      <button className={`star ${starred ? "on" : ""}`} onClick={onStar} aria-pressed={starred} aria-label={starred ? `Scoate ${t.symbol} din Watchlist` : `Adaugă ${t.symbol} în Watchlist`}>
        <Star size={13} strokeWidth={1.9} />
      </button>
    </div>
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
    const load = () => socialFeed.wallets(tracked, tokens, Date.now()).then((r) => !stop && setRows(r.slice(0, 40))).catch(() => undefined);
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
          {socialFeed.walletsDemo && <p className="demo-note">Activitate DEMO: urmărirea reală cere un indexer (Helius/Birdeye) pe server.</p>}
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

interface Props {
  chain: Chain; rules: Rule[]; tokens: Token[]; watchlist: string[]; selectedId: string | null; tracked: TrackedWallet[];
  filters: RadarFilter[]; onFilter: (f: RadarFilter | null) => void;
  onPick: (t: Token) => void; onStar: (t: Token) => void; onTrack: (a: string, l: string) => void; onUntrack: (a: string) => void;
}

export function RadarColumn(p: Props) {
  const [tab, setTab] = useState<Tab>("trend");
  const [rows, setRows] = useState<Token[] | null>(null);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [hideBlocked, setHideBlocked] = useState(true);
  const remote = tab === "noi" || tab === "trend";

  useEffect(() => {
    if (!remote) return;
    let stop = false;
    setRows(null); setErr(false);
    const load = async () => {
      try {
        const r = (await marketData.radar(p.chain, tab as RadarKind)).slice(0, 40);
        if (stop) return;
        setRows(r); setErr(false);
        // RugCheck pe rând, în coadă: completează filtrele No Mint / LP
        for (const t of r.slice(0, 20)) {
          security.quick(t).then((x) => {
            if (!stop && Object.keys(x).length) setRows((cur) => cur?.map((y) => (y.id === t.id ? { ...y, ...x, flags: { ...y.flags, ...x.flags } } : y)) ?? cur);
          }).catch(() => undefined);
        }
      } catch { if (!stop) setErr(true); }
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [tab, p.chain, tick]);

  const watch = useMemo(() => p.tokens.filter((t) => p.watchlist.includes(t.id)), [p.tokens, p.watchlist]);
  const list = tab === "watch" ? watch : rows ?? [];
  const view = useMemo(() => filterTokens(list, p.filters, p.rules, tab === "watch" ? false : hideBlocked), [list, p.filters, p.rules, hideBlocked, tab]);
  const loading = remote && !rows && !err;

  return (
    <section className="col col-left" aria-label="Radar">
      <div className="col-head">
        <div className="tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}{k === "watch" && watch.length > 0 && <span className="count num">{watch.length}</span>}
            </button>
          ))}
        </div>
        {remote && <button className="ibtn sm" onClick={() => setTick((x) => x + 1)} aria-label="Reîmprospătează"><RefreshCw size={12} strokeWidth={2} /></button>}
      </div>

      {tab === "wallets" ? (
        <Wallets tracked={p.tracked} tokens={rows ?? p.tokens} onTrack={p.onTrack} onUntrack={p.onUntrack} onPick={p.onPick} />
      ) : (
        <>
          <div className="pills" role="group" aria-label="Filtre rapide">
            {FILTERS.map(([k, l]) => <button key={k} className="pill" aria-pressed={p.filters.includes(k)} onClick={() => p.onFilter(k)}>{l}</button>)}
          </div>
          <div className="tlist-meta num" aria-live="polite">
            <span>{loading ? "se încarcă…" : `${view.shown.length} ${view.shown.length === 1 ? "rezultat" : "rezultate"}${view.shown.length !== view.total ? ` din ${view.total}` : ""}`}</span>
            {p.filters.length > 0 && <button className="link-btn" onClick={() => p.onFilter(null)}><XIcon size={11} strokeWidth={2.25} aria-hidden /> Reset filtre</button>}
          </div>
          <div className="tlist">
            {err && <p className="empty">Sursa nu răspunde acum (limită de cereri). Reîncerc automat; Watchlist merge în continuare.</p>}
            {loading && <div className="skel" aria-hidden>{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>}
            {!loading && !err && view.shown.length === 0 && (
              <p className="empty">
                {tab === "watch" && watch.length === 0 ? "Watchlist e goală. Apasă steaua de pe un rând sau de lângă numele tokenului."
                  : p.filters.length ? "Nimic nu trece de filtrele alese. Un filtru fără date nu trece."
                    : "Nimic nu trece de regulile tale critice acum. Asta e frâna care lucrează."}
              </p>
            )}
            {view.shown.map((t) => (
              <Row key={t.id} t={t} rules={p.rules} active={t.id === p.selectedId} starred={p.watchlist.includes(t.id)} onPick={() => p.onPick(t)} onStar={() => p.onStar(t)} />
            ))}
          </div>
          {tab !== "watch" && view.hiddenByRules > 0 && (
            <button className="tlist-foot" onClick={() => setHideBlocked((v) => !v)} aria-pressed={!hideBlocked}>
              {hideBlocked ? `${view.hiddenByRules} ascunse de regulile tale · arată` : `ascunde cele ${view.hiddenByRules} care încalcă reguli`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
