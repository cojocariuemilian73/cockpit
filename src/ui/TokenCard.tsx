import { useState } from "react";
import { Copy, Check as CheckIcon } from "lucide-react";
import type { Check, Metric, Token } from "../domain/types";
import { METRICS, fmtMetric } from "../domain/rules";

const SHOWN: Metric[] = ["liquidityUsd", "mcapUsd", "ageMin", "holders", "top10Pct", "buyRatioPct"];

function fmtPrice(p: number) {
  if (p >= 1) return `$${p.toFixed(3)}`;
  const zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  return `$${p.toFixed(Math.min(10, zeros + 4))}`;
}

function fmtAge(min: number) {
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 48) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} zile`;
}

export function TokenHeader({ token }: { token: Token }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(token.ca);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard indisponibil */ }
  }
  return (
    <div className="tok-head">
      <div className="tok-id">
        {token.imageUrl && <img className="tok-img" src={token.imageUrl} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" />}
        <h1 className="tok-sym">{token.symbol}</h1>
        <span className="tok-name">{token.name}</span>
        <button className="ca-chip" onClick={copy} title="Copiază adresa">
          <span className="num">{token.ca.slice(0, 4)}…{token.ca.slice(-4)}</span>
          {copied ? <CheckIcon size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
        </button>
      </div>
      <div className="tok-price">
        <span className="num price">{fmtPrice(token.priceUsd)}</span>
        <span className="tok-src">
          {token.source === "mock" ? "date simulate" : <>{token.dex ?? "live"}{token.volume1hUsd !== undefined && <> · vol 1h <span className="num">{fmtMetric("liquidityUsd", token.volume1hUsd)}</span></>}</>}
        </span>
      </div>
    </div>
  );
}

export function TokenMetrics({ token }: { token: Token }) {
  return (
    <dl className="metrics">
      {SHOWN.map((m) => {
        const v = token.metrics[m];
        return (
          <div key={m}>
            <dt>{METRICS[m].label}</dt>
            <dd className={`num ${v === undefined ? "dim" : ""}`}>
              {v === undefined ? "—" : m === "ageMin" ? fmtAge(v) : fmtMetric(m, v)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const STATUS_TEXT = { pass: "respectă", warn: "atenție", fail: "încalcă", unknown: "necunoscut" } as const;

export function RuleChecks({ checks, onEdit }: { checks: Check[]; onEdit: () => void }) {
  const counts = { fail: 0, warn: 0, unknown: 0, pass: 0 };
  checks.forEach((c) => counts[c.status]++);
  if (!checks.length) {
    return (
      <section className="checks">
        <p className="empty">Nicio regulă de token activă. <button className="link" onClick={onEdit}>Adaugă filtre</button></p>
      </section>
    );
  }
  return (
    <section className="checks" aria-label="Verificare față de regulile tale">
      <div className="checks-sum">
        <h2>Regulile tale</h2>
        <span className="num">
          {counts.fail > 0 && <b className="t-fail">{counts.fail} încalcă</b>}
          {counts.warn + counts.unknown > 0 && <b className="t-warn">{counts.warn + counts.unknown} atenție</b>}
          <b className="t-pass">{counts.pass} respectă</b>
        </span>
      </div>
      <ul className="check-list">
        {checks.map((c) => (
          <li key={c.ruleId} className={`check check-${c.status}`}>
            <span className={`dot dot-${c.status}`} aria-hidden />
            <span className="check-label">{c.label}</span>
            <span className="check-actual num">{c.actual}</span>
            <span className="sr-only">{STATUS_TEXT[c.status]}{c.severity === "block" ? ", regulă critică" : ""}</span>
            {c.severity === "block" && c.status !== "pass" && <span className="tag-critical">critică</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
