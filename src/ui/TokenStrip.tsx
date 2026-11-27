import { useState } from "react";
import { Copy, Check as CheckIcon, ExternalLink, Star } from "lucide-react";
import type { Token } from "../domain/types";
import { fmtMetric } from "../domain/rules";

export function fmtPrice(p: number) {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  const zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  return `$${p.toFixed(Math.min(12, zeros + 4))}`;
}

/** Logo-ul tokenului sau inițialele, pe un cerc nuanțat din adresă (fără imagini lipsă rupte). */
export function TokenLogo({ token, size = 28 }: { token: Token; size?: number }) {
  const [broken, setBroken] = useState(false);
  const hue = [...token.ca].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  if (token.imageUrl && !broken) {
    return <img className="tlogo" src={token.imageUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className="tlogo tlogo-txt" style={{ width: size, height: size, background: `hsl(${hue} 22% 22%)`, fontSize: size * 0.38 }} aria-hidden>
      {token.symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Badge({ ok, label, title }: { ok: boolean | undefined; label: string | [string, string, string]; title?: string }) {
  const text = typeof label === "string" ? label : label[ok === undefined ? 2 : ok ? 0 : 1];
  const cls = ok === undefined ? "unk" : ok ? "ok" : "bad";
  return <span className={`sbadge sbadge-${cls}`} title={title ?? (ok === undefined ? "date lipsă" : undefined)}>{text}</span>;
}

const money = (v?: number) => (v === undefined ? "—" : fmtMetric("liquidityUsd", v).replace(" ", ""));

export function TokenStrip({ token, starred, onStar }: { token: Token; starred: boolean; onStar: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token.ca);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard indisponibil */ }
  }
  const top10 = token.metrics.top10Pct;
  const lp = token.rug?.lpLockedPct;
  return (
    <div className="strip">
      <TokenLogo token={token} size={30} />
      <div className="strip-id">
        <div className="strip-name">
          <b>{token.symbol}</b><span className="dim ell">{token.name}</span>
          <button className={`star ${starred ? "on" : ""}`} onClick={onStar} aria-pressed={starred} aria-label={starred ? "Scoate din Watchlist" : "Adaugă în Watchlist"}><Star size={13} strokeWidth={1.9} /></button>
        </div>
        <button className={`ca ${copied ? "copied" : ""}`} onClick={copy} title="Copiază adresa contractului">
          <span className="num">{token.ca.slice(0, 5)}…{token.ca.slice(-4)}</span>
          {copied ? <><CheckIcon size={11} strokeWidth={2.5} /> copiat</> : <Copy size={11} strokeWidth={2} />}
        </button>
      </div>
      <div className="strip-price num">{fmtPrice(token.priceUsd)}</div>
      <dl className="strip-stats">
        <div><dt>MC</dt><dd className="num">{money(token.metrics.mcapUsd)}</dd></div>
        <div><dt>Liq</dt><dd className="num">{money(token.metrics.liquidityUsd)}</dd></div>
        <div><dt>Vol 1h</dt><dd className="num">{money(token.volume1hUsd)}</dd></div>
        <div><dt>Holderi</dt><dd className="num">{token.metrics.holders?.toLocaleString("ro-RO") ?? "—"}</dd></div>
      </dl>
      <div className="strip-badges">
        <Badge ok={token.flags.mintRenounced} label={["Mint off", "Mint ON", "Mint ?"]} />
        <Badge ok={token.flags.freezeRenounced} label={["Freeze off", "Freeze ON", "Freeze ?"]} />
        <Badge ok={token.flags.lpBurned} label={lp !== undefined ? `LP ${Math.round(lp)}% blocat` : ["LP burned", "LP neblocat", "LP ?"]} title={lp !== undefined ? `LP blocat/ars: ${lp.toFixed(1)}%` : undefined} />
        <Badge ok={top10 === undefined ? undefined : top10 < 30} label={top10 !== undefined ? `Top10 ${top10.toFixed(0)}%` : "Top10"} />
        {token.rug && <Badge ok={token.rug.score < 5} label={`RC ${token.rug.score}/10`} title={`RugCheck: ${token.rug.risks.map((r) => r.name).join(", ") || "fără riscuri"}`} />}
        {token.socials?.x && <a className="sbadge sbadge-link" href={token.socials.x} target="_blank" rel="noreferrer noopener">X <ExternalLink size={10} strokeWidth={2} /></a>}
        {token.source === "mock" && <span className="sbadge sbadge-unk">demo</span>}
      </div>
    </div>
  );
}
