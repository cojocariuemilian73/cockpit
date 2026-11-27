import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import type { PriceAlert, Token } from "../domain/types";

/** Distribuția deținătorilor: o singură bară, o singură nuanță, mai închis = mai concentrat. */
export function Holders({ token }: { token: Token }) {
  const d = token.holdersDist;
  if (!d) {
    return (
      <div className="holders">
        <span className="holders-title">Distribuție</span>
        <span className="dim small">{token.source === "live" ? "se încarcă de la GeckoTerminal…" : "nu există pentru tokenurile demo"}</span>
      </div>
    );
  }
  const parts = [
    { k: "Top 10", v: d.top10, o: 1 },
    { k: "11–20", v: d.r11_20, o: 0.7 },
    { k: "21–40", v: d.r21_40, o: 0.5 },
    { k: "Restul", v: d.rest, o: 0.28 },
  ];
  return (
    <div className="holders">
      <span className="holders-title">Distribuție</span>
      <div className="hbar" role="img" aria-label={parts.map((p) => `${p.k} ${p.v.toFixed(1)}%`).join(", ")}>
        {parts.map((p) => <i key={p.k} style={{ flexGrow: Math.max(p.v, 0.5), opacity: p.o }} title={`${p.k}: ${p.v.toFixed(1)}%`} />)}
      </div>
      <ul className="hlegend">
        {parts.map((p) => (
          <li key={p.k}><i style={{ opacity: p.o }} aria-hidden />{p.k} <span className="num">{p.v.toFixed(1)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

/** Alerte de preț pe tokenul curent. */
export function Alerts({ token, alerts, onAdd, onRemove }: {
  token: Token; alerts: PriceAlert[]; onAdd: (op: "above" | "below", price: number) => void; onRemove: (id: string) => void;
}) {
  const [price, setPrice] = useState("");
  const mine = alerts.filter((a) => a.tokenId === token.id);
  const p = parseFloat(price.replace(",", "."));
  const op: "above" | "below" = p >= token.priceUsd ? "above" : "below";
  return (
    <div className="alerts">
      <form className="alert-form" onSubmit={(e) => { e.preventDefault(); if (p > 0) { onAdd(op, p); setPrice(""); } }}>
        <Bell size={14} strokeWidth={1.75} aria-hidden className="dim" />
        <span className="small">Anunță-mă când prețul trece</span>
        <input className="num-in num wide" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={token.priceUsd.toPrecision(3)} aria-label="Prețul alertei" />
        <button className="btn-ghost small" type="submit" disabled={!(p > 0)}>{p > 0 ? (op === "above" ? "Peste" : "Sub") : "Pune"}</button>
      </form>
      {mine.length > 0 && (
        <ul className="alert-list">
          {mine.map((a) => (
            <li key={a.id} className={a.firedAt ? "fired" : ""}>
              <span>{a.op === "above" ? "peste" : "sub"} <span className="num">{a.price.toPrecision(4)} $</span></span>
              <span className="dim small">{a.firedAt ? "declanșată" : "activă"}</span>
              <button className="icon-btn small" onClick={() => onRemove(a.id)} aria-label="Șterge alerta"><Trash2 size={13} strokeWidth={1.75} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
