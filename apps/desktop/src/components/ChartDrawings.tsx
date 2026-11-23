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
  | "cross"
  | "rect"
  | "ellipse"
  | "triangle"
  | "channel"
  | "fib"
  | "fibext"
  | "fibchannel"
  | "pitchfork"
  | "arrow"
  | "polyline"
  | "brush"
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

/** Fixed clicks per tool. 0 means variable length (polyline / brush). */
const POINT_COUNT: Partial<Record<Exclude<DrawingTool, "cursor">, number>> = {
  hline: 1,
  hray: 1,
  vline: 1,
  cross: 1,
  text: 1,
  trend: 2,
  ray: 2,
  extended: 2,
  rect: 2,
  ellipse: 2,
  arrow: 2,
  fib: 2,
  measure: 2,
  triangle: 3,
  channel: 3,
  fibext: 3,
  fibchannel: 3,
  pitchfork: 3,
  polyline: 0,
  brush: 0,
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_EXTENSION_LEVELS = [0, 0.618, 1, 1.618, 2.618];

export const DRAWING_COLORS = ["#3355e0", "#e8890c", "#0a8a57", "#d23347", "#8b3fd9", "#0b9bb5"];

export const TOOL_LABEL: Record<DrawingTool, string> = {
  cursor: "Cursor",
  trend: "Trend line",
  ray: "Ray",
  extended: "Extended line",
  hline: "Horizontal line",
  hray: "Horizontal ray",
  vline: "Vertical line",
  cross: "Cross line",
  rect: "Rectangle / zone",
  ellipse: "Ellipse",
  triangle: "Triangle",
  channel: "Parallel channel",
  fib: "Fib retracement",
  fibext: "Fib extension",
  fibchannel: "Fib channel",
  pitchfork: "Pitchfork",
  arrow: "Arrow",
  polyline: "Polyline",
  brush: "Brush",
  measure: "Measure",
  text: "Text note",
};

/** Short instruction shown in the toolbar for the active tool. */
export const TOOL_HINT: Record<DrawingTool, string> = {
  cursor: "drag to move · Del to remove",
  trend: "click start, click end · drag also works",
  ray: "click start, click end",
  extended: "click start, click end",
  hline: "click a price",
  hray: "click a start point",
  vline: "click a session",
  cross: "click to place crosshair lines",
  rect: "click a corner, then the opposite corner",
  ellipse: "click a corner, then size the ellipse",
  triangle: "click three corners",
  channel: "click two points for the base, then the offset",
  fib: "click the swing high and low",
  fibext: "click three points: leg start, leg end, extension base",
  fibchannel: "click two points, then the channel offset",
  pitchfork: "click the pivot and two reaction points",
  arrow: "click start, click the arrow head",
  polyline: "click points · double-click or Enter to finish",
  brush: "drag to draw freehand",
  measure: "click start, click end to measure",
  text: "click to place a note",
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

function polylineDistance(p: Px, points: Px[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!));
  }
  return best;
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

/** Point on the ray from `origin` in direction `dir` where it leaves the pane. */
function rayToEdge(origin: Px, dir: Px, width: number, height: number): Px {
  if (Math.abs(dir.x) < 1e-6) {
    const y = dir.y >= 0 ? height : 0;
    return { x: origin.x, y };
  }
  const edge = dir.x > 0 ? width : 0;
  const t = (edge - origin.x) / dir.x;
  return { x: edge, y: origin.y + dir.y * t };
}

function arrowHead(ctx: CanvasRenderingContext2D, from: Px, to: Px): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 9;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
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
  const [hover, setHover] = useState<AnchorPoint | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  draftRef.current = draft;
  const painting = useRef(false);
  const [textEdit, setTextEdit] = useState<{ x: number; y: number; point: AnchorPoint } | null>(null);
  const drag = useRef<{ id: string; start: AnchorPoint; original: AnchorPoint[]; pointIndex: number | null } | null>(null);
  /** Raw pointer-down pixel, used to tell a click from a press-drag. */
  const downAt = useRef<Px | null>(null);
  const frame = useRef<number | null>(null);

  const indexByDate = useRef(new Map<string, number>());
  useEffect(() => {
    indexByDate.current = new Map(dates.map((date, index) => [date, index]));
  }, [dates]);

  useEffect(() => {
    setDrawings(storageKey ? loadDrawings(storageKey) : []);
    history.current = [];
    setSelected(null);
    setDraft(null);
    setHover(null);
    painting.current = false;
  }, [storageKey]);

  useEffect(() => {
    onCountChange?.(drawings.length);
  }, [drawings, onCountChange]);

  // Leaving or switching a drawing tool cancels any half-finished shape.
  useEffect(() => {
    const current = draftRef.current;
    if (current && current.tool !== tool) {
      setDraft(null);
      setHover(null);
      painting.current = false;
    }
    if (tool === "cursor") {
      setDraft(null);
      setHover(null);
      painting.current = false;
    }
  }, [tool]);

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

    // The hover point previews the next click of a multi-point drawing.
    const draftPoints =
      draft === null
        ? []
        : draft.tool === "brush" || draft.tool === "polyline"
          ? [...draft.points, ...(draft.tool === "polyline" && hover ? [hover] : [])]
          : [...draft.points, ...(hover ? [hover] : [])];
    const all: Drawing[] = draft ? [...drawings, { ...draft, points: draftPoints }] : drawings;

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
        case "cross":
          ctx.globalAlpha = 0.85;
          ctx.moveTo(0, a.y);
          ctx.lineTo(paneWidth, a.y);
          ctx.moveTo(a.x, 0);
          ctx.lineTo(a.x, paneHeight);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case "rect":
          ctx.globalAlpha = 0.15;
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          ctx.globalAlpha = 1;
          ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          break;
        case "ellipse": {
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          const rx = Math.abs(b.x - a.x) / 2;
          const ry = Math.abs(b.y - a.y) / 2;
          ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.12;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
          break;
        }
        case "triangle": {
          if (!p[2]) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            break;
          }
          const c = p[2];
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
          ctx.globalAlpha = 0.12;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
          break;
        }
        case "channel": {
          // Second line parallel to a→b, offset by the third point (or 40px).
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
        case "fibext": {
          const base = p[2] ?? b;
          const range = drawing.points[1] ? drawing.points[1]!.price - drawing.points[0]!.price : 0;
          const basePrice = (drawing.points[2] ?? drawing.points[1] ?? drawing.points[0]!)!.price;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          if (p[2]) ctx.lineTo(p[2].x, p[2].y);
          ctx.stroke();
          ctx.setLineDash([]);
          for (const level of FIB_EXTENSION_LEVELS) {
            const price = basePrice + range * level;
            const y = yAt(price);
            if (y === null) continue;
            ctx.globalAlpha = level === 0 || level === 1 ? 0.85 : 0.55;
            ctx.beginPath();
            ctx.moveTo(base.x, y);
            ctx.lineTo(paneWidth, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(`${level.toFixed(3)} · ${price.toFixed(2)}`, base.x + 4, y - 3);
          }
          break;
        }
        case "fibchannel": {
          if (!p[2]) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            break;
          }
          const c = p[2];
          const slope = (b.y - a.y) / ((b.x - a.x) || 1);
          const offset = c.y - (a.y + slope * (c.x - a.x));
          const left = Math.min(a.x, c.x);
          const right = paneWidth;
          for (const level of FIB_LEVELS) {
            const y = a.y + slope * (left - a.x) + offset * level;
            ctx.globalAlpha = level === 0 || level === 1 ? 0.85 : 0.5;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillText(level.toFixed(3), left + 4, y - 3);
          }
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = drawing.color;
          ctx.beginPath();
          ctx.moveTo(left, a.y + slope * (left - a.x));
          ctx.lineTo(right, a.y + slope * (right - a.x));
          ctx.lineTo(right, a.y + slope * (right - a.x) + offset);
          ctx.lineTo(left, a.y + slope * (left - a.x) + offset);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = drawing.color;
          break;
        }
        case "pitchfork": {
          if (!p[2]) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            break;
          }
          const c = p[2];
          const mid: Px = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
          const dir: Px = { x: mid.x - a.x, y: mid.y - a.y };
          const medianEnd = rayToEdge(a, dir, paneWidth, paneHeight);
          const tineTop = rayToEdge(b, dir, paneWidth, paneHeight);
          const tineBottom = rayToEdge(c, dir, paneWidth, paneHeight);
          ctx.setLineDash([3, 3]);
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(medianEnd.x, medianEnd.y);
          ctx.stroke();
          ctx.globalAlpha = 0.65;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(tineTop.x, tineTop.y);
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(tineBottom.x, tineBottom.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case "arrow": {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          arrowHead(ctx, a, b);
          break;
        }
        case "polyline": {
          if (p.length < 2) break;
          ctx.moveTo(p[0]!.x, p[0]!.y);
          for (let i = 1; i < p.length; i += 1) ctx.lineTo(p[i]!.x, p[i]!.y);
          ctx.stroke();
          break;
        }
        case "brush": {
          if (p.length < 2) break;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.moveTo(p[0]!.x, p[0]!.y);
          for (let i = 1; i < p.length; i += 1) {
            const previous = p[i - 1]!;
            const current = p[i]!;
            const mid = { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
            ctx.quadraticCurveTo(previous.x, previous.y, mid.x, mid.y);
          }
          ctx.stroke();
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
        const handles = p.length <= 8 ? p : [p[0]!, p[p.length - 1]!];
        for (const point of handles) {
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
  }, [chart, series, auto, drawings, draft, hover, selected, toPx, toLogical, visible]);

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
          case "cross":
            distance = Math.min(Math.abs(y - a.y), Math.abs(x - a.x));
            break;
          case "arrow":
            distance = distanceToSegment(mouse, a, b);
            break;
          case "rect":
          case "measure": {
            const inside =
              x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4 &&
              y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4;
            distance = inside ? 0 : Infinity;
            break;
          }
          case "ellipse": {
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
            const ry = Math.max(1, Math.abs(b.y - a.y) / 2);
            const norm = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            distance = Math.abs(norm - 1) < 0.25 ? 0 : Infinity;
            break;
          }
          case "triangle": {
            if (!p[2]) {
              distance = distanceToSegment(mouse, a, b);
              break;
            }
            distance = Math.min(
              distanceToSegment(mouse, p[0]!, p[1]!),
              distanceToSegment(mouse, p[1]!, p[2]!),
              distanceToSegment(mouse, p[2]!, p[0]!),
            );
            break;
          }
          case "fibext": {
            if (!p[2]) {
              distance = distanceToSegment(mouse, a, b);
              break;
            }
            const base = p[2];
            if (x < base.x - 4) {
              distance = distanceToSegment(mouse, a, b);
              break;
            }
            const range = drawing.points[1] ? drawing.points[1]!.price - drawing.points[0]!.price : 0;
            const basePrice = (drawing.points[2] ?? drawing.points[1] ?? drawing.points[0]!)!.price;
            distance = Math.min(
              ...FIB_EXTENSION_LEVELS.map((level) => {
                const yy = series ? series.priceToCoordinate(basePrice + range * level) : null;
                return yy === null ? Infinity : Math.abs(y - yy);
              }),
            );
            break;
          }
          case "fibchannel": {
            if (!p[2]) {
              distance = distanceToSegment(mouse, a, b);
              break;
            }
            const c = p[2];
            const slope = (b.y - a.y) / ((b.x - a.x) || 1);
            const offset = c.y - (a.y + slope * (c.x - a.x));
            const left = Math.min(a.x, c.x);
            const right = paneWidth;
            if (x < left - 4 || x > right + 4) {
              distance = Infinity;
              break;
            }
            distance = Math.min(
              ...FIB_LEVELS.map((level) => Math.abs(y - (a.y + slope * (x - a.x) + offset * level))),
            );
            break;
          }
          case "pitchfork": {
            if (!p[2]) {
              distance = distanceToSegment(mouse, a, b);
              break;
            }
            const c = p[2];
            const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
            const dir = { x: mid.x - a.x, y: mid.y - a.y };
            distance = Math.min(
              distanceToSegment(mouse, a, rayToEdge(a, dir, paneWidth, paneHeight)),
              distanceToSegment(mouse, b, rayToEdge(b, dir, paneWidth, paneHeight)),
              distanceToSegment(mouse, c, rayToEdge(c, dir, paneWidth, paneHeight)),
            );
            break;
          }
          case "polyline":
          case "brush":
            distance = p.length > 1 ? polylineDistance(mouse, p) : Infinity;
            break;
          case "text":
            distance = x >= a.x - 4 && x <= a.x + 8 * (drawing.text?.length ?? 1) && y <= a.y + 4 && y >= a.y - 16 ? 0 : Infinity;
            break;
        }
        if (distance < 6) return { id: drawing.id, pointIndex: null };
      }
      return null;
    },
    [chart, drawings, series, toPx],
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
      downAt.current = { x, y };
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
      const fixed = POINT_COUNT[tool];

      if (tool === "brush") {
        if (draftRef.current) return;
        painting.current = true;
        setDraft({ id: crypto.randomUUID(), tool, points: [point], color });
        return;
      }

      if (tool === "polyline") {
        const current = draftRef.current;
        if (!current) {
          setDraft({ id: crypto.randomUUID(), tool, points: [point], color });
          return;
        }
        // The second click of a double-click lands on the last point; ignore it.
        const last = toPx(current.points[current.points.length - 1]!);
        if (last && Math.hypot(last.x - x, last.y - y) < 4) return;
        setDraft({ ...current, points: [...current.points, point] });
        return;
      }

      if (fixed === 1) {
        const drawing: Drawing = { id: crypto.randomUUID(), tool, points: [point], color };
        commit([...drawings, drawing]);
        setSelected(drawing.id);
        onToolChange("cursor");
        return;
      }

      const current = draftRef.current;
      if (!current) {
        setDraft({ id: crypto.randomUUID(), tool, points: [point], color });
        setHover(point);
        return;
      }
      const points = [...current.points, point];
      if (fixed !== undefined && fixed > 0 && points.length >= fixed) {
        const finished: Drawing = { ...current, points };
        commit([...drawings, finished]);
        setDraft(null);
        setHover(null);
        setSelected(finished.id);
        onToolChange("cursor");
      } else {
        setDraft({ ...current, points });
      }
    };

    const onMove = (event: PointerEvent) => {
      const { x, y } = local(event);
      if (painting.current) {
        const point = fromPx(x, y);
        if (!point) return;
        setDraft((currentDraft) => {
          if (!currentDraft) return currentDraft;
          const last = currentDraft.points[currentDraft.points.length - 1];
          const lastPx = last ? toPx(last) : null;
          if (lastPx && Math.hypot(lastPx.x - x, lastPx.y - y) < 2) return currentDraft;
          return { ...currentDraft, points: [...currentDraft.points, point] };
        });
        event.stopPropagation();
        return;
      }
      if (draftRef.current) {
        const point = fromPx(x, y);
        if (point) setHover(point);
        event.stopPropagation();
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
      const press = downAt.current;
      downAt.current = null;
      if (painting.current) {
        painting.current = false;
        const current = draftRef.current;
        if (current && current.points.length >= 2) {
          commit([...drawings, current]);
          setSelected(current.id);
          onToolChange("cursor");
        }
        setDraft(null);
        setHover(null);
        return;
      }
      if (draftRef.current) {
        const current = draftRef.current;
        const fixed = POINT_COUNT[current.tool];
        // Press-drag-release also completes a two-point drawing.
        if (fixed === 2 && current.points.length === 1) {
          const { x, y } = local(event);
          if (press && Math.hypot(press.x - x, press.y - y) > 8) {
            const point = fromPx(x, y);
            if (point) {
              const finished: Drawing = { ...current, points: [current.points[0]!, point] };
              commit([...drawings, finished]);
              setDraft(null);
              setHover(null);
              setSelected(finished.id);
              onToolChange("cursor");
            }
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

    const onDoubleClick = (event: MouseEvent) => {
      const current = draftRef.current;
      if (!current || current.tool !== "polyline" || current.points.length < 2) return;
      event.stopPropagation();
      event.preventDefault();
      commit([...drawings, current]);
      setDraft(null);
      setHover(null);
      setSelected(current.id);
      onToolChange("cursor");
    };

    element.addEventListener("pointerdown", onDown, true);
    element.addEventListener("pointermove", onMove, true);
    element.addEventListener("dblclick", onDoubleClick, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      element.removeEventListener("pointerdown", onDown, true);
      element.removeEventListener("pointermove", onMove, true);
      element.removeEventListener("dblclick", onDoubleClick, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, [chart, tool, color, drawings, hitTest, fromPx, toPx, toLogical, commit, dates, onToolChange, storageKey, visible]);

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

  const finishPolyline = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.tool !== "polyline" || current.points.length < 2) return;
    commit([...drawings, current]);
    setDraft(null);
    setHover(null);
    setSelected(current.id);
    onToolChange("cursor");
  }, [commit, drawings, onToolChange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        setDraft(null);
        setHover(null);
        painting.current = false;
        setSelected(null);
        if (tool !== "cursor") onToolChange("cursor");
      } else if (event.key === "Enter" && draft?.tool === "polyline") {
        event.preventDefault();
        finishPolyline();
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
  }, [selected, tool, onToolChange, deleteSelected, undo, draft, finishPolyline]);

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
