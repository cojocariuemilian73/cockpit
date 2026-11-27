import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Status, Token } from "../domain/types";
import { fmtMetric } from "../domain/rules";
import { looksLikeCa, market } from "../data/market";

interface Props {
  tokens: Token[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (t: Token) => void;
  onRemove: (id: string) => void;
  statusOf: (t: Token) => Status;
  inputRef: React.RefObject<HTMLInputElement>;
}

function age(min?: number) {
  if (min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 2880) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} zile`;
}

export function TokenPicker({ tokens, selectedId, onSelect, onAdd, onRemove, statusOf, inputRef }: Props) {
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Token[] | null>(null);
  const seq = useRef(0);

  // căutare după nume: cu întârziere scurtă, ultimul răspuns câștigă
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 || looksLikeCa(text)) { setResults(null); return; }
    const id = ++seq.current;
    const h = window.setTimeout(async () => {
      try {
        const r = await market.search(text);
        if (id === seq.current) setResults(r);
      } catch {
        if (id === seq.current) setError("Căutarea nu răspunde acum. Lipește adresa contractului.");
      }
    }, 350);
    return () => window.clearTimeout(h);
  }, [q]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    if (!looksLikeCa(text)) {
      if (results?.[0]) pick(results[0]);
      return;
    }
    setBusy(true);
    const { token, offline } = await market.lookup(text);
    setBusy(false);
    if (!token) return setError("N-am găsit niciun pool pe Solana pentru adresa asta.");
    if (offline) setError("Fără conexiune la date reale: am încărcat un token simulat.");
    else setError(null);
    pick(token);
  }

  function pick(t: Token) {
    setQ("");
    setResults(null);
    onAdd(t);
  }

  return (
    <div className="picker">
      <form className="ca-form" onSubmit={submit} role="search">
        <Search size={16} strokeWidth={1.75} aria-hidden className="ca-icon" />
        <input
          ref={inputRef}
          className="ca-input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setResults(null); (e.target as HTMLInputElement).blur(); } }}
          placeholder="Adresă (CA) sau nume de token"
          aria-label="Caută token după adresă sau nume"
          aria-invalid={!!error}
          aria-describedby={error ? "ca-err" : undefined}
          aria-expanded={!!results}
          aria-controls="search-results"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="kbd" aria-hidden>/</kbd>
        <button className="btn-ghost" type="submit" disabled={busy || !q.trim()}>{busy ? "Caut…" : "Verifică"}</button>
      </form>
      {error && <p id="ca-err" className="field-error">{error}</p>}

      {results && (
        <ul id="search-results" className="results" aria-label="Rezultate">
          {results.length === 0 && <li className="empty">Nimic pe Solana cu numele ăsta.</li>}
          {results.map((t) => (
            <li key={t.id}>
              <button className="result" onClick={() => pick(t)}>
                <b>{t.symbol}</b>
                <span className="dim result-name">{t.name}</span>
                <span className="num">{t.metrics.liquidityUsd !== undefined ? fmtMetric("liquidityUsd", t.metrics.liquidityUsd) : "—"}</span>
                <span className="num dim">{age(t.metrics.ageMin)}</span>
                <span className="num dim">{t.ca.slice(0, 4)}…{t.ca.slice(-4)}</span>
              </button>
            </li>
          ))}
          {results.length > 1 && <li className="results-note">Același nume poate fi o copie. Verifică lichiditatea, vârsta și adresa.</li>}
        </ul>
      )}

      <div className="watch" role="tablist" aria-label="Lista de urmărit">
        {tokens.map((t) => (
          <div key={t.id} className={`watch-chip ${t.id === selectedId ? "sel" : ""}`}>
            <button role="tab" aria-selected={t.id === selectedId} className="watch-main" onClick={() => onSelect(t.id)}>
              <span className={`dot dot-${statusOf(t)}`} aria-hidden />
              <span>{t.symbol}</span>
              {t.source === "mock" && <span className="demo-tag">demo</span>}
            </button>
            <button className="watch-x" onClick={() => onRemove(t.id)} aria-label={`Scoate ${t.symbol} din listă`}><X size={12} strokeWidth={2} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
