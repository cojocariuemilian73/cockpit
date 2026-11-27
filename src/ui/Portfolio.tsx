import { useState } from "react";
import { Download } from "lucide-react";
import type { Token, Trade } from "../domain/types";
import { fmtUsd } from "../domain/rules";
import { markToMarket } from "../execution/executor";
import { REASON } from "../store/cockpit";

interface Group { key: string; n: number; wins: number; pnl: number }

function groupBy(trades: Trade[], key: (t: Trade) => string): Group[] {
  const m = new Map<string, Group>();
  for (const t of trades) {
    const k = key(t);
    const g = m.get(k) ?? { key: k, n: 0, wins: 0, pnl: 0 };
    g.n++; g.pnl += t.pnlUsd ?? 0; if ((t.pnlUsd ?? 0) > 0) g.wins++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.pnl - a.pnl);
}

function Signed({ v }: { v: number }) {
  return <span className={`num ${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}`}>{v >= 0 ? "+" : "−"}{fmtUsd(Math.abs(v))}</span>;
}

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  if (!rows.length) return null;
  return (
    <table className="stat-table">
      <caption>{title}</caption>
      <thead><tr><th></th><th className="r">trade-uri</th><th className="r">câștigate</th><th className="r">rezultat</th></tr></thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.key}><td>{g.key}</td><td className="num r">{g.n}</td><td className="num r">{Math.round((g.wins / g.n) * 100)}%</td><td className="r"><Signed v={g.pnl} /></td></tr>
        ))}
      </tbody>
    </table>
  );
}

function exportCsv(trades: Trade[]) {
  const cols = ["deschis", "inchis", "simbol", "ca", "marime_usd", "pret_intrare", "pret_iesire", "motiv", "pnl_usd", "taxe_usd", "teza", "tip_teza", "atentionari_acceptate"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = trades.map((t) => [
    new Date(t.openedAt).toISOString(), t.closedAt ? new Date(t.closedAt).toISOString() : "", t.symbol, t.ca, t.sizeUsd.toFixed(2),
    t.entryPrice, t.exitPrice ?? "", t.exitReason ?? "", t.pnlUsd?.toFixed(2) ?? "", t.feeUsd.toFixed(2), t.thesis.text, t.thesis.tag, t.acceptedWarnings ? "da" : "nu",
  ].map(esc).join(","));
  const blob = new Blob(["﻿" + [cols.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cockpit-jurnal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Portfolio({ trades, tokens, bankrollUsd, onBankroll }: { trades: Trade[]; tokens: Token[]; bankrollUsd: number; onBankroll: (v: number) => void }) {
  const [edit, setEdit] = useState(String(bankrollUsd));
  const closed = trades.filter((t) => t.closedAt !== undefined);
  const open = trades.filter((t) => t.closedAt === undefined);
  const realized = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const unrealized = open.reduce((s, t) => s + markToMarket(t, tokens.find((k) => k.id === t.tokenId)?.priceUsd ?? t.entryPrice), 0);
  const inPositions = open.reduce((s, t) => s + t.sizeUsd, 0);
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnlUsd ?? 0) <= 0);
  const sum = (a: Trade[]) => a.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
  const avgWin = wins.length ? sum(wins) / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;
  const pf = losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : null;
  const fees = trades.reduce((s, t) => s + t.feeUsd, 0);

  return (
    <div className="panel-body">
      <section className="group">
        <h3>Cont pe hârtie</h3>
        <dl className="kv">
          <div><dt>Capital de pornire</dt><dd>
            <form onSubmit={(e) => { e.preventDefault(); const v = parseFloat(edit); if (v > 0) onBankroll(v); }}>
              <input className="num-in num wide" value={edit} inputMode="decimal" onChange={(e) => setEdit(e.target.value)} aria-label="Capital de pornire" onBlur={() => { const v = parseFloat(edit); if (v > 0) onBankroll(v); }} /> $
            </form>
          </dd></div>
          <div><dt>Valoare acum</dt><dd className="num">{fmtUsd(bankrollUsd + realized + unrealized)}</dd></div>
          <div><dt>În poziții</dt><dd className="num">{fmtUsd(inPositions)}</dd></div>
          <div><dt>Realizat</dt><dd><Signed v={realized} /></dd></div>
          <div><dt>Nerealizat</dt><dd><Signed v={unrealized} /></dd></div>
          <div><dt>Taxe și prioritate plătite</dt><dd className="num">{fmtUsd(fees)}</dd></div>
        </dl>
      </section>

      <section className="group">
        <h3>Ce funcționează</h3>
        {closed.length < 3 ? (
          <p className="empty left">Statisticile apar după 3 trade-uri închise. Ai {closed.length}.</p>
        ) : (
          <>
            <dl className="kv">
              <div><dt>Trade-uri închise</dt><dd className="num">{closed.length}</dd></div>
              <div><dt>Câștigate</dt><dd className="num">{Math.round((wins.length / closed.length) * 100)}%</dd></div>
              <div><dt>Câștig mediu / pierdere medie</dt><dd className="num"><span className="pos">{fmtUsd(avgWin)}</span> / <span className="neg">{fmtUsd(Math.abs(avgLoss))}</span></dd></div>
              <div><dt>Profit factor</dt><dd className="num">{pf === null ? "—" : pf.toFixed(2)}</dd></div>
            </dl>
            <GroupTable title="După tipul tezei" rows={groupBy(closed, (t) => t.thesis.tag)} />
            <GroupTable title="Ai respectat regulile?" rows={groupBy(closed, (t) => (t.acceptedWarnings ? "intrat peste atenționări" : "fără atenționări"))} />
            <GroupTable title="Cum ai ieșit" rows={groupBy(closed, (t) => REASON[t.exitReason!])} />
            {closed.length < 50 && <p className="dim small">Sub 50 de cazuri, diferențele pot fi întâmplătoare.</p>}
          </>
        )}
      </section>

      <section className="group">
        <button className="btn-ghost" onClick={() => exportCsv(trades)} disabled={!trades.length}><Download size={14} strokeWidth={1.75} aria-hidden /> Exportă jurnalul (CSV)</button>
      </section>
    </div>
  );
}
