import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { bollinger, ema, macd, rsi, sma } from "@stock/analytics";
import type { Candle } from "../types";
import { useTheme, type ResolvedTheme } from "../theme";
import { Segmented } from "./ui";

interface ChartPalette {
  text: string;
  grid: string;
  border: string;
  crosshair: string;
  crosshairLabel: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  area: string;
  areaTop: string;
  sma20: string;
  sma50: string;
  sma200: string;
  ema20: string;
  band: string;
  rsi: string;
  macd: string;
  signal: string;
  guide: string;
}

const PALETTES: Record<ResolvedTheme, ChartPalette> = {
  light: {
    text: "#566070",
    grid: "rgba(15, 20, 25, 0.05)",
    border: "rgba(15, 20, 25, 0.12)",
    crosshair: "rgba(51, 85, 224, 0.45)",
    crosshairLabel: "#3355e0",
    up: "#0a8a57",
    down: "#d23347",
    volumeUp: "rgba(10, 138, 87, 0.25)",
    volumeDown: "rgba(210, 51, 71, 0.25)",
    area: "#3355e0",
    areaTop: "rgba(51, 85, 224, 0.18)",
    sma20: "#e8890c",
    sma50: "#3355e0",
    sma200: "#8b3fd9",
    ema20: "#0b9bb5",
    band: "rgba(102, 112, 133, 0.55)",
    rsi: "#8b3fd9",
    macd: "#3355e0",
    signal: "#e8890c",
    guide: "rgba(102, 112, 133, 0.5)",
  },
  dark: {
    text: "#9ba6b6",
    grid: "rgba(255, 255, 255, 0.04)",
    border: "rgba(255, 255, 255, 0.1)",
    crosshair: "rgba(112, 145, 255, 0.5)",
    crosshairLabel: "#2a3a6a",
    up: "#2bc98f",
    down: "#ff6676",
    volumeUp: "rgba(43, 201, 143, 0.25)",
    volumeDown: "rgba(255, 102, 118, 0.25)",
    area: "#7091ff",
    areaTop: "rgba(112, 145, 255, 0.22)",
    sma20: "#f5a524",
    sma50: "#7091ff",
    sma200: "#b98cff",
    ema20: "#3fd0e6",
    band: "rgba(155, 166, 182, 0.5)",
    rsi: "#b98cff",
    macd: "#7091ff",
    signal: "#f5a524",
    guide: "rgba(155, 166, 182, 0.45)",
  },
};

export type Overlay = "sma20" | "sma50" | "sma200" | "ema20" | "bb";
export type Study = "volume" | "rsi" | "macd";
export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "ALL";

export interface ChartMarker {
  time: string;
  bias: "bullish" | "bearish" | "neutral";
  label: string;
}

/** Two/three-letter code drawn on the chart; the full name shows in the legend. */
function markerCode(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

const RANGE_DAYS: Record<Exclude<ChartRange, "ALL">, number> = {
  "1M": 31,
  "3M": 92,
  "6M": 183,
  "1Y": 366,
  "3Y": 366 * 3,
  "5Y": 366 * 5,
};

const OVERLAY_LABEL: Record<Overlay, string> = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
  ema20: "EMA 20",
  bb: "Bollinger 20,2",
};

const STUDY_LABEL: Record<Study, string> = {
  volume: "Volume",
  rsi: "RSI 14",
  macd: "MACD 12,26,9",
};

function day(candle: Candle): string {
  return candle.timestamp.slice(0, 10);
}

/** Sorted, one bar per calendar day (the chart rejects duplicate times). */
function normalise(candles: Candle[]): Candle[] {
  const byDay = new Map<string, Candle>();
  for (const candle of [...candles].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  )) {
    byDay.set(day(candle), candle);
  }
  return [...byDay.values()];
}

function lineData(
  candles: Candle[],
  values: Array<number | null>,
): Array<{ time: Time; value: number }> {
  const out: Array<{ time: Time; value: number }> = [];
  values.forEach((value, index) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      out.push({ time: day(candles[index]!) as Time, value });
    }
  });
  return out;
}

interface LegendState {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  change: number | null;
  values: Partial<Record<Overlay | "rsi" | "macd", number>>;
}

