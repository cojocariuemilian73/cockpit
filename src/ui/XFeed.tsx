import { useEffect, useState } from "react";
import { BadgeCheck, Eye, Heart, Search, Zap } from "lucide-react";
import type { Token, Tweet } from "../domain/types";
import { filterTweets, xSignal } from "../domain/signals";
import { socialFeed } from "../data/x";
import type { XMode } from "../data/adapters";
import { age } from "./RadarColumn";

export interface FeedState { rows: Tweet[] | null; err: boolean }

/** Încarcă feed-ul X pentru un token, la 45 s. Folosit de feed și de semnalul X din centru. */
export function useSocialFeed(token: Token | null, mode: XMode, others: Token[]): FeedState {
  const [state, setState] = useState<FeedState>({ rows: null, err: false });
  useEffect(() => {
    if (!token) return;
    let stop = false;
    setState({ rows: null, err: false });
    const load = () => socialFeed.feed(token, mode, others, Date.now())
      .then((rows) => !stop && setState({ rows, err: false }))
      .catch(() => !stop && setState((s) => ({ ...s, err: true })));
    load();
    const id = window.setInterval(load, 45_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [token?.id, mode, others.length]);
  return state;
}

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}k` : String(n);
}

function Avatar({ seed }: { seed: string }) {
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11);
  return <span className="avatar" style={{ background: `hsl(${hue} 25% 26%)` }} aria-hidden>{seed.replace("demo_", "").slice(0, 1).toUpperCase()}</span>;
}

/** Feed X pentru tokenul curent. Quick Buy doar încarcă tokenul și precompletează suma: cumpărarea trece tot prin frână. */
export function XFeed({ token, others, caFeed, query, now, onQuery, onQuickBuy }: {
  token: Token; others: Token[]; caFeed: FeedState; query: string; now: number;
  onQuery: (q: string) => void; onQuickBuy: (ca: string, chain: Tweet["chain"]) => void;
}) {
  const [mode, setMode] = useState<XMode>("ca");
  const own = useSocialFeed(mode === "ca" ? null : token, mode, others);
  const { rows, err } = mode === "ca" ? caFeed : own;
  const shown = rows ? filterTweets(rows, query) : null;
  const sig = rows ? xSignal(rows, token, now) : null;

  return (
    <section className="xfeed" aria-label="Feed X">
      <div className="col-head">
        <div className="tabs" role="tablist">
          {([["ca", "CA Mentions"], ["ticker", `$${token.symbol}`], ["kol", "KOLs / Alpha"]] as [XMode, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        {sig && <span className={`xsig xsig-${sig.label}`} title={`${sig.mentions} mențiuni în 60 min, ${sig.kols} de la KOL`}>{sig.label}</span>}
      </div>
      <label className="xsearch">
        <Search size={12} strokeWidth={2} aria-hidden />
        <input value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onQuery("")} placeholder="Filtrează postările" aria-label="Filtrează postările X" spellCheck={false} />
        {shown && rows && query && <span className="num dim">{shown.length}/{rows.length}</span>}
      </label>
      {socialFeed.demo && <p className="demo-note">Feed DEMO cu conturi inventate. Pentru postări reale e nevoie de un proxy X (VITE_X_PROXY).</p>}
      <div className="xlist">
        {err && !rows && <p className="empty">Feed-ul nu răspunde acum. Reîncerc la 45 s.</p>}
        {!rows && !err && <p className="empty">Se încarcă…</p>}
        {rows?.length === 0 && <p className="empty">Nimeni nu vorbește încă despre {token.symbol}.</p>}
        {rows && rows.length > 0 && shown?.length === 0 && <p className="empty">Nicio postare cu „{query}”. <button className="link-btn" onClick={() => onQuery("")}>Șterge filtrul</button></p>}
        {shown?.map((t) => (
          <article key={t.id} className="tweet">
            <Avatar seed={t.author.avatarSeed} />
            <div className="tweet-body">
              <div className="tweet-head">
                <b className="ell">{t.author.name}</b>
                {t.author.verified && <BadgeCheck size={12} strokeWidth={2.25} className="verified" aria-label="verificat" />}
                <span className="dim ell">@{t.author.handle}</span>
                <span className="dim num">· {age((now - t.ts) / 60_000)}</span>
              </div>
              <p className="tweet-text">{t.text}</p>
              <div className="tweet-foot">
                <span className="dim num"><Eye size={11} strokeWidth={2} aria-hidden /> {compact(t.views)}</span>
                <span className="dim num"><Heart size={11} strokeWidth={2} aria-hidden /> {compact(t.likes)}</span>
                {t.ca && (
                  <button className="qbuy" onClick={() => onQuickBuy(t.ca!, t.chain)} title="Încarcă tokenul și precompletează suma. Cumpărarea trece prin frână.">
                    <Zap size={11} strokeWidth={2.25} aria-hidden /> Quick Buy
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
