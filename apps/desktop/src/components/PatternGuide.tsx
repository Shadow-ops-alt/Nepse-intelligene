import { useMemo } from "react";
import { Badge } from "./ui";

/**
 * Visual reference for every candlestick pattern the analytics package can
 * detect. Diagrams are schematic: each candle is a normalised open/close/high/
 * low drawn in its own slot, so a two- or three-candle pattern shows exactly
 * which candles have to combine for the signal. Prices are not to scale with
 * any real series.
 */

interface CandleSpec {
  /** Normalised 0–100: open, close, high, low. */
  o: number;
  c: number;
  h: number;
  l: number;
}

interface PatternInfo {
  id: string;
  name: string;
  bias: "bullish" | "bearish" | "neutral";
  span: 1 | 2 | 3;
  /** What the candles together say, phrased as an observation. */
  description: string;
  candles: CandleSpec[];
}

const C = (o: number, c: number, h: number, l: number): CandleSpec => ({ o, c, h, l });

export const PATTERN_INFO: readonly PatternInfo[] = [
  // ----- one candle ---------------------------------------------------------
  {
    id: "doji",
    name: "Doji",
    bias: "neutral",
    span: 1,
    description:
      "Open and close are almost equal. Buyers and sellers finished the session balanced after moving price around.",
    candles: [C(50, 50.4, 62, 38)],
  },
  {
    id: "dragonfly-doji",
    name: "Dragonfly doji",
    bias: "bullish",
    span: 1,
    description:
      "Open and close sit at the high with a long lower wick. Sellers pushed price down, then buyers recovered the whole move.",
    candles: [C(50, 50.4, 51, 24)],
  },
  {
    id: "gravestone-doji",
    name: "Gravestone doji",
    bias: "bearish",
    span: 1,
    description:
      "Open and close sit at the low with a long upper wick. Buyers pushed price up, then sellers recovered the whole move.",
    candles: [C(50, 49.6, 76, 49)],
  },
  {
    id: "hammer",
    name: "Hammer",
    bias: "bullish",
    span: 1,
    description:
      "Small body near the top of the range with a long lower wick, after a decline. The session closed well above its low.",
    candles: [C(58, 63, 65, 28)],
  },
  {
    id: "hanging-man",
    name: "Hanging man",
    bias: "bearish",
    span: 1,
    description:
      "Same small-body, long-lower-wick shape, but after an advance. Selling appeared during the session even though price recovered.",
    candles: [C(58, 63, 65, 28)],
  },
  {
    id: "inverted-hammer",
    name: "Inverted hammer",
    bias: "bullish",
    span: 1,
    description:
      "Small body near the bottom of the range with a long upper wick, after a decline. Buyers tested higher prices late in the session.",
    candles: [C(40, 45, 72, 38)],
  },
  {
    id: "shooting-star",
    name: "Shooting star",
    bias: "bearish",
    span: 1,
    description:
      "Small body near the bottom of the range with a long upper wick, after an advance. Sellers rejected the session high.",
    candles: [C(40, 45, 72, 38)],
  },
  {
    id: "bullish-marubozu",
    name: "Bullish marubozu",
    bias: "bullish",
    span: 1,
    description:
      "Full bullish body with almost no wicks. The close is at the session high and buyers controlled the whole range.",
    candles: [C(26, 74, 74, 26)],
  },
  {
    id: "bearish-marubozu",
    name: "Bearish marubozu",
    bias: "bearish",
    span: 1,
    description:
      "Full bearish body with almost no wicks. The close is at the session low and sellers controlled the whole range.",
    candles: [C(74, 26, 74, 26)],
  },
  {
    id: "spinning-top",
    name: "Spinning top",
    bias: "neutral",
    span: 1,
    description:
      "Small body with wicks on both sides. The session had range but neither side held control.",
    candles: [C(46, 54, 67, 33)],
  },
  // ----- two candles --------------------------------------------------------
  {
    id: "bullish-engulfing",
    name: "Bullish engulfing",
    bias: "bullish",
    span: 2,
    description:
      "A bearish candle, then a bullish body that completely covers it: the second candle opens at or below the first close and closes above the first open.",
    candles: [C(58, 46, 60, 44), C(44, 62, 64, 42)],
  },
  {
    id: "bearish-engulfing",
    name: "Bearish engulfing",
    bias: "bearish",
    span: 2,
    description:
      "A bullish candle, then a bearish body that completely covers it: the second candle opens at or above the first close and closes below the first open.",
    candles: [C(42, 54, 56, 40), C(56, 38, 58, 36)],
  },
  {
    id: "bullish-harami",
    name: "Bullish harami",
    bias: "bullish",
    span: 2,
    description:
      "A long bearish candle, then a small bullish body fully inside it. The prior down move stalls inside the first candle's range.",
    candles: [C(62, 38, 64, 36), C(46, 52, 54, 44)],
  },
  {
    id: "bearish-harami",
    name: "Bearish harami",
    bias: "bearish",
    span: 2,
    description:
      "A long bullish candle, then a small bearish body fully inside it. The prior up move stalls inside the first candle's range.",
    candles: [C(38, 62, 64, 36), C(54, 48, 56, 46)],
  },
  {
    id: "piercing-line",
    name: "Piercing line",
    bias: "bullish",
    span: 2,
    description:
      "A long bearish candle, then a bullish candle that opens below its close and closes above the midpoint of the first body, but below its open.",
    candles: [C(64, 36, 66, 34), C(34, 54, 56, 32)],
  },
  {
    id: "dark-cloud-cover",
    name: "Dark cloud cover",
    bias: "bearish",
    span: 2,
    description:
      "A long bullish candle, then a bearish candle that opens above its close and closes below the midpoint of the first body, but above its open.",
    candles: [C(36, 64, 66, 34), C(66, 46, 68, 44)],
  },
  {
    id: "tweezer-bottom",
    name: "Tweezer bottom",
    bias: "bullish",
    span: 2,
    description:
      "Two sessions reject the same low, the first bearish and the second bullish. Sellers could not push through a level that buyers then defended.",
    candles: [C(62, 50, 63, 40), C(48, 60, 62, 40)],
  },
  {
    id: "tweezer-top",
    name: "Tweezer top",
    bias: "bearish",
    span: 2,
    description:
      "Two sessions reject the same high, the first bullish and the second bearish. Buyers could not push through a level that sellers then defended.",
    candles: [C(38, 50, 60, 37), C(52, 40, 60, 38)],
  },
  // ----- three candles ------------------------------------------------------
  {
    id: "morning-star",
    name: "Morning star",
    bias: "bullish",
    span: 3,
    description:
      "A long bearish candle, a small indecision candle, then a long bullish candle that closes above the midpoint of the first body.",
    candles: [C(70, 40, 72, 38), C(42, 40, 46, 34), C(40, 58, 60, 38)],
  },
  {
    id: "evening-star",
    name: "Evening star",
    bias: "bearish",
    span: 3,
    description:
      "A long bullish candle, a small indecision candle, then a long bearish candle that closes below the midpoint of the first body.",
    candles: [C(30, 60, 62, 28), C(58, 60, 66, 54), C(60, 42, 62, 40)],
  },
  {
    id: "three-inside-up",
    name: "Three inside up",
    bias: "bullish",
    span: 3,
    description:
      "A long bearish candle, a small bullish body inside it (a bullish harami), then a bullish candle that closes above the first candle's open.",
    candles: [C(70, 40, 72, 38), C(44, 48, 50, 42), C(50, 72, 74, 48)],
  },
  {
    id: "three-inside-down",
    name: "Three inside down",
    bias: "bearish",
    span: 3,
    description:
      "A long bullish candle, a small bearish body inside it (a bearish harami), then a bearish candle that closes below the first candle's open.",
    candles: [C(30, 60, 62, 28), C(56, 52, 58, 50), C(50, 28, 52, 26)],
  },
  {
    id: "three-outside-up",
    name: "Three outside up",
    bias: "bullish",
    span: 3,
    description:
      "A bearish candle, a bullish candle that engulfs it, then a bullish candle that closes above the engulfing candle's close.",
    candles: [C(60, 48, 62, 46), C(46, 64, 66, 44), C(64, 74, 76, 62)],
  },
  {
    id: "three-outside-down",
    name: "Three outside down",
    bias: "bearish",
    span: 3,
    description:
      "A bullish candle, a bearish candle that engulfs it, then a bearish candle that closes below the engulfing candle's close.",
    candles: [C(40, 52, 54, 38), C(54, 36, 56, 34), C(36, 26, 38, 24)],
  },
  {
    id: "three-white-soldiers",
    name: "Three white soldiers",
    bias: "bullish",
    span: 3,
    description:
      "Three consecutive long bullish candles, each closing higher than the last, each opening inside the previous body and closing near its high.",
    candles: [C(30, 50, 52, 28), C(40, 62, 64, 38), C(52, 74, 76, 50)],
  },
  {
    id: "three-black-crows",
    name: "Three black crows",
    bias: "bearish",
    span: 3,
    description:
      "Three consecutive long bearish candles, each closing lower than the last, each opening inside the previous body and closing near its low.",
    candles: [C(70, 50, 72, 48), C(60, 38, 62, 36), C(48, 26, 50, 24)],
  },
];

