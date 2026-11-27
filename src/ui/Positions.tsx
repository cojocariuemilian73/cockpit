import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { LimitOrder, Token, Trade } from "../domain/types";
import { fmtPct, fmtUsd } from "../domain/rules";
import { markToMarket, stopPrice } from "../execution/executor";

export const REASON = { tp: "take profit", sl: "stop loss", breakeven: "stop la intrare", trailing: "trailing stop", timp: "timp expirat", manual: "vândut manual" } as const;

function Position({ t, price, onSell, onEdit }: {
  t: Trade; price: number; onSell: (pct: number) => void; onEdit: (p: { tpPct?: number; slPct?: number; trailPct?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const pnl = markToMarket(t, price);
  const pct = (pnl / t.sizeUsd) * 100;
  const stopDist = ((price - stopPrice(t)) / price) * 100;
  return (
    <div className="position">
      <div className="pos-row">
        <div className="pos-main">
          <b>{t.symbol}</b>
          <span className="num dim">{fmtUsd(t.sizeUsd)}</span>
          {t.tpHit && <span className="tag-soft">TP luat</span>}
        </div>
        <span className="pos-thesis" title={t.thesis.text}>„{t.thesis.text}”</span>
        <span className={`num pos-pnl ${pnl >= 0 ? "pos-up" : "pos-down"}`}>{fmtPct(pct)}</span>
        <div className="sell-group" role="group" aria-label={`Vinde ${t.symbol}`}>
          {[25, 50].map((p) => <button key={p} className="btn-sell" onClick={() => onSell(p)}>{p}%</button>)}
          <button className="btn-sell strong" onClick={() => onSell(100)}>Tot</button>
        </div>
        <button className="icon-btn small" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Plan de ieșire">
          <ChevronDown size={15} strokeWidth={1.75} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 180ms" }} />
        </button>
      </div>
      {open && (
        <div className="pos-edit">
          <label>TP <span className="dim">+</span><input className="num-in num" type="number" value={t.tpPct} min={1} step={5} disabled={t.tpHit}
            onChange={(e) => onEdit({ tpPct: parseFloat(e.target.value) })} />%</label>
          <label>SL <span className="dim">−</span><input className="num-in num" type="number" value={t.slPct} min={1} max={t.slPct} step={1} disabled={t.tpHit}
            onChange={(e) => onEdit({ slPct: parseFloat(e.target.value) })} />%</label>
          <label>Trailing după TP<input className="num-in num" type="number" value={t.trailPct} min={0} step={5}
            onChange={(e) => onEdit({ trailPct: parseFloat(e.target.value) })} />%</label>
          <span className="dim small">Stopul e la <span className="num">{stopDist.toFixed(1)}%</span> sub preț. Se poate doar strânge, niciodată lărgi.</span>
        </div>
      )}
    </div>
  );
}

export function Positions({ trades, orders, tokens, day, onSell, onEdit, onCancelOrder }: {
  trades: Trade[]; orders: LimitOrder[]; tokens: Token[]; day: string;
  onSell: (id: string, pct: number) => void;
  onEdit: (id: string, p: { tpPct?: number; slPct?: number; trailPct?: number }) => void;
  onCancelOrder: (id: string) => void;
}) {
  const today = trades.filter((t) => t.day === day);
  const open = trades.filter((t) => t.closedAt === undefined);
  const closed = today.filter((t) => t.closedAt !== undefined).reverse();
  const pending = orders.filter((o) => o.status === "open");
  const price = (tokenId: string, fallback: number) => tokens.find((k) => k.id === tokenId)?.priceUsd ?? fallback;

  if (!open.length && !closed.length && !pending.length) return null;

  return (
    <section className="positions" aria-label="Poziții și ordine">
      {open.map((t) => (
        <Position key={t.id} t={t} price={price(t.tokenId, t.entryPrice)} onSell={(pct) => onSell(t.id, pct)} onEdit={(p) => onEdit(t.id, p)} />
      ))}
      {pending.map((o) => (
        <div key={o.id} className="order">
          <span className="tag-soft">limită</span>
          <b>{o.symbol}</b>
          <span className="num dim">{fmtUsd(o.sizeUsd)} la ≤ {o.triggerPrice.toPrecision(4)} $</span>
          <span className="dim small order-exp">expiră în {Math.max(0, Math.round((o.expiresAt - Date.now()) / 60_000))} min</span>
          <button className="icon-btn small" onClick={() => onCancelOrder(o.id)} aria-label="Anulează ordinul"><X size={14} strokeWidth={1.75} /></button>
        </div>
      ))}
      {closed.length > 0 && (
        <details className="journal">
          <summary>Închise azi <span className="num dim">{closed.length}</span></summary>
          <ul>
            {closed.map((t) => (
              <li key={t.id}>
                <b>{t.symbol}</b>
                <span className="tag-soft">{t.thesis.tag}</span>
                <span className="dim">{REASON[t.exitReason!]}</span>
                {t.acceptedWarnings && <span className="tag-soft warn">cu atenționări</span>}
                <span className={`num ${(t.pnlUsd ?? 0) >= 0 ? "pos-up" : "pos-down"}`}>{(t.pnlUsd ?? 0) >= 0 ? "+" : "−"}{fmtUsd(Math.abs(t.pnlUsd ?? 0))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
