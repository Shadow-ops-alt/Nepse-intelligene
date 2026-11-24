import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import {
  adx,
  autoTrendlines,
  bollinger,
  divergences,
  ema,
  ichimoku,
  macd,
  marketStructure,
  obv,
  parabolicSar,
  rsi,
  sma,
  supertrend,
  supplyDemandZones,
  supportResistanceZones,
  swingPoints,
} from "@stock/analytics";
import type { Candle } from "../types";
import { useTheme, type ResolvedTheme } from "../theme";
import { Segmented } from "./ui";
import {
  ChartDrawings,
  DRAWING_COLORS,
  TOOL_HINT,
  TOOL_LABEL,
  type AutoShape,
  type DrawingTool,
} from "./ChartDrawings";

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
  ema9: string;
  ema21: string;
  band: string;
  rsi: string;
  macd: string;
  signal: string;
  guide: string;
  cloudA: string;
  cloudB: string;
  support: string;
  resistance: string;
  demand: string;
  supply: string;
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
    ema9: "#db2777",
    ema21: "#16a34a",
    band: "rgba(102, 112, 133, 0.55)",
    rsi: "#8b3fd9",
    macd: "#3355e0",
    signal: "#e8890c",
    guide: "rgba(102, 112, 133, 0.5)",
    cloudA: "rgba(10, 138, 87, 0.7)",
    cloudB: "rgba(210, 51, 71, 0.7)",
    support: "#0a8a57",
    resistance: "#d23347",
    demand: "#0b9bb5",
    supply: "#e8890c",
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
    ema9: "#f472b6",
    ema21: "#4ade80",
    band: "rgba(155, 166, 182, 0.5)",
    rsi: "#b98cff",
    macd: "#7091ff",
    signal: "#f5a524",
    guide: "rgba(155, 166, 182, 0.45)",
    cloudA: "rgba(43, 201, 143, 0.7)",
    cloudB: "rgba(255, 102, 118, 0.7)",
    support: "#2bc98f",
    resistance: "#ff6676",
    demand: "#3fd0e6",
    supply: "#f5a524",
  },
};

export type Overlay =
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema20"
  | "ema9"
  | "ema21"
  | "bb"
  | "supertrend"
  | "ichimoku"
  | "psar";
export type Study = "volume" | "rsi" | "macd" | "obv" | "adx";
export type Analysis = "sr" | "sd" | "trendlines" | "structure" | "swings" | "divergence";
export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "ALL";

export interface ChartMarker {
  time: string;
  bias: "bullish" | "bearish" | "neutral";
  label: string;
  /** Sessions the pattern spans (1–3). Omitted or 1 for a single candle. */
  span?: number;
}

const EMPTY_MARKERS: ChartMarker[] = [];
const DEFAULT_OVERLAYS: Overlay[] = ["sma50", "sma200"];
const DEFAULT_STUDIES: Study[] = ["volume"];
const NO_ANALYSIS: Analysis[] = [];

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
  ema9: "EMA 9",
  ema21: "EMA 21",
  bb: "Bollinger",
  supertrend: "Supertrend",
  ichimoku: "Ichimoku",
  psar: "Parabolic SAR",
};

const STUDY_LABEL: Record<Study, string> = {
  volume: "Volume",
  rsi: "RSI 14",
  macd: "MACD",
  obv: "OBV",
  adx: "ADX / DMI",
};

const ANALYSIS_LABEL: Record<Analysis, string> = {
  sr: "S/R zones",
  sd: "Supply/demand",
  trendlines: "Auto trendlines",
  structure: "BOS / CHoCH",
  swings: "Swing high/low",
  divergence: "RSI divergence",
};

const DRAW_TOOLS: Array<{ tool: DrawingTool; glyph: string }> = [
  { tool: "cursor", glyph: "↖" },
  { tool: "trend", glyph: "╱" },
  { tool: "ray", glyph: "↗" },
  { tool: "extended", glyph: "⟋" },
  { tool: "hline", glyph: "―" },
  { tool: "hray", glyph: "⟶" },
  { tool: "vline", glyph: "│" },
  { tool: "cross", glyph: "✛" },
  { tool: "rect", glyph: "▭" },
  { tool: "ellipse", glyph: "◯" },
  { tool: "triangle", glyph: "△" },
  { tool: "channel", glyph: "⫽" },
  { tool: "fib", glyph: "Fib" },
  { tool: "fibext", glyph: "F↗" },
  { tool: "fibchannel", glyph: "F⫽" },
  { tool: "pitchfork", glyph: "⑂" },
  { tool: "arrow", glyph: "↦" },
  { tool: "polyline", glyph: "⌁" },
  { tool: "brush", glyph: "✍" },
  { tool: "measure", glyph: "⇕%" },
  { tool: "text", glyph: "T" },
];

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

