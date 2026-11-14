import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";

/**
 * TradingView-style drawing layer over a lightweight-charts price pane.
 *
 * Points are stored as (bar date + fractional bar offset, price) so drawings
 * stay anchored to the same sessions when new candles are appended, and can
 * extend into the empty space right of the last bar. Drawings are a per-viewer
 * convenience kept in localStorage; they never touch market data.
 */

export type DrawingTool =
  | "cursor"
  | "trend"
  | "ray"
  | "extended"
  | "hline"
  | "hray"
  | "vline"
  | "rect"
  | "channel"
  | "fib"
  | "measure"
  | "text";

interface AnchorPoint {
  date: string;
  frac: number;
  price: number;
}

interface Drawing {
  id: string;
  tool: Exclude<DrawingTool, "cursor">;
  points: AnchorPoint[];
  color: string;
  text?: string;
}

/** Read-only analysis shapes drawn by the app (zones, auto trendlines). */
export interface AutoShape {
  kind: "zone" | "line";
  color: string;
  label?: string;
  /** zone: price band from `fromIndex` to the right edge (or `toIndex`). */
  low?: number;
  high?: number;
  fromIndex: number;
  toIndex?: number;
  /** line: from (fromIndex, fromPrice) to (toIndex, toPrice), extended right. */
  fromPrice?: number;
  toPrice?: number;
  extend?: boolean;
  dashed?: boolean;
}

const TWO_POINT: ReadonlySet<DrawingTool> = new Set([
  "trend",
  "ray",
  "extended",
  "rect",
  "channel",
  "fib",
  "measure",
]);

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const DRAWING_COLORS = ["#3355e0", "#e8890c", "#0a8a57", "#d23347", "#8b3fd9", "#0b9bb5"];

export const TOOL_LABEL: Record<DrawingTool, string> = {
  cursor: "Cursor",
  trend: "Trend line",
  ray: "Ray",
  extended: "Extended line",
  hline: "Horizontal line",
  hray: "Horizontal ray",
  vline: "Vertical line",
  rect: "Rectangle / zone",
  channel: "Parallel channel",
  fib: "Fib retracement",
  measure: "Measure",
  text: "Text note",
};

function storageKeyFor(key: string): string {
  return `nepse-terminal.drawings.${key}`;
}

function loadDrawings(key: string): Drawing[] {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(key));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
}

function saveDrawings(key: string, drawings: Drawing[]): void {
  try {
    window.localStorage.setItem(storageKeyFor(key), JSON.stringify(drawings));
  } catch {
    // Persistence is best-effort.
  }
}

interface Px {
  x: number;
  y: number;
}

function distanceToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Extend segment a→b to the canvas edges (both directions, or forward only). */
function extendLine(a: Px, b: Px, width: number, height: number, both: boolean): [Px, Px] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return [a, b];
  const big = (width + height) * 4;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const end = { x: a.x + ux * big, y: a.y + uy * big };
  const start = both ? { x: a.x - ux * big, y: a.y - uy * big } : a;
  return [start, end];
}

