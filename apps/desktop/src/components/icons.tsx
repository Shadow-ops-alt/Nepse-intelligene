import type { ReactElement, SVGProps } from "react";

/**
 * Small inline stroke icon set. Inline SVG keeps the desktop build fully
 * offline (no icon font or CDN) and inherits `currentColor` from the theme.
 */
type IconProps = SVGProps<SVGSVGElement>;

function base(children: ReactElement | ReactElement[], props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Logo: (p: IconProps) =>
    base(
      [
        <path key="a" d="M4 17 9 11l4 4 7-9" />,
        <path key="b" d="M15 6h5v5" />,
      ],
      { strokeWidth: 2.2, ...p },
    ),
  Market: (p: IconProps) =>
    base(
      [
        <path key="a" d="M3 3v18h18" />,
        <path key="b" d="m7 15 4-4 3 3 5-6" />,
      ],
      p,
    ),
  Companies: (p: IconProps) =>
    base(
      [
        <rect key="a" x="4" y="3" width="10" height="18" rx="1.5" />,
        <path key="b" d="M14 9h5a1 1 0 0 1 1 1v11h-6" />,
        <path key="c" d="M8 7h2M8 11h2M8 15h2" />,
      ],
      p,
    ),
  Screener: (p: IconProps) =>
    base([<path key="a" d="M3 5h18l-7 8v6l-4 2v-8z" />], p),
  Portfolio: (p: IconProps) =>
    base(
      [
        <rect key="a" x="3" y="7" width="18" height="13" rx="2" />,
        <path key="b" d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
        <path key="c" d="M3 12h18" />,
      ],
      p,
    ),
  Watchlist: (p: IconProps) =>
    base(
      [
        <path
          key="a"
          d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"
        />,
      ],
      p,
    ),
  StarFilled: (p: IconProps) =>
    base(
      [
        <path
          key="a"
          fill="currentColor"
          d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"
        />,
      ],
      p,
    ),
  Data: (p: IconProps) =>
    base(
      [
        <ellipse key="a" cx="12" cy="5" rx="8" ry="3" />,
        <path key="b" d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />,
        <path key="c" d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />,
      ],
      p,
    ),
  Settings: (p: IconProps) =>
    base(
      [
        <circle key="a" cx="12" cy="12" r="3" />,
        <path
          key="b"
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
        />,
      ],
      p,
    ),
  Search: (p: IconProps) =>
    base(
      [
        <circle key="a" cx="11" cy="11" r="7" />,
        <path key="b" d="m20 20-3.5-3.5" />,
      ],
      p,
    ),
  ArrowUp: (p: IconProps) =>
    base([<path key="a" d="M12 19V5M5 12l7-7 7 7" />], { strokeWidth: 2.4, ...p }),
  ArrowDown: (p: IconProps) =>
    base([<path key="a" d="M12 5v14M19 12l-7 7-7-7" />], {
      strokeWidth: 2.4,
      ...p,
    }),
  Minus: (p: IconProps) =>
    base([<path key="a" d="M5 12h14" />], { strokeWidth: 2.4, ...p }),
  ChevronUp: (p: IconProps) =>
    base([<path key="a" d="m6 15 6-6 6 6" />], { strokeWidth: 2.4, ...p }),
  ChevronDown: (p: IconProps) =>
    base([<path key="a" d="m6 9 6 6 6-6" />], { strokeWidth: 2.4, ...p }),
  Sort: (p: IconProps) =>
    base([<path key="a" d="m7 9 5-5 5 5M7 15l5 5 5-5" />], {
      strokeWidth: 2.2,
      ...p,
    }),
  PanelLeft: (p: IconProps) =>
    base(
      [
        <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
        <path key="b" d="M9 4v16" />,
      ],
      p,
    ),
  Clock: (p: IconProps) =>
    base(
      [
        <circle key="a" cx="12" cy="12" r="9" />,
        <path key="b" d="M12 7v5l3 2" />,
      ],
      p,
    ),
  Alert: (p: IconProps) =>
    base(
      [
        <path
          key="a"
          d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
        />,
        <path key="b" d="M12 9v4M12 17h.01" />,
      ],
      p,
    ),
  Download: (p: IconProps) =>
    base(
      [
        <path key="a" d="M12 3v12M7 10l5 5 5-5" />,
        <path key="b" d="M5 21h14" />,
      ],
      p,
    ),
  Sigma: (p: IconProps) =>
    base([<path key="a" d="M18 4H6l6 8-6 8h12" />], p),
  Candles: (p: IconProps) =>
    base(
      [
        <path key="a" d="M7 3v4M7 15v6M17 3v6M17 17v4" />,
        <rect key="b" x="4.5" y="7" width="5" height="8" rx="1" />,
        <rect key="c" x="14.5" y="9" width="5" height="8" rx="1" />,
      ],
      p,
    ),
  Command: (p: IconProps) =>
    base(
      [
        <path
          key="a"
          d="M9 6v12M15 6v12M6 9h12M6 15h12"
        />,
      ],
      p,
    ),
  Sun: (p: IconProps) =>
    base(
      [
        <circle key="a" cx="12" cy="12" r="4" />,
        <path
          key="b"
          d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        />,
      ],
      p,
    ),
  Moon: (p: IconProps) =>
    base([<path key="a" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />], p),
  Monitor: (p: IconProps) =>
    base(
      [
        <rect key="a" x="3" y="4" width="18" height="12" rx="2" />,
        <path key="b" d="M8 20h8M12 16v4" />,
      ],
      p,
    ),
};

export type IconName = keyof typeof Icon;
