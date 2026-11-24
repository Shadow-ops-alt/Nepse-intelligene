import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  bollingerValues,
  emaValues,
  macdValues,
  rsiValues,
  smaValues,
  vwap,
  type IntradayBar,
} from "@stock/analytics";
import { formatCompact, formatNumber } from "../api";
import { Delta } from "./ui";
import { useTheme, type ResolvedTheme } from "../theme";
import type { ChartTimeframe } from "../live/types";
import { useLiveIntraday } from "../live/useLiveIntraday";
import "./LiveIntradayChart.css";

const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;

interface Palette {
  text: string;
  grid: string;
  border: string;
  crosshair: string;
  label: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  sma9: string;
  sma21: string;
  ema9: string;
  ema21: string;
  vwap: string;
  boll: string;
  rsi: string;
  macd: string;
  macdSignal: string;
}

const PALETTES: Record<ResolvedTheme, Palette> = {
  light: {
    text: "#566070",
    grid: "rgba(15, 20, 25, 0.05)",
    border: "rgba(15, 20, 25, 0.12)",
    crosshair: "rgba(51, 85, 224, 0.45)",
    label: "#3355e0",
    up: "#0a8a57",
    down: "#d23347",
    volumeUp: "rgba(10, 138, 87, 0.25)",
    volumeDown: "rgba(210, 51, 71, 0.25)",
    sma9: "#b26a00",
    sma21: "#7a5af8",
    ema9: "#0f766e",
    ema21: "#be185d",
    vwap: "#2563eb",
    boll: "#8b98a8",
    rsi: "#7c3aed",
    macd: "#0ea5e9",
    macdSignal: "#d97706",
  },
  dark: {
    text: "#9ba6b6",
    grid: "rgba(255, 255, 255, 0.04)",
    border: "rgba(255, 255, 255, 0.1)",
    crosshair: "rgba(112, 145, 255, 0.5)",
    label: "#2a3a6a",
    up: "#2bc98f",
    down: "#ff6676",
    volumeUp: "rgba(43, 201, 143, 0.25)",
    volumeDown: "rgba(255, 102, 118, 0.25)",
    sma9: "#f0b44c",
    sma21: "#b39bff",
    ema9: "#3ddbb1",
    ema21: "#ff8fbf",
    vwap: "#7aa2ff",
    boll: "#6b7a8f",
    rsi: "#b39bff",
    macd: "#59c8ff",
    macdSignal: "#f0b44c",
  },
};

function clock(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms + NPT_OFFSET_MS).toISOString().slice(11, 16);
}

function clockFromSeconds(seconds: number): string {
  return new Date(seconds * 1000 + NPT_OFFSET_MS).toISOString().slice(11, 16);
}

function chartTime(iso: string): UTCTimestamp {
  return Math.floor(Date.parse(iso) / 1000) as UTCTimestamp;
}

function labelForTime(time: Time): string {
  if (typeof time === "number") return clockFromSeconds(time);
  if (typeof time === "string") return time;
  return `${String(time.day).padStart(2, "0")} ${time.month}/${time.year}`;
}

function tickLabel(time: Time): string {
  if (typeof time === "number") return clockFromSeconds(time);
  if (typeof time === "string") return time.slice(5);
  return `${String(time.day).padStart(2, "0")}/${time.month}`;
}

interface Hover {
  time: string;
  /** Chart time of the hovered bar, used to align indicator values. */
  seconds: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function barVolume(bar: IntradayBar): number {
  // Volume is null until the recorder has two samples to difference.
  return bar.volume ?? 0;
}

type LineKey =
  | "sma9"
  | "sma21"
  | "ema9"
  | "ema21"
  | "vwap"
  | "bollUpper"
  | "bollMiddle"
  | "bollLower"
  | "rsi"
  | "macd"
  | "macdSignal";

interface IndicatorToggles {
  sma9: boolean;
  sma21: boolean;
  ema9: boolean;
  ema21: boolean;
  vwap: boolean;
  bollinger: boolean;
  rsi: boolean;
  macd: boolean;
}

const DEFAULT_TOGGLES: IndicatorToggles = {
  sma9: true,
  sma21: false,
  ema9: false,
  ema21: true,
  vwap: true,
  bollinger: false,
  rsi: false,
  macd: false,
};

const TOGGLE_ITEMS: Array<{ key: keyof IndicatorToggles; label: string }> = [
  { key: "sma9", label: "SMA 9" },
  { key: "sma21", label: "SMA 21" },
  { key: "ema9", label: "EMA 9" },
  { key: "ema21", label: "EMA 21" },
  { key: "vwap", label: "VWAP" },
  { key: "bollinger", label: "BB 20/2" },
  { key: "rsi", label: "RSI 14" },
  { key: "macd", label: "MACD 12/26/9" },
];

function lineData(
  times: readonly UTCTimestamp[],
  values: ReadonlyArray<number | null>,
): Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }> {
  return times.map((time, index) => {
    const value = values[index];
    return value === null || value === undefined
      ? { time }
      : { time, value };
  });
}

