import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { LimitOrder, Token, Trade } from "../domain/types";
import { market, type Timeframe } from "../data/market";
import { stopPrice, tpPrice } from "../execution/executor";

const TFS: Timeframe[] = ["1m", "5m", "15m", "1h"];
const TF_SEC: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function precision(p: number) {
  if (p >= 1) return 4;
  return Math.min(12, Math.max(4, -Math.floor(Math.log10(p)) + 3));
}

/** Grafic cu lumânări. Liniile pentru intrare, TP, stop și ordine vin din pozițiile tale. */
export function Chart({ token, trades, orders }: { token: Token; trades: Trade[]; orders: LimitOrder[] }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>();
  const lines = useRef<IPriceLine[]>([]);
  const last = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const [tf, setTf] = useState<Timeframe>("5m");
  const [state, setState] = useState<"loading" | "ok" | "error" | "empty">("loading");

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: css("--text-3"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") }, horzLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") } },
      localization: { locale: "ro-RO" },
    });
    series.current = c.addCandlestickSeries({
      upColor: css("--pass"), downColor: css("--fail"), borderVisible: false,
      wickUpColor: css("--pass"), wickDownColor: css("--fail"),
    });
    chart.current = c;
    return () => { c.remove(); chart.current = undefined; series.current = undefined; lines.current = []; };
  }, []);

  // istoric: la schimbarea tokenului sau a intervalului, apoi la 60 s
  useEffect(() => {
    let stop = false;
    setState("loading");
    const load = async () => {
      try {
        const data = await market.candles(token, tf);
        if (stop || !series.current) return;
        if (!data.length) { setState("empty"); return; }
        const p = precision(data[data.length - 1].close);
        series.current.applyOptions({ priceFormat: { type: "price", precision: p, minMove: 10 ** -p } });
        series.current.setData(data.map((d) => ({ ...d, time: d.time as UTCTimestamp })));
        last.current = { ...data[data.length - 1] };
        setState("ok");
      } catch {
        if (!stop) setState((s) => (s === "ok" ? s : "error"));
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => { stop = true; window.clearInterval(id); };
  }, [token.id, tf]);

  // ultima lumânare urmărește prețul curent
  useEffect(() => {
    const s = series.current;
    const l = last.current;
    if (!s || !l || state !== "ok") return;
    const bucket = Math.floor(Date.now() / 1000 / TF_SEC[tf]) * TF_SEC[tf];
    const p = token.priceUsd;
    const next = bucket > l.time
      ? { time: bucket, open: l.close, high: Math.max(l.close, p), low: Math.min(l.close, p), close: p }
      : { ...l, high: Math.max(l.high, p), low: Math.min(l.low, p), close: p };
    last.current = next;
    s.update({ ...next, time: next.time as UTCTimestamp });
  }, [token.priceUsd, state, tf]);

  // linii: intrare, TP, stop, ordine limită
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    lines.current.forEach((l) => s.removePriceLine(l));
    lines.current = [];
    const add = (price: number, title: string, color: string, style = LineStyle.Dashed) =>
      lines.current.push(s.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
    for (const t of trades) {
      if (t.tokenId !== token.id || t.closedAt !== undefined) continue;
      add(t.entryPrice, "intrare", css("--text-2"), LineStyle.Solid);
      if (!t.tpHit) add(tpPrice(t), "TP", css("--pass"));
      add(stopPrice(t), t.tpHit ? "stop" : "SL", css("--fail"));
    }
    for (const o of orders) if (o.tokenId === token.id && o.status === "open") add(o.triggerPrice, "limită", css("--focus"), LineStyle.Dotted);
  }, [trades, orders, token.id, state]);

  return (
    <section className="chart" aria-label={`Grafic ${token.symbol}`}>
      <div className="chart-bar">
        <div className="seg" role="radiogroup" aria-label="Interval">
          {TFS.map((t) => <button key={t} role="radio" aria-checked={tf === t} onClick={() => setTf(t)}>{t}</button>)}
        </div>
        <span className="chart-src">{token.source === "live" ? "GeckoTerminal" : "istoric simulat"}</span>
      </div>
      <div className="chart-box" ref={box}>
        {state === "loading" && <p className="chart-msg">Se încarcă lumânările…</p>}
        {state === "error" && <p className="chart-msg">Graficul nu se încarcă acum (limită de cereri). Reîncerc într-un minut.</p>}
        {state === "empty" && <p className="chart-msg">Pool prea nou: încă nu există lumânări.</p>}
      </div>
    </section>
  );
}