export function PriceChart({
  candles,
  variant = "candles",
  size = "normal",
  defaultRange = "1Y",
  defaultOverlays = ["sma50", "sma200"],
  defaultStudies = ["volume"],
  allowStudies = true,
  showVolume = true,
  markers = [],
}: {
  candles: Candle[];
  variant?: "candles" | "area";
  size?: "compact" | "normal" | "tall";
  defaultRange?: ChartRange;
  defaultOverlays?: Overlay[];
  defaultStudies?: Study[];
  allowStudies?: boolean;
  /** Index series publish no share volume; hide the toggle for them. */
  showVolume?: boolean;
  markers?: ChartMarker[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const { resolved } = useTheme();
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [overlays, setOverlays] = useState<Overlay[]>(defaultOverlays);
  const [studies, setStudies] = useState<Study[]>(
    showVolume ? defaultStudies : defaultStudies.filter((s) => s !== "volume"),
  );
  const [showMarkers, setShowMarkers] = useState(markers.length > 0);
  const [legend, setLegend] = useState<LegendState | null>(null);

  const series = useMemo(() => normalise(candles), [candles]);
  const markersByDay = useMemo(() => {
    const map = new Map<string, ChartMarker[]>();
    for (const marker of markers) {
      const list = map.get(marker.time) ?? [];
      list.push(marker);
      map.set(marker.time, list);
    }
    return map;
  }, [markers]);
  const closes = useMemo(() => series.map((c) => c.close), [series]);

  const indicators = useMemo(() => {
    const bands = bollinger(closes, 20, 2);
    const m = macd(closes);
    return {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema20: ema(closes, 20),
      bbUpper: bands.map((b) => b?.upper ?? null),
      bbMiddle: bands.map((b) => b?.middle ?? null),
      bbLower: bands.map((b) => b?.lower ?? null),
      rsi: rsi(closes, 14),
      macd: m.macd,
      signal: m.signal,
      histogram: m.histogram,
    };
  }, [closes]);

  const legendAt = (index: number): LegendState | null => {
    const c = series[index];
    if (!c) return null;
    const previous = series[index - 1];
    return {
      date: day(c),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: showVolume ? c.volume : null,
      change:
        previous && previous.close > 0
          ? ((c.close - previous.close) / previous.close) * 100
          : null,
      values: {
        sma20: indicators.sma20[index] ?? undefined,
        sma50: indicators.sma50[index] ?? undefined,
        sma200: indicators.sma200[index] ?? undefined,
        ema20: indicators.ema20[index] ?? undefined,
        rsi: indicators.rsi[index] ?? undefined,
        macd: indicators.macd[index] ?? undefined,
      },
    };
  };

  useEffect(() => {
    if (!container.current || series.length === 0) return;
    const palette = PALETTES[resolved];

    const instance = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: palette.text,
        fontSize: 11,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        attributionLogo: false,
        panes: { separatorColor: palette.border, enableResize: true },
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border, timeVisible: false },
      crosshair: {
        vertLine: {
          color: palette.crosshair,
          labelBackgroundColor: palette.crosshairLabel,
        },
        horzLine: {
          color: palette.crosshair,
          labelBackgroundColor: palette.crosshairLabel,
        },
      },
    });
    chart.current = instance;

    const indexByDay = new Map(series.map((c, i) => [day(c), i]));

    let price: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">;
    if (variant === "area") {
      const area = instance.addSeries(AreaSeries, {
        lineColor: palette.area,
        topColor: palette.areaTop,
        bottomColor: "rgba(0,0,0,0)",
        lineWidth: 2,
        priceLineVisible: false,
      });
      area.setData(series.map((c) => ({ time: day(c) as Time, value: c.close })));
      price = area;
    } else {
      const candle = instance.addSeries(CandlestickSeries, {
        upColor: palette.up,
        downColor: palette.down,
        borderVisible: false,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
        priceLineVisible: false,
      });
      candle.setData(
        series.map((c) => ({
          time: day(c) as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
      price = candle;
    }

    const addLine = (
      values: Array<number | null>,
      color: string,
      paneIndex = 0,
      style: LineStyle = LineStyle.Solid,
      width: 1 | 2 = 1,
    ) => {
      const line = instance.addSeries(
        LineSeries,
        {
          color,
          lineWidth: width,
          lineStyle: style,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        paneIndex,
      );
      line.setData(lineData(series, values));
      return line;
    };

    if (overlays.includes("bb")) {
      addLine(indicators.bbUpper, palette.band, 0, LineStyle.Dashed);
      addLine(indicators.bbMiddle, palette.band, 0, LineStyle.Dotted);
      addLine(indicators.bbLower, palette.band, 0, LineStyle.Dashed);
    }
    if (overlays.includes("sma20")) addLine(indicators.sma20, palette.sma20);
    if (overlays.includes("sma50")) addLine(indicators.sma50, palette.sma50);
    if (overlays.includes("sma200")) {
      addLine(indicators.sma200, palette.sma200, 0, LineStyle.Solid, 2);
    }
    if (overlays.includes("ema20")) {
      addLine(indicators.ema20, palette.ema20, 0, LineStyle.Dashed);
    }

    if (studies.includes("volume") && showVolume) {
      const volume = instance.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      instance.priceScale("").applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volume.setData(
        series.map((c) => ({
          time: day(c) as Time,
          value: c.volume,
          color: c.close >= c.open ? palette.volumeUp : palette.volumeDown,
        })),
      );
    }

    let pane = 1;
    const studyPanes: number[] = [];
    if (studies.includes("rsi")) {
      const rsiLine = addLine(indicators.rsi, palette.rsi, pane, LineStyle.Solid, 2);
      for (const level of [30, 70]) {
        rsiLine.createPriceLine({
          price: level,
          color: palette.guide,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }
      studyPanes.push(pane);
      pane += 1;
    }
    if (studies.includes("macd")) {
      const histogram = instance.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      const bars: Array<{ time: Time; value: number; color: string }> = [];
      indicators.histogram.forEach((value, index) => {
        if (value === null) return;
        bars.push({
          time: day(series[index]!) as Time,
          value,
          color: value >= 0 ? palette.volumeUp : palette.volumeDown,
        });
      });
      histogram.setData(bars);
      addLine(indicators.macd, palette.macd, pane, LineStyle.Solid, 2);
      addLine(indicators.signal, palette.signal, pane);
      studyPanes.push(pane);
      pane += 1;
    }

    const panes = instance.panes();
    for (const index of studyPanes) {
      panes[index]?.setHeight(110);
    }

    if (showMarkers && markers.length > 0 && variant === "candles") {
      const list: SeriesMarker<Time>[] = markers
        .filter((marker) => indexByDay.has(marker.time))
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((marker) => ({
          time: marker.time as Time,
          position: marker.bias === "bearish" ? "aboveBar" : "belowBar",
          shape:
            marker.bias === "bullish"
              ? "arrowUp"
              : marker.bias === "bearish"
                ? "arrowDown"
                : "circle",
          color:
            marker.bias === "bullish"
              ? palette.up
              : marker.bias === "bearish"
                ? palette.down
                : palette.text,
          text: markerCode(marker.label),
          size: 1,
        }));
      createSeriesMarkers(price, list);
    }

    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setLegend(null);
        return;
      }
      const index = indexByDay.get(String(param.time));
      if (index === undefined) return;
      setLegend(legendAt(index));
    };
    instance.subscribeCrosshairMove(onMove);

    const last = series.at(-1)!;
    if (range === "ALL") {
      instance.timeScale().fitContent();
    } else {
      const toMs = Date.parse(`${day(last)}T00:00:00Z`);
      const fromDay = new Date(toMs - RANGE_DAYS[range] * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const first = series.find((c) => day(c) >= fromDay) ?? series[0]!;
      instance.timeScale().setVisibleRange({
        from: day(first) as Time,
        to: day(last) as Time,
      });
    }

    return () => {
      instance.unsubscribeCrosshairMove(onMove);
      instance.remove();
      chart.current = null;
    };
    // legendAt only reads values already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    series,
    indicators,
    resolved,
    overlays,
    studies,
    range,
    variant,
    showVolume,
    markers,
    showMarkers,
  ]);

  const toggleOverlay = (overlay: Overlay) =>
    setOverlays((current) =>
      current.includes(overlay)
        ? current.filter((item) => item !== overlay)
        : [...current, overlay],
    );
  const toggleStudy = (study: Study) =>
    setStudies((current) =>
      current.includes(study)
        ? current.filter((item) => item !== study)
        : [...current, study],
    );

  const shown = legend ?? legendAt(series.length - 1);
  const palette = PALETTES[resolved];
  const overlayColour: Record<Overlay, string> = {
    sma20: palette.sma20,
    sma50: palette.sma50,
    sma200: palette.sma200,
    ema20: palette.ema20,
    bb: palette.band,
  };
  const fmt = (value: number | undefined | null, digits = 2) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : value.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  return (
    <div className="chart-shell">
      <div className="chart-toolbar">
        <Segmented<ChartRange>
          label="Chart range"
          value={range}
          onChange={setRange}
          items={(["1M", "3M", "6M", "1Y", "3Y", "5Y", "ALL"] as ChartRange[]).map(
            (value) => ({ value, label: value === "ALL" ? "All" : value }),
          )}
        />
        {variant === "candles" && (
          <div className="row" role="group" aria-label="Indicators">
            {(Object.keys(OVERLAY_LABEL) as Overlay[]).map((overlay) => (
              <button
                key={overlay}
                type="button"
                className="toggle-chip"
                aria-pressed={overlays.includes(overlay)}
                onClick={() => toggleOverlay(overlay)}
              >
                <span
                  className="swatch"
                  style={{ background: overlayColour[overlay] }}
                />
                {OVERLAY_LABEL[overlay]}
              </button>
            ))}
            {allowStudies &&
              (Object.keys(STUDY_LABEL) as Study[])
                .filter((study) => showVolume || study !== "volume")
                .map((study) => (
                  <button
                    key={study}
                    type="button"
                    className="toggle-chip"
                    aria-pressed={studies.includes(study)}
                    onClick={() => toggleStudy(study)}
                  >
                    {STUDY_LABEL[study]}
                  </button>
                ))}
            {markers.length > 0 && (
              <button
                type="button"
                className="toggle-chip"
                aria-pressed={showMarkers}
                onClick={() => setShowMarkers((value) => !value)}
              >
                Patterns
              </button>
            )}
          </div>
        )}
      </div>

      {shown && (
        <div className="chart-legend">
          <span className="legend-item">
            <strong>{shown.date}</strong>
          </span>
          {variant === "candles" ? (
            <>
              <span className="legend-item">
                O <strong>{fmt(shown.open)}</strong>
              </span>
              <span className="legend-item">
                H <strong>{fmt(shown.high)}</strong>
              </span>
              <span className="legend-item">
                L <strong>{fmt(shown.low)}</strong>
              </span>
              <span className="legend-item">
                C <strong>{fmt(shown.close)}</strong>
              </span>
            </>
          ) : (
            <span className="legend-item">
              Close <strong>{fmt(shown.close)}</strong>
            </span>
          )}
          {shown.change !== null && (
            <span
              className={`legend-item ${shown.change >= 0 ? "tone-up" : "tone-down"}`}
            >
              {shown.change >= 0 ? "+" : ""}
              {fmt(shown.change)}%
            </span>
          )}
          {shown.volume !== null && studies.includes("volume") && (
            <span className="legend-item">
              Vol <strong>{fmt(shown.volume, 0)}</strong>
            </span>
          )}
          {variant === "candles" &&
            overlays
              .filter((overlay) => overlay !== "bb")
              .map((overlay) => (
                <span className="legend-item" key={overlay}>
                  <span
                    className="swatch"
                    style={{ background: overlayColour[overlay] }}
                  />
                  {OVERLAY_LABEL[overlay]}{" "}
                  <strong>{fmt(shown.values[overlay])}</strong>
                </span>
              ))}
          {studies.includes("rsi") && (
            <span className="legend-item">
              RSI <strong>{fmt(shown.values.rsi)}</strong>
            </span>
          )}
          {studies.includes("macd") && (
            <span className="legend-item">
              MACD <strong>{fmt(shown.values.macd, 3)}</strong>
            </span>
          )}
          {showMarkers &&
            (markersByDay.get(shown.date) ?? []).map((marker) => (
              <span
                key={marker.label}
                className={`legend-item ${
                  marker.bias === "bullish"
                    ? "tone-up"
                    : marker.bias === "bearish"
                      ? "tone-down"
                      : ""
                }`}
              >
                {marker.bias === "bullish" ? "▲" : marker.bias === "bearish" ? "▼" : "●"}{" "}
                {marker.label} ({markerCode(marker.label)})
              </span>
            ))}
        </div>
      )}

      <div
        className={`price-chart ${
          size === "compact" ? "compact" : size === "tall" ? "tall" : ""
        }`}
        ref={container}
      />
    </div>
  );
}