export function LiveIntradayChart({
  symbol,
  timeframe,
  source = "market",
  showVolume = true,
  height = "normal",
}: {
  symbol: string;
  timeframe: ChartTimeframe;
  source?: "market" | "index";
  showVolume?: boolean;
  height?: "compact" | "normal" | "tall";
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lineRef = useRef<Partial<Record<LineKey, ISeriesApi<"Line">>>>({});
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const dataRef = useRef<{ key: string; lastTime: number; length: number } | null>(
    null,
  );
  const [ready, setReady] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);
  const { resolved } = useTheme();
  const palette = PALETTES[resolved];

  const state = useLiveIntraday(symbol, timeframe, source);
  const bars = state.bars;
  const dataKey = `${source}:${timeframe}:${showVolume ? "volume" : "price"}`;
  const dataKeyRef = useRef(dataKey);
  dataKeyRef.current = dataKey;
  // Indicator toggles rebuild the chart; keep the visible range so a toggle
  // does not throw the user back to fit-content.
  const savedRange = useRef<{
    key: string;
    range: { from: number; to: number };
  } | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const chart = createChart(element, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: palette.text,
        fontSize: 11,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: {
        borderColor: palette.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        minBarSpacing: 0.5,
        tickMarkFormatter: (time: Time) => tickLabel(time),
      },
      localization: {
        timeFormatter: (time: Time) => labelForTime(time),
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: { mouse: false, touch: true },
      crosshair: {
        vertLine: {
          color: palette.crosshair,
          labelBackgroundColor: palette.label,
        },
        horzLine: {
          color: palette.crosshair,
          labelBackgroundColor: palette.label,
        },
      },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      borderVisible: false,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceLineVisible: false,
    });

    let volume: ISeriesApi<"Histogram"> | null = null;
    if (showVolume) {
      volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      chart.priceScale("").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    const lines: Partial<Record<LineKey, ISeriesApi<"Line">>> = {};
    const addOverlay = (key: LineKey, color: string, lineWidth: 1 | 2 = 1) => {
      lines[key] = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    };

    if (toggles.sma9) addOverlay("sma9", palette.sma9);
    if (toggles.sma21) addOverlay("sma21", palette.sma21);
    if (toggles.ema9) addOverlay("ema9", palette.ema9);
    if (toggles.ema21) addOverlay("ema21", palette.ema21);
    if (toggles.vwap) addOverlay("vwap", palette.vwap, 2);
    if (toggles.bollinger) {
      addOverlay("bollUpper", palette.boll);
      lines.bollUpper?.applyOptions({ lineStyle: LineStyle.Dashed });
      addOverlay("bollMiddle", palette.boll);
      addOverlay("bollLower", palette.boll);
      lines.bollLower?.applyOptions({ lineStyle: LineStyle.Dashed });
    }

    if (toggles.rsi) {
      const pane = chart.addPane();
      const rsiSeries = pane.addSeries(LineSeries, {
        color: palette.rsi,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
        }),
      });
      rsiSeries.createPriceLine({
        price: 70,
        color: palette.border,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: "",
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: palette.border,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: "",
      });
      lines.rsi = rsiSeries;
    }

    if (toggles.macd) {
      const pane = chart.addPane();
      macdHistRef.current = pane.addSeries(HistogramSeries, {
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      lines.macd = pane.addSeries(LineSeries, {
        color: palette.macd,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lines.macdSignal = pane.addSeries(LineSeries, {
        color: palette.macdSignal,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    } else {
      macdHistRef.current = null;
    }

    const panes = chart.panes();
    if (panes.length > 1) {
      const oscillators = panes.length - 1;
      panes[0]?.setStretchFactor(oscillators === 1 ? 0.72 : 0.6);
      for (const pane of panes.slice(1)) {
        pane.setStretchFactor(oscillators === 1 ? 0.28 : 0.2);
      }
    }

    const onMove = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const point = param.seriesData.get(candle) as
        | { open?: number; high?: number; low?: number; close?: number }
        | undefined;
      if (
        !point ||
        typeof point.open !== "number" ||
        typeof point.high !== "number" ||
        typeof point.low !== "number" ||
        typeof point.close !== "number"
      ) {
        setHover(null);
        return;
      }
      const volumePoint = volume
        ? (param.seriesData.get(volume) as { value?: number } | undefined)
        : undefined;
      setHover({
        time: labelForTime(param.time),
        seconds: typeof param.time === "number" ? param.time : null,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: volumePoint?.value ?? null,
      });
    };
    chart.subscribeCrosshairMove(onMove);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    lineRef.current = lines;
    dataRef.current = null;
    setReady((value) => value + 1);

    return () => {
      const visible = chart.timeScale().getVisibleLogicalRange();
      if (visible) {
        savedRange.current = {
          key: dataKeyRef.current,
          range: { from: visible.from, to: visible.to },
        };
      }
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      lineRef.current = {};
      macdHistRef.current = null;
      dataRef.current = null;
      setHover(null);
    };
  }, [palette, showVolume, toggles]);

  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;

    if (bars.length === 0) {
      candle.setData([]);
      volumeRef.current?.setData([]);
      dataRef.current = null;
      return;
    }

    const candleData = bars.map((bar) => ({
      time: chartTime(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumeData = bars.map((bar) => ({
      time: chartTime(bar.timestamp),
      value: barVolume(bar),
      color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
    }));
    const last = candleData.at(-1)!;
    const previous = dataRef.current;
    const lastSeconds = last.time as number;
    const grew = previous ? candleData.length - previous.length : 0;
    const needsReset =
      previous === null ||
      previous.key !== dataKey ||
      grew < 0 ||
      grew > 2 ||
      lastSeconds < previous.lastTime;

    if (needsReset) {
      candle.setData(candleData);
      volumeRef.current?.setData(volumeData);
      if (previous === null || previous.key !== dataKey) {
        const saved = savedRange.current;
        if (previous === null && saved && saved.key === dataKey) {
          chart.timeScale().setVisibleLogicalRange(saved.range);
          savedRange.current = null;
        } else {
          chart.timeScale().fitContent();
        }
      }
    } else if (grew === 1) {
      candle.update(last);
      const volume = volumeData.at(-1);
      if (volume) volumeRef.current?.update(volume);
    } else {
      candle.update(last);
      const volume = volumeData.at(-1);
      if (volume) volumeRef.current?.update(volume);
    }

    dataRef.current = {
      key: dataKey,
      lastTime: lastSeconds,
      length: candleData.length,
    };
  }, [bars, dataKey, palette, ready]);

  const indicators = useMemo(() => {
    const closes = bars.map((bar) => bar.close);
    return {
      sma9: smaValues(closes, 9),
      sma21: smaValues(closes, 21),
      ema9: emaValues(closes, 9),
      ema21: emaValues(closes, 21),
      vwap: vwap(bars),
      boll: bollingerValues(closes, 20, 2),
      rsi: rsiValues(closes, 14),
      macd: macdValues(closes),
    };
  }, [bars]);

  useEffect(() => {
    const lines = lineRef.current;
    if (!ready || bars.length === 0) {
      for (const series of Object.values(lines)) series?.setData([]);
      macdHistRef.current?.setData([]);
      return;
    }
    const times = bars.map((bar) => chartTime(bar.timestamp));
    const setLine = (key: LineKey, values: ReadonlyArray<number | null>) => {
      lines[key]?.setData(lineData(times, values));
    };

    if (toggles.sma9) setLine("sma9", indicators.sma9);
    if (toggles.sma21) setLine("sma21", indicators.sma21);
    if (toggles.ema9) setLine("ema9", indicators.ema9);
    if (toggles.ema21) setLine("ema21", indicators.ema21);
    if (toggles.vwap) setLine("vwap", indicators.vwap);
    if (toggles.bollinger) {
      setLine(
        "bollUpper",
        indicators.boll.map((point) => point?.upper ?? null),
      );
      setLine(
        "bollMiddle",
        indicators.boll.map((point) => point?.middle ?? null),
      );
      setLine(
        "bollLower",
        indicators.boll.map((point) => point?.lower ?? null),
      );
    }
    if (toggles.rsi) setLine("rsi", indicators.rsi);
    if (toggles.macd) {
      setLine("macd", indicators.macd.macd);
      setLine("macdSignal", indicators.macd.signal);
      macdHistRef.current?.setData(
        times.map((time, index) => {
          const value = indicators.macd.histogram[index];
          return value === null || value === undefined
            ? { time }
            : {
                time,
                value,
                color: value >= 0 ? palette.volumeUp : palette.volumeDown,
              };
        }),
      );
    }
  }, [bars, indicators, ready, toggles, palette]);

  const lastBar = bars.at(-1) ?? null;
  const shown: Hover | null =
    hover ??
    (lastBar
      ? {
          time: clock(lastBar.timestamp),
          seconds: chartTime(lastBar.timestamp),
          open: lastBar.open,
          high: lastBar.high,
          low: lastBar.low,
          close: lastBar.close,
          volume: lastBar.volume,
        }
      : null);

  const pointerIndex = useMemo(() => {
    if (bars.length === 0) return -1;
    if (hover?.seconds === null || hover?.seconds === undefined) {
      return bars.length - 1;
    }
    const found = bars.findIndex((bar) => chartTime(bar.timestamp) === hover.seconds);
    return found >= 0 ? found : bars.length - 1;
  }, [bars, hover]);

  const valueAt = (values: ReadonlyArray<number | null>): number | null =>
    pointerIndex >= 0 ? (values[pointerIndex] ?? null) : null;
  const valueText = (value: number | null): string =>
    value === null ? "—" : formatNumber(value);

  const bollPoint = pointerIndex >= 0 ? (indicators.boll[pointerIndex] ?? null) : null;
  const macdLine = valueAt(indicators.macd.macd);
  const macdSignal = valueAt(indicators.macd.signal);
  const macdHistogram = valueAt(indicators.macd.histogram);

  const insufficient: string[] = [];
  if (toggles.sma9 && valueAt(indicators.sma9) === null) insufficient.push("SMA 9");
  if (toggles.sma21 && valueAt(indicators.sma21) === null) insufficient.push("SMA 21");
  if (toggles.ema9 && valueAt(indicators.ema9) === null) insufficient.push("EMA 9");
  if (toggles.ema21 && valueAt(indicators.ema21) === null) insufficient.push("EMA 21");
  if (toggles.bollinger && bollPoint === null) insufficient.push("Bollinger 20/2");
  if (toggles.rsi && valueAt(indicators.rsi) === null) insufficient.push("RSI 14");
  if (toggles.macd) {
    if (macdLine === null) insufficient.push("MACD 12/26/9");
    else if (macdSignal === null) insufficient.push("MACD signal");
  }
  const vwapNeedsVolume = toggles.vwap && valueAt(indicators.vwap) === null;

  const emptyTitle =
    state.loading
      ? "Waiting for the live feed"
      : state.error
        ? "Live feed unavailable"
        : state.marketOpen === false
          ? "Market closed"
          : "No intraday bars yet";
  const emptyBody =
    state.error ??
    (state.marketOpen === false
      ? "NEPSE trades Sunday–Thursday, 11:00–15:00 NPT. This chart records bars only while the app is open."
      : "Bars start when this chart opens. Intraday history before that is not available.");

  const liveTone =
    state.marketOpen === true ? "good" : state.marketOpen === false ? "neutral" : "warn";

  return (
    <div className="chart-shell">
      <div className="chart-legend">
        <span className={`badge badge-${liveTone}`}>
          {state.marketOpen === true ? "LIVE" : "idle"}
        </span>
        <span className="legend-item">
          {source === "index" ? "NEPSE index" : symbol}
        </span>
        {state.quote && (
          <span className="legend-item">
            LTP <strong>{formatNumber(state.quote.ltp)}</strong>
            <Delta value={state.quote.changePercent} pill />
          </span>
        )}
        <span className="legend-item">
          {state.marketOpen === true
            ? "market open"
            : state.marketOpen === false
              ? "market closed"
              : "market state unknown"}
        </span>
        {state.asOf && <span className="legend-item">as of {clock(state.asOf)} NPT</span>}
        {state.sessionStart && (
          <span className="legend-item">session from {clock(state.sessionStart)}</span>
        )}
        <span className="muted tiny">sampled {timeframe} bars</span>
      </div>

      {state.error && (
        <div className="muted small tone-down">
          {state.error} End-of-day data is still available under 1D.
        </div>
      )}

      <div className="intraday-toolbar" role="group" aria-label="Intraday indicators">
        <span className="intraday-toolbar-label">Indicators</span>
        <div className="intraday-toggles">
          {TOGGLE_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="toggle-chip"
              aria-pressed={toggles[item.key]}
              title={`Toggle ${item.label}`}
              onClick={() =>
                setToggles((current) => ({
                  ...current,
                  [item.key]: !current[item.key],
                }))
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {shown && (
        <div className="chart-legend">
          <span className="legend-item">
            <strong>{shown.time}</strong>
          </span>
          <span className="legend-item">
            O <strong>{formatNumber(shown.open)}</strong>
          </span>
          <span className="legend-item">
            H <strong>{formatNumber(shown.high)}</strong>
          </span>
          <span className="legend-item">
            L <strong>{formatNumber(shown.low)}</strong>
          </span>
          <span className="legend-item">
            C <strong>{formatNumber(shown.close)}</strong>
          </span>
          {showVolume && shown.volume !== null && (
            <span className="legend-item">
              Vol <strong>{formatCompact(shown.volume)}</strong>
            </span>
          )}
        </div>
      )}

      {bars.length > 0 && (
        <div className="chart-legend intraday-indicator-legend">
          {toggles.sma9 && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.sma9 }} />
              SMA 9 <strong>{valueText(valueAt(indicators.sma9))}</strong>
            </span>
          )}
          {toggles.sma21 && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.sma21 }} />
              SMA 21 <strong>{valueText(valueAt(indicators.sma21))}</strong>
            </span>
          )}
          {toggles.ema9 && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.ema9 }} />
              EMA 9 <strong>{valueText(valueAt(indicators.ema9))}</strong>
            </span>
          )}
          {toggles.ema21 && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.ema21 }} />
              EMA 21 <strong>{valueText(valueAt(indicators.ema21))}</strong>
            </span>
          )}
          {toggles.vwap && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.vwap }} />
              VWAP <strong>{valueText(valueAt(indicators.vwap))}</strong>
            </span>
          )}
          {toggles.bollinger && (
            <span className="legend-item" title="Bollinger upper / middle / lower">
              <span className="swatch" style={{ background: palette.boll }} />
              BB 20/2{" "}
              <strong>
                {bollPoint
                  ? `${formatNumber(bollPoint.upper)} / ${formatNumber(bollPoint.middle)} / ${formatNumber(bollPoint.lower)}`
                  : "—"}
              </strong>
            </span>
          )}
          {toggles.rsi && (
            <span className="legend-item">
              <span className="swatch" style={{ background: palette.rsi }} />
              RSI 14 <strong>{valueText(valueAt(indicators.rsi))}</strong>
            </span>
          )}
          {toggles.macd && (
            <span className="legend-item" title="MACD line / signal / histogram">
              <span className="swatch" style={{ background: palette.macd }} />
              MACD{" "}
              <strong>
                {valueText(macdLine)} / {valueText(macdSignal)} / {valueText(macdHistogram)}
              </strong>
            </span>
          )}
          {insufficient.length > 0 && (
            <span className="legend-item muted tiny">
              not enough bars for {insufficient.join(", ")}
            </span>
          )}
          {vwapNeedsVolume && (
            <span className="legend-item muted tiny">
              VWAP needs traded volume
            </span>
          )}
        </div>
      )}

      <div
        className={`chart-stage ${
          height === "compact" ? "compact" : height === "tall" ? "tall" : ""
        }`}
      >
        <div className="price-chart" ref={container} />
        {bars.length === 0 && (
          <div className="chart-empty">
            <div>
              <strong>{emptyTitle}</strong>
              <p className="muted small">{emptyBody}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
