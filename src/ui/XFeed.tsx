import { useEffect, useState } from "react";
import { BadgeCheck, Eye, Heart, Zap } from "lucide-react";
import type { Token, Tweet } from "../domain/types";
import { xFeed, xIsDemo, type XMode } from "../data/x";
import { age } from "./RadarColumn";

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}k` : String(n);
}

function Avatar({ seed }: { seed: string }) {
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 11);
  return <span className="avatar" style={{ background: `hsl(${hue} 25% 26%)` }} aria-hidden>{seed.replace("demo_", "").slice(0, 1).toUpperCase()}</span>;
}

/** Feed X pentru tokenul curent. „Quick Buy” doar încarcă tokenul și precompletează suma: cumpărarea trece tot prin frână. */
export function XFeed({ token, others, onQuickBuy }: { token: Token; others: Token[]; onQuickBuy: (ca: string, chain: Tweet["chain"]) => void }) {
  const [mode, setMode] = useState<XMode>("ca");
  const [rows, setRows] = useState<Tweet[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let stop = false;
    setRows(null);
    const load = () => xFeed(token, mode, others).then((r) => { if (!stop) { setRows(r); setErr(false); } }).catch(() => !stop && setErr(true));
    load();
    const id = window.setInterval(load, 45_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [token.id, mode, others.length]);

  return (
    <section className="xfeed" aria-label="Feed X">
      <div className="col-head">
        <div className="tabs" role="tablist">
          {([["ca", "CA Mentions"], ["ticker", `$${token.symbol}`], ["kol", "KOLs / Alpha"]] as [XMode, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
      </div>
      {xIsDemo && <p className="demo-note">Feed DEMO cu conturi inventate. Pentru tweeturi reale e nevoie de un proxy X (VITE_X_PROXY).</p>}
      <div className="xlist">
        {err && <p className="empty">Feed-ul nu răspunde acum.</p>}
        {!rows && !err && <p className="empty">Se încarcă…</p>}
        {rows?.length === 0 && <p className="empty">Nimeni nu vorbește încă despre {token.symbol}.</p>}
        {rows?.map((t) => {
          const isNew = !!t.ca && t.ca !== token.ca;
          return (
            <article key={t.id} className="tweet">
              <Avatar seed={t.author.avatarSeed} />
              <div className="tweet-body">
                <div className="tweet-head">
                  <b className="ell">{t.author.name}</b>
                  {t.author.verified && <BadgeCheck size={12} strokeWidth={2.25} className="verified" aria-label="verificat" />}
                  <span className="dim ell">@{t.author.handle}</span>
                  <span className="dim num">· {age((Date.now() - t.ts) / 60_000)}</span>
                </div>
                <p className="tweet-text">{t.text}</p>
                <div className="tweet-foot">
                  <span className="dim num"><Eye size={11} strokeWidth={2} aria-hidden /> {compact(t.views)}</span>
                  <span className="dim num"><Heart size={11} strokeWidth={2} aria-hidden /> {compact(t.likes)}</span>
                  {isNew && mode === "kol" && (
                    <button className="qbuy" onClick={() => onQuickBuy(t.ca!, t.chain)} title="Încarcă tokenul și precompletează suma. Cumpărarea trece prin frână.">
                      <Zap size={11} strokeWidth={2.25} aria-hidden /> Quick Buy
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
