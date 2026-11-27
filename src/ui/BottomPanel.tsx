import { Fragment, useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { LimitOrder, PriceAlert, TapeTrade, Token, Trade } from "../domain/types";
import { fmtPct, fmtUsd } from "../domain/rules";
import { lessons } from "../domain/signals";
import { markToMarket, positionValue, stopPrice } from "../execution/executor";
import { marketData } from "../data/market";
import { REASON } from "../store/cockpit";
import { Alerts, Holders } from "./Market";
import { age } from "./RadarColumn";
import { fmtPrice } from "./TokenStrip";

type Tab = "pozitii" | "istoric" | "alerte" | "tranzactii" | "holderi";

interface Props {
  token: Token | null;
  tokens: Token[];
  trades: Trade[];
  orders: LimitOrder[];
  alerts: PriceAlert[];
  brakeHits: number;
  now: number;
  sellConfirm: string | null;
  onSell: (id: string, pct: number, confirmed?: boolean) => void;
  onCancelSell: () => void;
  onEdit: (id: string, p: { tpPct?: number; slPct?: number; trailPct?: number }) => void;
  onToggle2x: (id: string) => void;
  onNote: (id: string, note: string) => void;
  onCancelOrder: (id: string) => void;
  onSelect: (tokenId: string) => void;
  onAddAlert: (op: "above" | "below", price: number) => void;
  onRemoveAlert: (id: string) => void;
}

function Signed({ v }: { v: number }) {
  return <span className={`num ${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}`}>{v >= 0 ? "+" : "−"}{fmtUsd(Math.abs(v))}</span>;
}

function Toggle2x({ t, onToggle }: { t: Trade; onToggle: () => void }) {
  if (t.recovered) return <span className="mini-tag good" title={`2x atins: ${fmtUsd(t.recovered.usd)} recuperați`}>Initial Recovered · Moonbag</span>;
  return (
    <button role="switch" aria-checked={t.auto2x} className="tgl sm" onClick={onToggle} title="2x Auto-Breakeven: la ≥ 2× intrarea vinde 50% și mută stopul la intrare">
      <i aria-hidden /> 2x
    </button>
  );
}

function TapeTable({ token }: { token: Token }) {
  const [rows, setRows] = useState<TapeTrade[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = false;
    setRows(null);
    const load = () => marketData.tape(token, Date.now()).then((r) => { if (!stop) { setRows(r.slice(0, 30)); setErr(false); } }).catch(() => !stop && setErr(true));
    load();
    const id = window.setInterval(load, 20_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [token.id]);
  if (err && !rows) return <p className="empty">Nu răspunde acum (limită de cereri). Reîncerc în 20 s.</p>;
  if (!rows) return <p className="empty">Se încarcă…</p>;
  return (
    <table className="grid">
      <thead><tr><th>când</th><th>tip</th><th className="r">sumă</th><th className="r">preț</th><th className="r">portofel</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={r.usd >= 1000 ? "big" : ""}>
            <td className="num dim">{age((Date.now() - r.ts) / 60_000)}</td>
            <td className={r.side === "buy" ? "pos" : "neg"}>{r.side === "buy" ? "cumpărare" : "vânzare"}</td>
            <td className="num r">{fmtUsd(r.usd)}</td>
            <td className="num r dim">{r.priceUsd.toPrecision(4)}</td>
            <td className="num r dim">{r.wallet.slice(0, 4)}…{r.wallet.slice(-3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Positions(p: Props) {
  const [edit, setEdit] = useState<string | null>(null);
  const open = p.trades.filter((t) => t.closedAt === undefined);
  const pending = p.orders.filter((o) => o.status === "open");
  const price = (t: Trade) => p.tokens.find((k) => k.id === t.tokenId)?.priceUsd ?? t.entryPrice;
  if (!open.length && !pending.length) return <p className="empty">Nicio poziție deschisă. Ieșirea nu e niciodată blocată; doar intrarea are frână.</p>;
  return (
    <>
      {open.length > 0 && (
        <table className="grid">
          <thead><tr><th>token</th><th className="r">investit</th><th className="r">valoare</th><th className="r">PnL</th><th className="r">stop</th><th>2x</th><th className="hide-sm">teză</th><th></th></tr></thead>
          <tbody>
            {open.map((t) => {
              const px = price(t);
              const pnl = markToMarket(t, px);
              const stopDist = px > 0 ? ((px - stopPrice(t)) / px) * 100 : 0;
              const confirming = p.sellConfirm === t.id;
              return (
                <Fragment key={t.id}>
                  <tr>
                    <td><button className="link-cell" onClick={() => p.onSelect(t.tokenId)}><b>{t.symbol}</b></button>{t.tpHit && <span className="mini-tag">TP luat</span>}</td>
                    <td className="num r">{fmtUsd(t.sizeUsd)}</td>
                    <td className="num r">{fmtUsd(positionValue(t, px))}</td>
                    <td className="r"><span className={`num ${pnl >= 0 ? "pos" : "neg"}`}>{fmtPct((pnl / t.sizeUsd) * 100)}</span> <Signed v={pnl} /></td>
                    <td className="num r dim">−{Math.max(0, stopDist).toFixed(1)}%</td>
                    <td><Toggle2x t={t} onToggle={() => p.onToggle2x(t.id)} /></td>
                    <td className="hide-sm dim ell thesis-cell" title={t.thesis.text}>{t.thesis.text}</td>
                    <td className="r actions">
                      {confirming ? (
                        <>
                          <span className="confirm-q">Vinzi tot ({fmtUsd(positionValue(t, px))})?</span>
                          <button className="sell-btn strong" onClick={() => p.onSell(t.id, 100, true)}>Da, Sell 100%</button>
                          <button className="ibtn sm" onClick={p.onCancelSell} aria-label="Renunță"><X size={12} strokeWidth={2} /></button>
                        </>
                      ) : (
                        <>
                          <button className="sell-btn" onClick={() => p.onSell(t.id, 50)}>Sell 50%</button>
                          <button className="sell-btn strong" onClick={() => p.onSell(t.id, 100)}>Sell 100%</button>
                          <button className="ibtn sm" onClick={() => setEdit(edit === t.id ? null : t.id)} aria-expanded={edit === t.id} aria-label="Plan de ieșire"><SlidersHorizontal size={12} strokeWidth={2} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                  {edit === t.id && (
                    <tr className="edit-row"><td colSpan={8}>
                      <label>TP +<input className="in num xs" type="number" value={t.tpPct >= 1e6 ? "" : t.tpPct} placeholder="off" min={1} step={10} disabled={t.tpHit} onChange={(e) => p.onEdit(t.id, { tpPct: parseFloat(e.target.value) })} />%</label>
                      <label>SL −<input className="in num xs" type="number" value={t.slPct} min={1} max={t.slPct} step={1} disabled={t.tpHit || !!t.recovered} onChange={(e) => p.onEdit(t.id, { slPct: parseFloat(e.target.value) })} />%</label>
                      <label>Trailing după TP<input className="in num xs" type="number" value={t.trailPct} min={0} step={5} onChange={(e) => p.onEdit(t.id, { trailPct: parseFloat(e.target.value) })} />%</label>
                      <span className="dim">Stopul se poate doar strânge, niciodată lărgi. Vânzare estimată la {fmtPrice(px * (1 - t.exec.slippageBps / 10_000))} după alunecare.</span>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {pending.length > 0 && (
        <table className="grid">
          <thead><tr><th>ordin limită</th><th className="r">sumă</th><th className="r">la preț ≤</th><th className="r">expiră</th><th className="hide-sm">teză</th><th></th></tr></thead>
          <tbody>
            {pending.map((o) => (
              <tr key={o.id}>
                <td><b>{o.symbol}</b></td>
                <td className="num r">{fmtUsd(o.sizeUsd)}</td>
                <td className="num r">{fmtPrice(o.triggerPrice)}</td>
                <td className="num r dim">{Math.max(0, Math.round((o.expiresAt - p.now) / 60_000))} min</td>
                <td className="hide-sm dim ell thesis-cell">{o.thesis.text}</td>
                <td className="r"><button className="ibtn sm" onClick={() => p.onCancelOrder(o.id)} aria-label="Anulează ordinul"><X size={12} strokeWidth={2} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function History(p: Props) {
  const history = p.trades.filter((t) => t.closedAt !== undefined).slice().reverse();
  const l = lessons(p.trades, (id) => p.tokens.find((t) => t.id === id)?.priceUsd, p.brakeHits);
  const rate = (n: number, w: number) => (n ? `${Math.round((w / n) * 100)}%` : "—");
  return (
    <>
      <dl className="lessons">
        <div><dt>Realizat</dt><dd><Signed v={l.realizedUsd} /></dd></div>
        <div><dt>Nerealizat</dt><dd><Signed v={l.unrealizedUsd} /></dd></div>
        <div><dt>Win-rate</dt><dd className="num">{l.winRate === null ? "—" : `${Math.round(l.winRate * 100)}%`} <span className="dim">({l.closed})</span></dd></div>
        <div><dt>Spike</dt><dd className="num">{rate(l.spike.n, l.spike.wins)} <span className="dim">din {l.spike.n}</span></dd></div>
        <div><dt>Tracțiune normală</dt><dd className="num">{rate(l.normal.n, l.normal.wins)} <span className="dim">din {l.normal.n}</span></dd></div>
        <div><dt>Frâna a intervenit</dt><dd className="num">{l.brakeHits}×</dd></div>
      </dl>
      <p className="lesson-note">{l.note}</p>
      {history.length ? (
        <table className="grid">
          <thead><tr><th>token</th><th>ieșire</th><th>intrare</th><th className="r">investit</th><th className="r">rezultat</th><th className="r">când</th><th>notiță</th></tr></thead>
          <tbody>
            {history.map((t) => (
              <tr key={t.id}>
                <td><b>{t.symbol}</b>{t.acceptedWarnings && <span className="mini-tag warn" title={t.brakeReasons.join(" · ")}>peste frână</span>}{t.recovered && <span className="mini-tag good">2x</span>}</td>
                <td className="dim">{REASON[t.exitReason!]}</td>
                <td className="dim">{t.entryMove === "spike" ? "spike" : "normală"}</td>
                <td className="num r">{fmtUsd(t.sizeUsd)}</td>
                <td className="r"><Signed v={t.pnlUsd ?? 0} /></td>
                <td className="num r dim">{age((p.now - (t.closedAt ?? 0)) / 60_000)}</td>
                <td><input className="in note-in" defaultValue={t.note ?? ""} placeholder="ce am învățat" maxLength={280} aria-label={`Notiță pentru ${t.symbol}`} onBlur={(e) => e.target.value !== (t.note ?? "") && p.onNote(t.id, e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="empty">Încă niciun trade închis. Lecțiile apar după primele ieșiri.</p>}
    </>
  );
}

function AutoAlerts(p: Props) {
  const open = p.trades.filter((t) => t.closedAt === undefined);
  const recovered = p.trades.filter((t) => t.recovered).slice(-8).reverse();
  return (
    <div className="auto2x">
      {p.token ? <Alerts token={p.token} alerts={p.alerts} onAdd={p.onAddAlert} onRemove={p.onRemoveAlert} /> : <p className="empty">Alege un token ca să pui o alertă.</p>}
      <section className="auto2x-list">
        <h3>Auto-2x</h3>
        {open.length === 0 && recovered.length === 0 && <p className="dim small">Nicio poziție. Toggle-ul 2x se setează din panoul de swap, înainte de intrare, sau pe fiecare poziție.</p>}
        <ul>
          {open.map((t) => (
            <li key={t.id}>
              <b>{t.symbol}</b>
              <span className="num dim">ținta {fmtPrice(t.entryPrice * 2)}</span>
              <Toggle2x t={t} onToggle={() => p.onToggle2x(t.id)} />
            </li>
          ))}
          {recovered.filter((t) => t.closedAt !== undefined).map((t) => (
            <li key={`r-${t.id}`} className="done"><b>{t.symbol}</b><span className="num dim">2x la {fmtPrice(t.recovered!.price)}</span><Signed v={t.recovered!.usd} /></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function BottomPanel(p: Props) {
  const [tab, setTab] = useState<Tab>("pozitii");
  const openCount = p.trades.filter((t) => t.closedAt === undefined).length + p.orders.filter((o) => o.status === "open").length;
  const closed = p.trades.filter((t) => t.closedAt !== undefined).length;
  const tabs: [Tab, string, number?][] = [
    ["pozitii", "Poziții Active", openCount], ["istoric", "Istoric & Lecții", closed],
    ["alerte", "Alerte & Auto-2x", p.alerts.filter((a) => !a.firedAt && a.tokenId === p.token?.id).length],
    ["tranzactii", "Tranzacții"], ["holderi", "Holderi"],
  ];
  return (
    <section className="bottom" aria-label="Poziții și activitate">
      <div className="tabs bottom-tabs" role="tablist">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{n ? <span className="count num">{n}</span> : null}</button>
        ))}
      </div>
      <div className="bottom-body">
        {tab === "pozitii" && <Positions {...p} />}
        {tab === "istoric" && <History {...p} />}
        {tab === "alerte" && <AutoAlerts {...p} />}
        {tab === "tranzactii" && (p.token ? <TapeTable token={p.token} /> : <p className="empty">Alege un token.</p>)}
        {tab === "holderi" && (p.token ? <Holders token={p.token} /> : <p className="empty">Alege un token.</p>)}
      </div>
    </section>
  );
}
