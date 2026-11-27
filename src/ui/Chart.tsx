import { useEffect, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, SeriesMarker, UTCTimestamp } from "lightweight-charts";
import type { Candle, LimitOrder, Token, Trade } from "../domain/types";
import { marketData, type Timeframe } from "../data/market";
import { avgEntry, stopPrice, tpPrice } from "../execution/executor";
import { fmtPrice } from "./TokenStrip";

const TFS: Timeframe[] = ["1m", "5m", "15m", "1h"];
const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
const MAX_CANDLES = 300;

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function precision(p: number) {
  if (!(p > 0) || p >= 1) return 4;
  return Math.min(12, Math.max(4, -Math.floor(Math.log10(p)) + 3));
}

type Lib = typeof import("lightweight-charts");
type State = "loading" | "ok" | "error" | "empty";

/** Fallback fără bibliotecă: o linie a închiderilor și reperul Avg Entry, în SVG simplu. */
function Fallback({ candles, avg }: { candles: Candle[]; avg: number | null }) {
  if (candles.length < 2) return <p className="chart-msg">Graficul nu s-a putut încărca. Prețul de sus rămâne corect.</p>;
  const xs = candles.slice(-120);
  const vals = xs.map((c) => c.close).concat(avg ? [avg] : []);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const y = (v: number) => (hi === lo ? 50 : 96 - ((v - lo) / (hi - lo)) * 92);
  const pts = xs.map((c, i) => `${(i / (xs.length - 1)) * 100},${y(c.close)}`).join(" ");
  return (
    <div className="chart-fallback">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Grafic simplificat al prețului">
        <polyline points={pts} fill="none" stroke="var(--text-2)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        {avg && <line x1="0" x2="100" y1={y(avg)} y2={y(avg)} stroke="var(--focus)" strokeDasharray="2 2" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="chart-msg corner">Grafic simplificat: biblioteca de lumânări nu s-a încărcat.</span>
    </div>
  );
}