const SPAN_LABEL: Record<1 | 2 | 3, string> = {
  1: "One candle",
  2: "Two candles together",
  3: "Three candles together",
};

function CandleDiagram({ candles }: { candles: CandleSpec[] }) {
  const width = 136;
  const height = 78;
  const slot = width / 3;
  const offset = ((3 - candles.length) / 2) * slot;
  const y = (price: number) => height - 8 - (price / 100) * (height - 16);
  return (
    <svg
      className="pattern-diagram"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-hidden="true"
    >
      {candles.map((candle, index) => {
        const bullish = candle.c >= candle.o;
        const colour = bullish ? "var(--up)" : "var(--down)";
        const x = offset + slot * (index + 0.5);
        const top = y(Math.max(candle.o, candle.c));
        const bottom = y(Math.min(candle.o, candle.c));
        return (
          <g key={index}>
            <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={colour} strokeWidth={1.5} />
            <rect
              x={x - 7}
              y={top}
              width={14}
              height={Math.max(1.5, bottom - top)}
              fill={colour}
              rx={1}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Guide of every pattern the detector knows, grouped by candle count. */
export function PatternGuide({ hits = [] }: { hits?: ReadonlyArray<{ id: string }> }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const hit of hits) map.set(hit.id, (map.get(hit.id) ?? 0) + 1);
    return map;
  }, [hits]);

  return (
    <details className="pattern-guide-details" open>
      <summary>
        Pattern guide · what one, two and three candles form{" "}
        <span className="muted tiny">({PATTERN_INFO.length} patterns)</span>
      </summary>
      <div className="pattern-guide">
        {([1, 2, 3] as const).map((span) => (
          <section key={span}>
            <h4 className="chart-panel-title">{SPAN_LABEL[span]}</h4>
            <div className="pattern-guide-grid">
              {PATTERN_INFO.filter((info) => info.span === span).map((info) => {
                const seen = counts.get(info.id) ?? 0;
                return (
                  <article
                    key={info.id}
                    className={`pattern-guide-card${seen > 0 ? " pattern-guide-card-detected" : ""}`}
                  >
                    <CandleDiagram candles={info.candles} />
                    <div className="pattern-guide-copy">
                      <div className="pattern-guide-name">
                        {info.name}
                        <Badge
                          tone={
                            info.bias === "bullish"
                              ? "good"
                              : info.bias === "bearish"
                                ? "bad"
                                : "neutral"
                          }
                        >
                          {info.bias}
                        </Badge>
                        {seen > 0 && <span className="muted tiny">seen ×{seen}</span>}
                      </div>
                      <p className="muted tiny">{info.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <p className="muted tiny">
        Detected geometrically from each session’s open, high, low and close plus the prior
        six-session trend. Diagrams are schematic, not to scale. Patterns describe what
        already happened and are not forecasts.
      </p>
    </details>
  );
}
