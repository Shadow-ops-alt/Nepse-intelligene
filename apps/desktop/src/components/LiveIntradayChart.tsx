import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { IntradayBar } from "@stock/analytics";
import { formatCompact, formatNumber } from "../api";
import { Delta } from "./ui";
import { useTheme, type ResolvedTheme } from "../theme";
import type { ChartTimeframe } from "../live/types";
import { useLiveIntraday } from "../live/useLiveIntraday";

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
  const dataRef = useRef<{ key: string; lastTime: number; length: number } | null>(
    null,
  );
  const [ready, setReady] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const { resolved } = useTheme();
  const palette = PALETTES[resolved];

  const state = useLiveIntraday(symbol, timeframe, source);
  const bars = state.bars;
  const dataKey = `${source}:${timeframe}:${showVolume ? "volume" : "price"}`;

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
    dataRef.current = null;
    setReady((value) => value + 1);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      dataRef.current = null;
      setHover(null);
    };
  }, [palette, showVolume]);

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
        chart.timeScale().fitContent();
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

  const lastBar = bars.at(-1) ?? null;
  const shown: Hover | null =
    hover ??
    (lastBar
      ? {
          time: clock(lastBar.timestamp),
          open: lastBar.open,
          high: lastBar.high,
          low: lastBar.low,
          close: lastBar.close,
          volume: lastBar.volume,
        }
      : null);

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
          {state.marketOpen === true ? "LIVE · unofficial" : "idle · unofficial"}
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