/** Two/three-letter code drawn on the chart; the full name shows in the legend. */
function markerCode(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 3);
}

function lineData(
  candles: Candle[],
  values: ReadonlyArray<number | null>,
  shift = 0,
): Array<{ time: Time; value: number }> {
  const out: Array<{ time: Time; value: number }> = [];
  values.forEach((value, index) => {
    const target = candles[index + shift];
    if (target && value !== null && value !== undefined && Number.isFinite(value)) {
      out.push({ time: day(target) as Time, value });
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
  values: Partial<Record<Overlay | "rsi" | "macd" | "adx", number>>;
}

export function PriceChart({
  candles,
  variant = "candles",
  size = "normal",
  defaultRange = "1Y",
  defaultOverlays = DEFAULT_OVERLAYS,
  defaultStudies = DEFAULT_STUDIES,
  defaultAnalysis = NO_ANALYSIS,
  allowStudies = true,
  showVolume = true,
  markers = EMPTY_MARKERS,
  drawingKey = null,
  onSnapshot,
}: {
  candles: Candle[];
  variant?: "candles" | "area";
  size?: "compact" | "normal" | "tall";
  defaultRange?: ChartRange;
  defaultOverlays?: Overlay[];
  defaultStudies?: Study[];
  defaultAnalysis?: Analysis[];
  allowStudies?: boolean;
  /** Index series publish no share volume; hide the toggle for them. */
  showVolume?: boolean;
  /** Pattern markers. Pass a memoised array. */
  markers?: ChartMarker[];
  /** Enables the drawing toolbar; drawings are stored per key (e.g. symbol). */
  drawingKey?: string | null;
  /** Enables the "Snap" toolbar button and receives a JPEG data URL. */
  onSnapshot?: (dataUrl: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [handles, setHandles] = useState<{
    chart: IChartApi;
    price: ISeriesApi<SeriesType>;
    version: number;
  } | null>(null);
  const { resolved } = useTheme();
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [overlays, setOverlays] = useState<Overlay[]>(defaultOverlays);
  const [studies, setStudies] = useState<Study[]>(
    showVolume ? defaultStudies : defaultStudies.filter((s) => s !== "volume"),
  );
  const [analysis, setAnalysis] = useState<Analysis[]>(defaultAnalysis);
  const [showMarkers, setShowMarkers] = useState(markers.length > 0);
  const [showPatternZones, setShowPatternZones] = useState(false);
  const [legend, setLegend] = useState<LegendState | null>(null);
  const [panel, setPanel] = useState<"none" | "indicators" | "analysis">("none");
  const [tool, setTool] = useState<DrawingTool>("cursor");
  const [drawColor, setDrawColor] = useState(DRAWING_COLORS[0]!);
  const [magnet, setMagnet] = useState(true);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [drawCount, setDrawCount] = useState(0);
  const [drawOpen, setDrawOpen] = useState(false);
  const drawCommands = useRef<{
    undo: () => void;
    deleteSelected: () => void;
    clear: () => void;
  } | null>(null);

  // Zoom/scroll state survives re-renders and indicator toggles; it resets only
  // when a different series is loaded or the range buttons are used.
  const savedRange = useRef<LogicalRange | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const series = useMemo(() => normalise(candles), [candles]);
  const dates = useMemo(() => series.map(day), [series]);
  const seriesIdentity = useRef(series);
  if (seriesIdentity.current !== series) {
    seriesIdentity.current = series;
    savedRange.current = null;
  }

  const closes = useMemo(() => series.map((c) => c.close), [series]);

  const indicators = useMemo(() => {
    const bands = bollinger(closes, 20, 2);
    const m = macd(closes);
    const st = supertrend(series);
    const ich = ichimoku(series);
    const dmi = adx(series);
    return {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema20: ema(closes, 20),
      ema9: ema(closes, 9),
      ema21: ema(closes, 21),
      bbUpper: bands.map((b) => b?.upper ?? null),
      bbMiddle: bands.map((b) => b?.middle ?? null),
      bbLower: bands.map((b) => b?.lower ?? null),
      rsi: rsi(closes, 14),
      macd: m.macd,
      signal: m.signal,
      histogram: m.histogram,
      supertrend: st.value,
      supertrendDir: st.direction,
      ich,
      psar: parabolicSar(series),
      obv: obv(series),
      adx: dmi.adx,
      plusDi: dmi.plusDi,
      minusDi: dmi.minusDi,
    };
  }, [closes, series]);

  const palette = PALETTES[resolved];

  const analysisShapes = useMemo<AutoShape[]>(() => {
    const shapes: AutoShape[] = [];
    if (series.length < 30) return shapes;
    const n = series.length;
    if (analysis.includes("sr")) {
      for (const zone of supportResistanceZones(series)) {
        shapes.push({
          kind: "zone",
          low: zone.low,
          high: zone.high,
          fromIndex: Math.max(0, n - 250),
          color: zone.kind === "support" ? palette.support : palette.resistance,
          label: `${zone.kind === "support" ? "Support" : "Resistance"} · ${zone.touches} touches`,
        });
      }
    }
    if (analysis.includes("sd")) {
      for (const zone of supplyDemandZones(series)) {
        shapes.push({
          kind: "zone",
          low: zone.low,
          high: zone.high,
          fromIndex: zone.baseStart,
          color: zone.kind === "demand" ? palette.demand : palette.supply,
          label: `${zone.kind === "demand" ? "Demand" : "Supply"}${zone.fresh ? " · fresh" : " · tested"}`,
        });
      }
    }
    if (analysis.includes("trendlines")) {
      for (const line of autoTrendlines(series)) {
        shapes.push({
          kind: "line",
          fromIndex: line.from.index,
          fromPrice: line.from.price,
          toIndex: line.to.index,
          toPrice: line.to.price,
          extend: true,
          dashed: line.broken,
          color: line.kind === "support" ? palette.support : palette.resistance,
          label: `${line.kind === "support" ? "Rising support" : "Falling resistance"}${line.broken ? " (broken)" : ""}`,
        });
      }
    }
    return shapes;
  }, [series, analysis, palette]);

  // Multi-candle patterns: shade the two or three candles that together form
  // each detected pattern. Only the most recent hits are drawn so a long
  // history cannot bury the price action.
  const patternShapes = useMemo<AutoShape[]>(() => {
    if (!showPatternZones || variant !== "candles") return [];
    const indexByTime = new Map(dates.map((date, index) => [date, index]));
    const recent = markers.filter((marker) => (marker.span ?? 1) > 1).slice(-12);
    const shapes: AutoShape[] = [];
    for (const marker of recent) {
      const end = indexByTime.get(marker.time);
      if (end === undefined) continue;
      const fromIndex = Math.max(0, end - ((marker.span ?? 1) - 1));
      let low = Infinity;
      let high = -Infinity;
      for (let index = fromIndex; index <= end; index += 1) {
        const candle = series[index];
        if (!candle) continue;
        low = Math.min(low, candle.low);
        high = Math.max(high, candle.high);
      }
      if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) continue;
      shapes.push({
        kind: "zone",
        low,
        high,
        fromIndex,
        toIndex: end,
        color:
          marker.bias === "bullish"
            ? palette.up
            : marker.bias === "bearish"
              ? palette.down
              : palette.text,
      });
    }
    return shapes;
  }, [showPatternZones, variant, markers, dates, series, palette]);

  const autoShapes = useMemo(
    () => [...analysisShapes, ...patternShapes],
    [analysisShapes, patternShapes],
  );

  const analysisMarkers = useMemo<SeriesMarker<Time>[]>(() => {
    const list: SeriesMarker<Time>[] = [];
    if (series.length < 30) return list;
    if (analysis.includes("swings")) {
      for (const swing of swingPoints(series, 5, 5)) {
        list.push({
          time: dates[swing.index] as Time,
          position: swing.type === "high" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: swing.type === "high" ? palette.resistance : palette.support,
          text: swing.type === "high" ? "SH" : "SL",
          size: 0.6,
        });
      }
    }
    if (analysis.includes("structure")) {
      for (const event of marketStructure(series, 5, 5)) {
        list.push({
          time: dates[event.index] as Time,
          position: event.direction === "bullish" ? "belowBar" : "aboveBar",
          shape: event.direction === "bullish" ? "arrowUp" : "arrowDown",
          color: event.direction === "bullish" ? palette.up : palette.down,
          text: event.type,
          size: 1,
        });
      }
    }
    if (analysis.includes("divergence")) {
      for (const div of divergences(series, indicators.rsi)) {
        const bullish = div.type.endsWith("bullish");
        list.push({
          time: dates[div.toIndex] as Time,
          position: bullish ? "belowBar" : "aboveBar",
          shape: "square",
          color: bullish ? palette.up : palette.down,
          text: div.type.startsWith("hidden") ? "hDiv" : "Div",
          size: 0.8,
        });
      }
    }
    return list;
  }, [series, dates, analysis, indicators.rsi, palette]);

  const markersByDay = useMemo(() => {
    const map = new Map<string, ChartMarker[]>();
    for (const marker of markers) {
      const list = map.get(marker.time) ?? [];
      list.push(marker);
      map.set(marker.time, list);
    }
    return map;
  }, [markers]);

  const legendAt = useCallback(
    (index: number): LegendState | null => {
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
          ema9: indicators.ema9[index] ?? undefined,
          ema21: indicators.ema21[index] ?? undefined,
          supertrend: indicators.supertrend[index] ?? undefined,
          psar: indicators.psar[index]?.value ?? undefined,
          rsi: indicators.rsi[index] ?? undefined,
          macd: indicators.macd[index] ?? undefined,
          adx: indicators.adx[index] ?? undefined,
        },
      };
    },
    [series, indicators, showVolume],
  );

  const applyRange = useCallback(
    (chart: IChartApi, which: ChartRange) => {
      const last = series.at(-1);
      if (!last) return;
      if (which === "ALL") {
        chart.timeScale().fitContent();
        return;
      }
      const toMs = Date.parse(`${day(last)}T00:00:00Z`);
      const fromDay = new Date(toMs - RANGE_DAYS[which] * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const firstIndex = Math.max(0, dates.findIndex((date) => date >= fromDay));
      chart.timeScale().setVisibleLogicalRange({
        from: firstIndex - 0.5,
        to: series.length - 1 + 3,
      });
    },
    [series, dates],
  );

  useEffect(() => {
    if (!container.current || series.length === 0) return;

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
      timeScale: {
        borderColor: palette.border,
        timeVisible: false,
        rightOffset: 3,
        minBarSpacing: 0.5,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
          labelBackgroundColor: palette.crosshairLabel,
        },
        horzLine: {
          color: palette.crosshair,
          labelBackgroundColor: palette.crosshairLabel,
        },
      },
    });

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
      values: ReadonlyArray<number | null>,
      color: string,
      paneIndex = 0,
      style: LineStyle = LineStyle.Solid,
      width: 1 | 2 = 1,
      shift = 0,
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
      line.setData(lineData(series, values, shift));
      return line;
    };

    if (overlays.includes("bb")) {
      addLine(indicators.bbUpper, palette.band, 0, LineStyle.Dashed);
      addLine(indicators.bbMiddle, palette.band, 0, LineStyle.Dotted);
      addLine(indicators.bbLower, palette.band, 0, LineStyle.Dashed);
    }
    if (overlays.includes("ichimoku")) {
      const d = indicators.ich.displacement;
      addLine(indicators.ich.conversion, palette.ema9);
      addLine(indicators.ich.base, palette.sma50);
      // Leading spans are plotted `d` sessions ahead (inside the stored range);
      // the lagging span is the close plotted `d` sessions back.
      addLine(indicators.ich.spanA, palette.cloudA, 0, LineStyle.Solid, 1, d);
      addLine(indicators.ich.spanB, palette.cloudB, 0, LineStyle.Solid, 1, d);
      addLine(indicators.ich.lagging, palette.guide, 0, LineStyle.Dotted, 1, -d);
    }
    if (overlays.includes("sma20")) addLine(indicators.sma20, palette.sma20);
    if (overlays.includes("sma50")) addLine(indicators.sma50, palette.sma50);
    if (overlays.includes("sma200")) {
      addLine(indicators.sma200, palette.sma200, 0, LineStyle.Solid, 2);
    }
    if (overlays.includes("ema20")) {
      addLine(indicators.ema20, palette.ema20, 0, LineStyle.Dashed);
    }
    if (overlays.includes("ema9")) addLine(indicators.ema9, palette.ema9);
    if (overlays.includes("ema21")) addLine(indicators.ema21, palette.ema21);
    if (overlays.includes("supertrend")) {
      const st = instance.addSeries(LineSeries, {
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const points: Array<{ time: Time; value: number; color: string }> = [];
      indicators.supertrend.forEach((value, index) => {
        const direction = indicators.supertrendDir[index];
        if (value === null || direction === null || direction === undefined) return;
        points.push({
          time: dates[index] as Time,
          value,
          color: direction === 1 ? palette.up : palette.down,
        });
      });
      st.setData(points);
    }
    if (overlays.includes("psar")) {
      const sar = instance.addSeries(LineSeries, {
        lineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 1.6,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const points: Array<{ time: Time; value: number; color: string }> = [];
      indicators.psar.forEach((point, index) => {
        if (!point) return;
        points.push({
          time: dates[index] as Time,
          value: point.value,
          color: point.trend === 1 ? palette.up : palette.down,
        });
      });
      sar.setData(points);
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
    const guides = (line: ISeriesApi<"Line">, levels: number[]) => {
      for (const level of levels) {
        line.createPriceLine({
          price: level,
          color: palette.guide,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }
    };
    if (studies.includes("rsi")) {
      const rsiLine = addLine(indicators.rsi, palette.rsi, pane, LineStyle.Solid, 2);
      guides(rsiLine, [30, 50, 70]);
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
          time: dates[index] as Time,
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
    if (studies.includes("obv")) {
      addLine(indicators.obv, palette.macd, pane, LineStyle.Solid, 2);
      studyPanes.push(pane);
      pane += 1;
    }
    if (studies.includes("adx")) {
      const adxLine = addLine(indicators.adx, palette.rsi, pane, LineStyle.Solid, 2);
      addLine(indicators.plusDi, palette.up, pane);
      addLine(indicators.minusDi, palette.down, pane);
      guides(adxLine, [25]);
      studyPanes.push(pane);
      pane += 1;
    }

    const panes = instance.panes();
    for (const index of studyPanes) {
      panes[index]?.setHeight(105);
    }

    const markerList: SeriesMarker<Time>[] = [...analysisMarkers];
    if (showMarkers && markers.length > 0 && variant === "candles") {
      for (const marker of markers) {
        if (!indexByDay.has(marker.time)) continue;
        markerList.push({
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
        });
      }
    }
    if (markerList.length > 0) {
      markerList.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      createSeriesMarkers(price, markerList);
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

    if (savedRange.current) {
      instance.timeScale().setVisibleLogicalRange(savedRange.current);
    } else {
      applyRange(instance, rangeRef.current);
    }
    const remember = (next: LogicalRange | null) => {
      if (next) savedRange.current = next;
    };
    instance.timeScale().subscribeVisibleLogicalRangeChange(remember);

    setHandles((current) => ({
      chart: instance,
      price,
      version: (current?.version ?? 0) + 1,
    }));

    return () => {
      instance.timeScale().unsubscribeVisibleLogicalRangeChange(remember);
      instance.unsubscribeCrosshairMove(onMove);
      setHandles(null);
      instance.remove();
    };
  }, [
    series,
    dates,
    indicators,
    palette,
    overlays,
    studies,
    variant,
    showVolume,
    markers,
    showMarkers,
    analysisMarkers,
    legendAt,
    applyRange,
  ]);

  const chooseRange = (next: ChartRange) => {
    setRange(next);
    if (handles) applyRange(handles.chart, next);
  };

  const toggle = <T,>(setter: (fn: (current: T[]) => T[]) => void, value: T) =>
    setter((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );

  const shown = legend ?? legendAt(series.length - 1);
  const overlayColour: Record<Overlay, string> = {
    sma20: palette.sma20,
    sma50: palette.sma50,
    sma200: palette.sma200,
    ema20: palette.ema20,
    ema9: palette.ema9,
    ema21: palette.ema21,
    bb: palette.band,
    supertrend: palette.up,
    ichimoku: palette.cloudA,
    psar: palette.text,
  };
  const fmt = (value: number | undefined | null, digits = 2) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : value.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  const drawingEnabled = drawingKey !== null && variant === "candles";

  /**
   * Capture the rendered chart plus the drawing overlay as a JPEG. The chart
   * itself is transparent, so the theme surface is painted first; without it a
   * dark theme would export as black. The overlay canvas is a sibling of the
   * chart inside `.chart-stage` and uses the same CSS box.
   */
  const captureSnapshot = useCallback(() => {
    if (!onSnapshot || !handles || !stage.current) return;
    const stageElement = stage.current;
    const source = handles.chart.takeScreenshot();
    if (source.width === 0 || source.height === 0) return;
    const scale = Math.min(1, 1280 / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) return;
    const surface = getComputedStyle(stageElement)
      .getPropertyValue("--surface")
      .trim();
    context.fillStyle = surface || "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const overlay = stageElement.querySelector<HTMLCanvasElement>(
      "canvas.drawing-layer",
    );
    if (overlay && overlay.width > 0 && overlay.height > 0) {
      context.drawImage(overlay, 0, 0, width, height);
    }
    onSnapshot(output.toDataURL("image/jpeg", 0.82));
  }, [handles, onSnapshot]);

  return (
    <div className="chart-shell">
      <div className="chart-toolbar">
        <Segmented<ChartRange>
          label="Chart range"
          value={range}
          onChange={chooseRange}
          items={(["1M", "3M", "6M", "1Y", "3Y", "5Y", "ALL"] as ChartRange[]).map(
            (value) => ({ value, label: value === "ALL" ? "All" : value }),
          )}
        />
        <div className="row">
          {variant === "candles" && (
            <>
              <button
                type="button"
                className="toggle-chip"
                aria-pressed={panel === "indicators"}
                aria-expanded={panel === "indicators"}
                onClick={() => setPanel(panel === "indicators" ? "none" : "indicators")}
              >
                Indicators · {overlays.length + studies.length}
              </button>
              <button
                type="button"
                className="toggle-chip"
                aria-pressed={panel === "analysis"}
                aria-expanded={panel === "analysis"}
                onClick={() => setPanel(panel === "analysis" ? "none" : "analysis")}
              >
                Auto analysis · {analysis.length}
              </button>
              {markers.length > 0 && (
                <button
                  type="button"
                  className="toggle-chip"
                  aria-pressed={showMarkers}
                  onClick={() => setShowMarkers((value) => !value)}
                >
                  Candle patterns
                </button>
              )}
              {markers.some((marker) => (marker.span ?? 1) > 1) && (
                <button
                  type="button"
                  className="toggle-chip"
                  aria-pressed={showPatternZones}
                  title="Shade the two or three candles that form each multi-candle pattern"
                  onClick={() => setShowPatternZones((value) => !value)}
                >
                  Pattern zones
                </button>
              )}
              {onSnapshot && (
                <button
                  type="button"
                  className="toggle-chip"
                  title="Save this chart to the trade journal"
                  disabled={!handles}
                  onClick={captureSnapshot}
                >
                  Snap
                </button>
              )}
            </>
          )}
          {drawingKey !== null && variant === "candles" && (
            <button
              type="button"
              className="toggle-chip"
              aria-pressed={drawOpen}
              aria-expanded={drawOpen}
              title="Drawing tools: lines, zones, Fib, measure, notes"
              onClick={() => {
                setDrawOpen((open) => !open);
                setTool("cursor");
              }}
            >
              ✎ Draw{drawCount > 0 ? ` · ${drawCount}` : ""}
            </button>
          )}
          <button
            type="button"
            className="toggle-chip"
            title="Reset zoom to the selected range (or double-click an axis)"
            onClick={() => {
              savedRange.current = null;
              if (handles) applyRange(handles.chart, range);
            }}
          >
            Reset zoom
          </button>
        </div>
      </div>

      {panel === "indicators" && (
        <div className="chart-panel">
          <div>
            <span className="chart-panel-title">Overlays</span>
            <div className="row">
              {(Object.keys(OVERLAY_LABEL) as Overlay[]).map((overlay) => (
                <button
                  key={overlay}
                  type="button"
                  className="toggle-chip"
                  aria-pressed={overlays.includes(overlay)}
                  onClick={() => toggle(setOverlays, overlay)}
                >
                  <span className="swatch" style={{ background: overlayColour[overlay] }} />
                  {OVERLAY_LABEL[overlay]}
                </button>
              ))}
            </div>
          </div>
          {allowStudies && (
            <div>
              <span className="chart-panel-title">Panes</span>
              <div className="row">
                {(Object.keys(STUDY_LABEL) as Study[])
                  .filter((study) => showVolume || study !== "volume")
                  .map((study) => (
                    <button
                      key={study}
                      type="button"
                      className="toggle-chip"
                      aria-pressed={studies.includes(study)}
                      onClick={() => toggle(setStudies, study)}
                    >
                      {STUDY_LABEL[study]}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {panel === "analysis" && (
        <div className="chart-panel">
          <div>
            <span className="chart-panel-title">Detected from stored candles (derived)</span>
            <div className="row">
              {(Object.keys(ANALYSIS_LABEL) as Analysis[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="toggle-chip"
                  aria-pressed={analysis.includes(item)}
                  onClick={() => toggle(setAnalysis, item)}
                >
                  {ANALYSIS_LABEL[item]}
                </button>
              ))}
            </div>
          </div>
          <p className="muted tiny">
            Zones cluster swing highs/lows within 1.5%; supply/demand = tight
            base then a ≥1.5×ATR impulse; trendlines join the last two swing
            pivots; BOS/CHoCH = close through the last confirmed swing. These
            describe past prices, not forecasts.
          </p>
        </div>
      )}

      {drawingEnabled && drawOpen && (
        <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">
          {DRAW_TOOLS.map(({ tool: item, glyph }) => (
            <button
              key={item}
              type="button"
              className={`draw-tool ${tool === item ? "draw-tool-active" : ""}`}
              title={TOOL_LABEL[item]}
              aria-label={TOOL_LABEL[item]}
              aria-pressed={tool === item}
              onClick={() => setTool(item)}
            >
              {glyph}
            </button>
          ))}
          <span className="draw-sep" />
          {DRAWING_COLORS.map((colour) => (
            <button
              key={colour}
              type="button"
              className={`draw-colour ${drawColor === colour ? "draw-colour-active" : ""}`}
              style={{ background: colour }}
              aria-label={`Colour ${colour}`}
              onClick={() => setDrawColor(colour)}
            />
          ))}
          <span className="draw-sep" />
          <button
            type="button"
            className={`draw-tool ${magnet ? "draw-tool-active" : ""}`}
            title="Magnet: snap to open/high/low/close"
            aria-pressed={magnet}
            onClick={() => setMagnet((value) => !value)}
          >
            🧲
          </button>
          <button
            type="button"
            className="draw-tool"
            title="Undo (Ctrl Z)"
            onClick={() => drawCommands.current?.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            className="draw-tool"
            title="Delete selected (Del)"
            onClick={() => drawCommands.current?.deleteSelected()}
          >
            ⌫
          </button>
          <button
            type="button"
            className={`draw-tool ${drawingsVisible ? "" : "draw-tool-active"}`}
            title={drawingsVisible ? "Hide drawings" : "Show drawings"}
            onClick={() => setDrawingsVisible((value) => !value)}
          >
            {drawingsVisible ? "👁" : "◌"}
          </button>
          <button
            type="button"
            className="draw-tool"
            title="Remove all drawings on this chart"
            disabled={drawCount === 0}
            onClick={() => drawCommands.current?.clear()}
          >
            Clear
          </button>
          <span className="muted tiny">
            {tool === "cursor"
              ? `${drawCount} drawing${drawCount === 1 ? "" : "s"} · drag to move · Del to remove`
              : `${TOOL_LABEL[tool]}: ${TOOL_HINT[tool]} · Esc to cancel`}
          </span>
        </div>
      )}

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
              .filter((overlay) => overlay !== "bb" && overlay !== "ichimoku")
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
          {studies.includes("adx") && (
            <span className="legend-item">
              ADX <strong>{fmt(shown.values.adx)}</strong>
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
                {marker.label} ({markerCode(marker.label)}
                {marker.span && marker.span > 1 ? ` · ${marker.span} candles` : ""})
              </span>
            ))}
        </div>
      )}

      <div
        ref={stage}
        className={`chart-stage ${
          size === "compact" ? "compact" : size === "tall" ? "tall" : ""
        }`}
      >
        <div className="price-chart" ref={container} />
        {(drawingEnabled || autoShapes.length > 0) && (
          <ChartDrawings
            chart={handles?.chart ?? null}
            series={handles?.price ?? null}
            dates={dates}
            version={handles?.version ?? 0}
            storageKey={drawingEnabled ? drawingKey : null}
            auto={autoShapes}
            tool={drawingEnabled ? tool : "cursor"}
            onToolChange={setTool}
            color={drawColor}
            magnet={magnet}
            visible={drawingsVisible}
            onCountChange={setDrawCount}
            commandRef={drawCommands}
          />
        )}
      </div>
    </div>
  );
}