/** Grafic cu lumânări. Reperul Avg Entry, TP, stopul și ordinele vin din pozițiile tale; markerele C / V / 2x din istoric. */
export function Chart({ token, trades, orders }: { token: Token; trades: Trade[]; orders: LimitOrder[] }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>();
  const lines = useRef<IPriceLine[]>([]);
  const last = useRef<Candle | null>(null);
  const [lib, setLib] = useState<Lib | null | "failed">(null);
  const [tf, setTf] = useState<Timeframe>("5m");
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<Candle[]>([]);
  const avg = avgEntry(trades, token.id);

  useEffect(() => {
    let stop = false;
    import("lightweight-charts").then((m) => !stop && setLib(m)).catch(() => !stop && setLib("failed"));
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    if (!lib || lib === "failed" || !box.current) return;
    const c = lib.createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--text-3"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: lib.CrosshairMode.Normal, vertLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") }, horzLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") } },
      localization: { locale: "ro-RO" },
    });
    series.current = c.addCandlestickSeries({
      upColor: css("--pass"), downColor: css("--fail"), borderVisible: false, wickUpColor: css("--pass"), wickDownColor: css("--fail"),
      // prețul nu coboară sub zero: axa nu arată valori negative
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = original();
        if (r?.priceRange) r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
        return r;
      },
    });
    chart.current = c;
    return () => { c.remove(); chart.current = undefined; series.current = undefined; lines.current = []; };
  }, [lib]);

  // istoric: la schimbarea tokenului sau a intervalului, apoi la 60 s
  useEffect(() => {
    let stop = false;
    setState("loading");
    const load = async () => {
      try {
        const d = (await marketData.candles(token, tf, Date.now())).filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)).slice(-MAX_CANDLES);
        if (stop) return;
        if (!d.length) { setState("empty"); return; }
        setData(d);
        last.current = { ...d[d.length - 1] };
        setState("ok");
      } catch {
        if (!stop) setState((s) => (s === "ok" ? s : "error"));
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [token.id, tf]);

  useEffect(() => {
    const s = series.current;
    if (!s || state !== "ok" || !data.length) return;
    const p = precision(data[data.length - 1].close);
    s.applyOptions({ priceFormat: { type: "price", precision: p, minMove: 10 ** -p } });
    s.setData(data.map((d) => ({ ...d, time: d.time as UTCTimestamp })));
  }, [data, state, lib]);

  // ultima lumânare urmărește prețul curent
  useEffect(() => {
    const s = series.current;
    const l = last.current;
    const p = token.priceUsd;
    if (!s || !l || state !== "ok" || !(p > 0)) return;
    const bucket = Math.floor(Date.now() / 1000 / TF_SEC[tf]) * TF_SEC[tf];
    const next = bucket > l.time
      ? { time: bucket, open: l.close, high: Math.max(l.close, p), low: Math.min(l.close, p), close: p, volume: 0 }
      : { ...l, high: Math.max(l.high, p), low: Math.min(l.low, p), close: p };
    last.current = next;
    s.update({ ...next, time: next.time as UTCTimestamp });
  }, [token.priceUsd, state, tf]);

  // linii: Avg Entry, TP, stop, ordine limită
  useEffect(() => {
    const s = series.current;
    if (!s || !lib || lib === "failed") return;
    lines.current.forEach((l) => s.removePriceLine(l));
    lines.current = [];
    const add = (price: number, title: string, color: string, style = lib.LineStyle.Dashed, width: 1 | 2 = 1) => {
      if (price > 0 && Number.isFinite(price)) lines.current.push(s.createPriceLine({ price, title, color, lineWidth: width, lineStyle: style, axisLabelVisible: true }));
    };
    if (avg !== null) add(avg, "Avg Entry", css("--focus"), lib.LineStyle.Solid, 2);
    for (const t of trades) {
      if (t.tokenId !== token.id || t.closedAt !== undefined) continue;
      if (!t.tpHit && t.tpPct < 1e6) add(tpPrice(t), "TP", css("--pass"));
      if (t.auto2x && !t.recovered) add(t.entryPrice * 2, "2x", css("--pass"), lib.LineStyle.Dotted);
      add(stopPrice(t), t.tpHit || t.recovered ? "stop" : "SL", css("--fail"));
    }
    for (const o of orders) if (o.tokenId === token.id && o.status === "open") add(o.triggerPrice, "limită", css("--warn"), lib.LineStyle.Dotted);
  }, [trades, orders, token.id, state, lib, avg]);

  // markere de cumpărare, vânzare și 2x pe lumânări
  useEffect(() => {
    const s = series.current;
    if (!s || state !== "ok") return;
    const step = TF_SEC[tf];
    const at = (ms: number) => (Math.floor(ms / 1000 / step) * step) as UTCTimestamp;
    const marks: SeriesMarker<UTCTimestamp>[] = [];
    for (const t of trades) {
      if (t.tokenId !== token.id) continue;
      marks.push({ time: at(t.openedAt), position: "belowBar", shape: "arrowUp", color: css("--pass"), text: "C" });
      if (t.recovered) marks.push({ time: at(t.recovered.at), position: "aboveBar", shape: "circle", color: css("--focus"), text: "2x · inițial recuperat" });
      if (t.closedAt !== undefined) marks.push({ time: at(t.closedAt), position: "aboveBar", shape: "arrowDown", color: css("--fail"), text: "V" });
    }
    s.setMarkers(marks.sort((a, b) => a.time - b.time));
  }, [trades, token.id, state, tf, lib]);

  return (
    <section className="chart" aria-label={`Grafic ${token.symbol}`}>
      <div className="chart-bar">
        <div className="seg" role="radiogroup" aria-label="Interval">
          {TFS.map((t) => <button key={t} role="radio" aria-checked={tf === t} onClick={() => setTf(t)}>{t}</button>)}
        </div>
        {avg !== null && <span className="avg-tag num" title="Prețul mediu de intrare pe ce ai deschis">Avg Entry {fmtPrice(avg)}</span>}
        <span className="chart-src">{token.source === "live" ? "GeckoTerminal" : "istoric simulat"}</span>
      </div>
      <div className="chart-box" ref={box}>
        {lib === "failed" && <Fallback candles={data} avg={avg} />}
        {lib !== "failed" && state === "loading" && <p className="chart-msg">Se încarcă lumânările…</p>}
        {state === "error" && <p className="chart-msg">Graficul nu se încarcă acum (limită de cereri). Reîncerc într-un minut.</p>}
        {state === "empty" && <p className="chart-msg">Pool prea nou: încă nu există lumânări.</p>}
      </div>
    </section>
  );
}
