import { Fragment, useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { LimitOrder, PriceAlert, TapeTrade, Token, Trade } from "../domain/types";
import { fmtPct, fmtUsd } from "../domain/rules";
import { markToMarket, stopPrice } from "../execution/executor";
import { market } from "../data/market";
import { REASON } from "../store/cockpit";
import { Alerts, Holders } from "./Market";
import { age } from "./RadarColumn";

type Tab = "pozitii" | "ordine" | "istoric" | "tranzactii" | "holderi" | "alerte";

interface Props {
  token: Token | null;
  tokens: Token[];
  trades: Trade[];
  orders: LimitOrder[];
  alerts: PriceAlert[];
  onSell: (id: string, pct: number) => void;
  onEdit: (id: string, p: { tpPct?: number; slPct?: number; trailPct?: number }) => void;
  onCancelOrder: (id: string) => void;
  onSelect: (tokenId: string) => void;
  onAddAlert: (op: "above" | "below", price: number) => void;
  onRemoveAlert: (id: string) => void;
}

function Signed({ v }: { v: number }) {
  return <span className={`num ${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}`}>{v >= 0 ? "+" : "−"}{fmtUsd(Math.abs(v))}</span>;
}

function TapeTable({ token }: { token: Token }) {
  const [rows, setRows] = useState<TapeTrade[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = false;
    setRows(null);
    const load = () => market.tape(token).then((r) => { if (!stop) { setRows(r); setErr(false); } }).catch(() => !stop && setErr(true));
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

function PositionsTable({ trades, tokens, onSell, onEdit, onSelect }: Pick<Props, "trades" | "tokens" | "onSell" | "onEdit" | "onSelect">) {
  const [edit, setEdit] = useState<string | null>(null);
  const open = trades.filter((t) => t.closedAt === undefined);
  if (!open.length) return <p className="empty">Nicio poziție deschisă. Ieșirea nu e niciodată blocată; doar intrarea are frână.</p>;
  const price = (t: Trade) => tokens.find((k) => k.id === t.tokenId)?.priceUsd ?? t.entryPrice;
  return (
    <table className="grid">
      <thead><tr><th>token</th><th className="r">investit</th><th className="r">valoare</th><th className="r">PnL</th><th className="r">stop</th><th className="hide-sm">teză</th><th></th></tr></thead>
      <tbody>
        {open.map((t) => {
          const p = price(t);
          const pnl = markToMarket(t, p);
          const value = t.sizeUsd + pnl;
          const stopDist = ((p - stopPrice(t)) / p) * 100;
          return (
            <Fragment key={t.id}>
              <tr>
                <td><button className="link-cell" onClick={() => onSelect(t.tokenId)}><b>{t.symbol}</b></button>{t.tpHit && <span className="mini-tag">TP luat</span>}</td>
                <td className="num r">{fmtUsd(t.sizeUsd)}</td>
                <td className="num r">{fmtUsd(value)}</td>
                <td className="r"><span className={`num ${pnl >= 0 ? "pos" : "neg"}`}>{fmtPct((pnl / t.sizeUsd) * 100)}</span> <Signed v={pnl} /></td>
                <td className="num r dim">−{Math.max(0, stopDist).toFixed(1)}%</td>
                <td className="hide-sm dim ell thesis-cell" title={t.thesis.text}>{t.thesis.text}</td>
                <td className="r actions">
                  <button className="sell-btn" onClick={() => onSell(t.id, 50)}>Sell 50%</button>
                  <button className="sell-btn strong" onClick={() => onSell(t.id, 100)}>Sell 100%</button>
                  <button className="ibtn sm" onClick={() => setEdit(edit === t.id ? null : t.id)} aria-expanded={edit === t.id} aria-label="Plan de ieșire"><SlidersHorizontal size={12} strokeWidth={2} /></button>
                </td>
              </tr>
              {edit === t.id && (
                <tr className="edit-row"><td colSpan={7}>
                  <label>TP +<input className="in num xs" type="number" value={t.tpPct >= 1e6 ? "" : t.tpPct} placeholder="off" min={1} step={10} disabled={t.tpHit} onChange={(e) => onEdit(t.id, { tpPct: parseFloat(e.target.value) })} />%</label>
                  <label>SL −<input className="in num xs" type="number" value={t.slPct} min={1} max={t.slPct} step={1} disabled={t.tpHit} onChange={(e) => onEdit(t.id, { slPct: parseFloat(e.target.value) })} />%</label>
                  <label>Trailing după TP<input className="in num xs" type="number" value={t.trailPct} min={0} step={5} onChange={(e) => onEdit(t.id, { trailPct: parseFloat(e.target.value) })} />%</label>
                  <span className="dim">Stopul se poate doar strânge, niciodată lărgi. Vânzare estimată la {(p * (1 - t.exec.slippageBps / 10_000)).toPrecision(4)} $ după alunecare.</span>
                </td></tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function BottomPanel(p: Props) {
  const [tab, setTab] = useState<Tab>("pozitii");
  const openCount = p.trades.filter((t) => t.closedAt === undefined).length;
  const pending = p.orders.filter((o) => o.status === "open");
  const history = p.trades.filter((t) => t.closedAt !== undefined).slice().reverse();
  const tabs: [Tab, string, number?][] = [
    ["pozitii", "Poziții", openCount], ["ordine", "Ordine limită", pending.length], ["istoric", "Istoric", history.length],
    ["tranzactii", "Tranzacții"], ["holderi", "Holderi"], ["alerte", "Alerte", p.alerts.filter((a) => !a.firedAt && a.tokenId === p.token?.id).length],
  ];
  return (
    <section className="bottom" aria-label="Poziții și activitate">
      <div className="tabs bottom-tabs" role="tablist">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{n ? <span className="count num">{n}</span> : null}</button>
        ))}
      </div>
      <div className="bottom-body">
        {tab === "pozitii" && <PositionsTable trades={p.trades} tokens={p.tokens} onSell={p.onSell} onEdit={p.onEdit} onSelect={p.onSelect} />}
        {tab === "ordine" && (pending.length ? (
          <table className="grid">
            <thead><tr><th>token</th><th className="r">sumă</th><th className="r">la preț ≤</th><th className="r">expiră</th><th className="hide-sm">teză</th><th></th></tr></thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.symbol}</b></td>
                  <td className="num r">{fmtUsd(o.sizeUsd)}</td>
                  <td className="num r">{o.triggerPrice.toPrecision(4)} $</td>
                  <td className="num r dim">{Math.max(0, Math.round((o.expiresAt - Date.now()) / 60_000))} min</td>
                  <td className="hide-sm dim ell thesis-cell">{o.thesis.text}</td>
                  <td className="r"><button className="ibtn sm" onClick={() => p.onCancelOrder(o.id)} aria-label="Anulează ordinul"><X size={12} strokeWidth={2} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">Niciun ordin limită. Ordinele trec din nou prin reguli când se declanșează.</p>)}
        {tab === "istoric" && (history.length ? (
          <table className="grid">
            <thead><tr><th>token</th><th>ieșire</th><th className="hide-sm">teză</th><th className="r">investit</th><th className="r">rezultat</th><th className="r">când</th></tr></thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.symbol}</b>{t.acceptedWarnings && <span className="mini-tag warn">peste atenționări</span>}</td>
                  <td className="dim">{REASON[t.exitReason!]}</td>
                  <td className="hide-sm dim ell thesis-cell"><span className="mini-tag">{t.thesis.tag}</span> {t.thesis.text}</td>
                  <td className="num r">{fmtUsd(t.sizeUsd)}</td>
                  <td className="r"><Signed v={t.pnlUsd ?? 0} /></td>
                  <td className="num r dim">{age((Date.now() - (t.closedAt ?? 0)) / 60_000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">Încă niciun trade închis.</p>)}
        {tab === "tranzactii" && (p.token ? <TapeTable token={p.token} /> : <p className="empty">Alege un token.</p>)}
        {tab === "holderi" && (p.token ? <Holders token={p.token} /> : <p className="empty">Alege un token.</p>)}
        {tab === "alerte" && (p.token ? <Alerts token={p.token} alerts={p.alerts} onAdd={p.onAddAlert} onRemove={p.onRemoveAlert} /> : <p className="empty">Alege un token.</p>)}
      </div>
    </section>
  );
}