export function ChartDrawings({
  chart,
  series,
  dates,
  version,
  storageKey,
  auto,
  tool,
  onToolChange,
  color,
  magnet,
  visible,
  onCountChange,
  commandRef,
}: {
  chart: IChartApi | null;
  series: ISeriesApi<SeriesType> | null;
  /** Bar dates (YYYY-MM-DD) in chart order. */
  dates: string[];
  /** Bumped whenever the chart instance is recreated. */
  version: number;
  storageKey: string | null;
  auto: AutoShape[];
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  color: string;
  magnet: boolean;
  visible: boolean;
  onCountChange?: (count: number) => void;
  commandRef?: React.MutableRefObject<{
    undo: () => void;
    deleteSelected: () => void;
    clear: () => void;
  } | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawings, setDrawings] = useState<Drawing[]>(() =>
    storageKey ? loadDrawings(storageKey) : [],
  );
  const history = useRef<Drawing[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; point: AnchorPoint } | null>(null);
  const drag = useRef<{ id: string; start: AnchorPoint; original: AnchorPoint[]; pointIndex: number | null } | null>(null);
  const frame = useRef<number | null>(null);

  const indexByDate = useRef(new Map<string, number>());
  useEffect(() => {
    indexByDate.current = new Map(dates.map((date, index) => [date, index]));
  }, [dates]);

  useEffect(() => {
    setDrawings(storageKey ? loadDrawings(storageKey) : []);
    history.current = [];
    setSelected(null);
  }, [storageKey]);

  useEffect(() => {
    onCountChange?.(drawings.length);
  }, [drawings, onCountChange]);

  const commit = useCallback(
    (next: Drawing[]) => {
      setDrawings((current) => {
        history.current.push(current);
        if (history.current.length > 50) history.current.shift();
        return next;
      });
      if (storageKey) saveDrawings(storageKey, next);
    },
    [storageKey],
  );

  // ----- coordinate conversion ------------------------------------------------
  const toLogical = useCallback((point: AnchorPoint): number => {
    const index = indexByDate.current.get(point.date);
    return (index ?? 0) + point.frac;
  }, []);

  const toPx = useCallback(
    (point: AnchorPoint): Px | null => {
      if (!chart || !series) return null;
      const x = chart.timeScale().logicalToCoordinate(toLogical(point) as never);
      const y = series.priceToCoordinate(point.price);
      if (x === null || y === null) return null;
      return { x, y };
    },
    [chart, series, toLogical],
  );

  const fromPx = useCallback(
    (x: number, y: number): AnchorPoint | null => {
      if (!chart || !series || dates.length === 0) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      const rawPrice = series.coordinateToPrice(y);
      if (logical === null || rawPrice === null) return null;
      let price: number = rawPrice;
      const base = Math.max(0, Math.min(dates.length - 1, Math.floor(logical)));
      if (magnet) {
        const nearest = Math.max(0, Math.min(dates.length - 1, Math.round(logical)));
        const bar = series.dataByIndex(nearest) as
          | { open?: number; high?: number; low?: number; close?: number; value?: number }
          | null;
        const candidates = bar
          ? [bar.open, bar.high, bar.low, bar.close, bar.value].filter(
              (value): value is number => typeof value === "number",
            )
          : [];
        let best: number | null = null;
        let bestDistance = 12;
        for (const candidate of candidates) {
          const cy = series.priceToCoordinate(candidate);
          if (cy !== null && Math.abs(cy - y) < bestDistance) {
            bestDistance = Math.abs(cy - y);
            best = candidate;
          }
        }
        if (best !== null) {
          price = best;
          return { date: dates[nearest]!, frac: 0, price };
        }
      }
      return { date: dates[base]!, frac: logical - base, price };
    },
    [chart, series, dates, magnet],
  );

  // ----- rendering ----------------------------------------------------------
  const render = useCallback(() => {
    const element = canvas.current;
    if (!element || !chart || !series) return;
    const parent = element.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!visible) return;

    const paneWidth = chart.timeScale().width();
    const paneHeight = chart.panes()[0]?.getHeight() ?? height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, paneWidth, paneHeight);
    ctx.clip();
    ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
    ctx.lineWidth = 1.5;

    const xAt = (index: number) => chart.timeScale().logicalToCoordinate(index as never);
    const yAt = (price: number) => series.priceToCoordinate(price);

    // Auto analysis shapes first (underneath user drawings).
    for (const shape of auto) {
      const x1 = xAt(shape.fromIndex);
      const x2 = shape.toIndex !== undefined ? xAt(shape.toIndex) : paneWidth;
      if (x1 === null) continue;
      if (shape.kind === "zone" && shape.low !== undefined && shape.high !== undefined) {
        const y1 = yAt(shape.high);
        const y2 = yAt(shape.low);
        if (y1 === null || y2 === null) continue;
        const right = x2 ?? paneWidth;
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = shape.color;
        ctx.fillRect(x1, y1, right - x1, Math.max(1, y2 - y1));
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = shape.color;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x1, y1, right - x1, Math.max(1, y2 - y1));
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        if (shape.label) {
          ctx.fillStyle = shape.color;
          ctx.fillText(shape.label, Math.max(x1, 4) + 4, y1 + 12);
        }
      } else if (shape.kind === "line" && shape.fromPrice !== undefined && shape.toPrice !== undefined && shape.toIndex !== undefined) {
        const a: Px = { x: x1, y: yAt(shape.fromPrice) ?? 0 };
        const bx = xAt(shape.toIndex);
        const by = yAt(shape.toPrice);
        if (bx === null || by === null) continue;
        let [p1, p2]: [Px, Px] = [a, { x: bx, y: by }];
        if (shape.extend) [p1, p2] = [a, extendLine(a, { x: bx, y: by }, paneWidth, paneHeight, false)[1]];
        ctx.strokeStyle = shape.color;
        ctx.setLineDash(shape.dashed ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (shape.label) {
          ctx.fillStyle = shape.color;
          ctx.fillText(shape.label, bx + 4, by - 4);
        }
      }
    }

    const all = draft ? [...drawings, draft] : drawings;
    for (const drawing of all) {
      const pts = drawing.points.map(toPx);
      if (pts.some((p) => p === null)) continue;
      const p = pts as Px[];
      const a = p[0]!;
      const b = p[1] ?? a;
      ctx.strokeStyle = drawing.color;
      ctx.fillStyle = drawing.color;
      ctx.lineWidth = drawing.id === selected ? 2.5 : 1.5;
      ctx.beginPath();
      switch (drawing.tool) {
        case "trend":
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          break;
        case "ray":
        case "extended": {
          const [s, e] = extendLine(a, b, paneWidth, paneHeight, drawing.tool === "extended");
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
          break;
        }
        case "hline":
        case "hray": {
          ctx.moveTo(drawing.tool === "hline" ? 0 : a.x, a.y);
          ctx.lineTo(paneWidth, a.y);
          ctx.stroke();
          const label = drawing.points[0]!.price.toFixed(2);
          const w = ctx.measureText(label).width + 8;
          ctx.fillRect(paneWidth - w, a.y - 9, w, 18);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, paneWidth - w + 4, a.y + 4);
          break;
        }
        case "vline":
          ctx.moveTo(a.x, 0);
          ctx.lineTo(a.x, paneHeight);
          ctx.stroke();
          break;
        case "rect":
          ctx.globalAlpha = 0.15;
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          ctx.globalAlpha = 1;
          ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          break;
        case "channel": {
          // Second line parallel to a→b, offset by the third point (or 5% of price).
          const offset = p[2] ? p[2].y - (a.y + ((b.y - a.y) * (p[2].x - a.x)) / ((b.x - a.x) || 1)) : 40;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.moveTo(a.x, a.y + offset);
          ctx.lineTo(b.x, b.y + offset);
          ctx.stroke();
          ctx.globalAlpha = 0.08;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x, b.y + offset);
          ctx.lineTo(a.x, a.y + offset);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case "fib": {
          const p1 = drawing.points[0]!.price;
          const p2 = (drawing.points[1] ?? drawing.points[0]!).price;
          const left = Math.min(a.x, b.x);
          for (const level of FIB_LEVELS) {
            const price = p2 + (p1 - p2) * level;
            const y = yAt(price);
            if (y === null) continue;
            ctx.globalAlpha = level === 0 || level === 1 ? 0.9 : 0.6;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(paneWidth, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(`${level.toFixed(3)} · ${price.toFixed(2)}`, left + 4, y - 3);
          }
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "measure": {
          const from = drawing.points[0]!;
          const to = drawing.points[1] ?? from;
          const change = to.price - from.price;
          const percent = from.price !== 0 ? (change / from.price) * 100 : 0;
          const bars = Math.round(toLogical(to) - toLogical(from));
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = change >= 0 ? "#0a8a57" : "#d23347";
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          ctx.globalAlpha = 1;
          const label = `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%) · ${bars} bars`;
          const w = ctx.measureText(label).width + 10;
          const lx = (a.x + b.x) / 2 - w / 2;
          const ly = Math.min(a.y, b.y) - 22;
          ctx.fillRect(lx, ly, w, 18);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, lx + 5, ly + 13);
          break;
        }
        case "text": {
          ctx.font = "12px Inter, ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(drawing.text ?? "", a.x, a.y);
          ctx.font = "11px Inter, ui-sans-serif, system-ui, sans-serif";
          break;
        }
      }
      if (drawing.id === selected) {
        for (const point of p) {
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = drawing.color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }, [chart, series, auto, drawings, draft, selected, toPx, toLogical, visible]);

  // Redraw on chart pan/zoom/resize and continuously while the pointer is over
  // the chart (price-scale drags do not emit an event).
  useEffect(() => {
    if (!chart) return;
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        render();
      });
    };
    schedule();
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.subscribeCrosshairMove(schedule);
    const parent = canvas.current?.parentElement;
    const observer = new ResizeObserver(schedule);
    if (parent) observer.observe(parent);
    let hoverLoop: number | null = null;
    const loop = () => {
      render();
      hoverLoop = requestAnimationFrame(loop);
    };
    const enter = () => {
      if (hoverLoop === null) hoverLoop = requestAnimationFrame(loop);
    };
    const leave = () => {
      if (hoverLoop !== null) cancelAnimationFrame(hoverLoop);
      hoverLoop = null;
      schedule();
    };
    parent?.addEventListener("pointerenter", enter);
    parent?.addEventListener("pointerleave", leave);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
      chart.unsubscribeCrosshairMove(schedule);
      observer.disconnect();
      parent?.removeEventListener("pointerenter", enter);
      parent?.removeEventListener("pointerleave", leave);
      if (hoverLoop !== null) cancelAnimationFrame(hoverLoop);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [chart, version, render]);

  // ----- hit testing --------------------------------------------------------
  const hitTest = useCallback(
    (x: number, y: number): { id: string; pointIndex: number | null } | null => {
      if (!chart) return null;
      const paneWidth = chart.timeScale().width();
      const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
      const mouse = { x, y };
      for (let i = drawings.length - 1; i >= 0; i -= 1) {
        const drawing = drawings[i]!;
        const pts = drawing.points.map(toPx);
        if (pts.some((p) => p === null)) continue;
        const p = pts as Px[];
        for (let k = 0; k < p.length; k += 1) {
          if (Math.hypot(p[k]!.x - x, p[k]!.y - y) < 7) return { id: drawing.id, pointIndex: k };
        }
        const a = p[0]!;
        const b = p[1] ?? a;
        let distance = Infinity;
        switch (drawing.tool) {
          case "trend":
          case "fib":
          case "channel":
            distance = distanceToSegment(mouse, a, b);
            break;
          case "ray":
          case "extended": {
            const [s, e] = extendLine(a, b, paneWidth, paneHeight, drawing.tool === "extended");
            distance = distanceToSegment(mouse, s, e);
            break;
          }
          case "hline":
            distance = Math.abs(y - a.y);
            break;
          case "hray":
            distance = x >= a.x - 4 ? Math.abs(y - a.y) : Infinity;
            break;
          case "vline":
            distance = Math.abs(x - a.x);
            break;
          case "rect":
          case "measure": {
            const inside =
              x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4 &&
              y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4;
            distance = inside ? 0 : Infinity;
            break;
          }
          case "text":
            distance = x >= a.x - 4 && x <= a.x + 8 * (drawing.text?.length ?? 1) && y <= a.y + 4 && y >= a.y - 16 ? 0 : Infinity;
            break;
        }
        if (distance < 6) return { id: drawing.id, pointIndex: null };
      }
      return null;
    },
    [chart, drawings, toPx],
  );

  // ----- pointer handling ---------------------------------------------------
  // Registered in the capture phase on the chart wrapper so a hit on a drawing
  // (or any click while a drawing tool is active) never pans the chart.
  useEffect(() => {
    const element = canvas.current?.parentElement;
    if (!element) return;
    const local = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const inPricePane = (y: number) => y <= (chart?.panes()[0]?.getHeight() ?? Infinity);

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const { x, y } = local(event);
      if (!inPricePane(y)) return;
      if (tool === "cursor") {
        if (!visible) return;
        const hit = hitTest(x, y);
        setSelected(hit?.id ?? null);
        if (hit) {
          const start = fromPx(x, y);
          const drawing = drawings.find((d) => d.id === hit.id);
          if (start && drawing) {
            drag.current = { id: hit.id, start, original: drawing.points, pointIndex: hit.pointIndex };
            history.current.push(drawings);
          }
          event.stopPropagation();
          event.preventDefault();
        }
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      const point = fromPx(x, y);
      if (!point) return;
      if (tool === "text") {
        setTextEdit({ x, y, point });
        return;
      }
      if (!TWO_POINT.has(tool)) {
        const drawing: Drawing = { id: crypto.randomUUID(), tool, points: [point], color };
        commit([...drawings, drawing]);
        setSelected(drawing.id);
        onToolChange("cursor");
        return;
      }
      if (draft) {
        const finished = { ...draft, points: [draft.points[0]!, point] };
        commit([...drawings, finished]);
        setDraft(null);
        setSelected(finished.id);
        onToolChange("cursor");
      } else {
        setDraft({ id: crypto.randomUUID(), tool, points: [point, point], color });
      }
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = local(event);
      if (draft) {
        const point = fromPx(x, y);
        if (point) setDraft({ ...draft, points: [draft.points[0]!, point] });
        return;
      }
      if (drag.current) {
        const current = fromPx(x, y);
        if (!current) return;
        const { id, start, original, pointIndex } = drag.current;
        const dLogical = toLogical(current) - toLogical(start);
        const dPrice = current.price - start.price;
        const shift = (point: AnchorPoint): AnchorPoint => {
          const target = toLogical(point) + dLogical;
          const base = Math.max(0, Math.min(dates.length - 1, Math.floor(target)));
          return { date: dates[base]!, frac: target - base, price: point.price + dPrice };
        };
        setDrawings((list) =>
          list.map((drawing) =>
            drawing.id !== id
              ? drawing
              : {
                  ...drawing,
                  points: original.map((point, index) =>
                    pointIndex === null || pointIndex === index
                      ? pointIndex === null
                        ? shift(point)
                        : current
                      : point,
                  ),
                },
          ),
        );
        event.stopPropagation();
      }
    };

    const onUp = (event: PointerEvent) => {
      if (draft) {
        // Press-drag-release also completes a two-point drawing.
        const first = toPx(draft.points[0]!);
        const { x, y } = local(event);
        if (first && Math.hypot(first.x - x, first.y - y) > 8) {
          const point = fromPx(x, y);
          if (point) {
            const finished = { ...draft, points: [draft.points[0]!, point] };
            commit([...drawings, finished]);
            setDraft(null);
            setSelected(finished.id);
            onToolChange("cursor");
          }
        }
        return;
      }
      if (drag.current) {
        drag.current = null;
        setDrawings((list) => {
          if (storageKey) saveDrawings(storageKey, list);
          return list;
        });
      }
    };

    element.addEventListener("pointerdown", onDown, true);
    element.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      element.removeEventListener("pointerdown", onDown, true);
      element.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [chart, tool, color, draft, drawings, hitTest, fromPx, toPx, toLogical, commit, dates, onToolChange, storageKey, visible]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    setDrawings(previous);
    if (storageKey) saveDrawings(storageKey, previous);
  }, [storageKey]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    commit(drawings.filter((drawing) => drawing.id !== selected));
    setSelected(null);
  }, [selected, drawings, commit]);

  const clear = useCallback(() => {
    if (drawings.length === 0) return;
    commit([]);
    setSelected(null);
  }, [drawings, commit]);

  useEffect(() => {
    if (commandRef) commandRef.current = { undo, deleteSelected, clear };
  }, [commandRef, undo, deleteSelected, clear]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        setDraft(null);
        setSelected(null);
        if (tool !== "cursor") onToolChange("cursor");
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        deleteSelected();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, tool, onToolChange, deleteSelected, undo]);

  return (
    <>
      <canvas
        ref={canvas}
        className="drawing-layer"
        style={{ cursor: tool === "cursor" ? "default" : "crosshair" }}
        aria-hidden="true"
      />
      {tool !== "cursor" && <div className="drawing-capture" />}
      {textEdit && (
        <input
          className="drawing-text-input"
          autoFocus
          placeholder="Note, then Enter"
          style={{ left: textEdit.x, top: textEdit.y - 14 }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const text = event.currentTarget.value.trim();
              if (text) {
                commit([
                  ...drawings,
                  { id: crypto.randomUUID(), tool: "text", points: [textEdit.point], color, text },
                ]);
              }
              setTextEdit(null);
              onToolChange("cursor");
            } else if (event.key === "Escape") {
              setTextEdit(null);
            }
          }}
          onBlur={() => setTextEdit(null)}
        />
      )}
    </>
  );
}
