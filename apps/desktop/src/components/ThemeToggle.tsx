import type { ReactElement } from "react";
import { useTheme, type ThemeMode } from "../theme";
import { Icon } from "./icons";

const OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: (props: { className?: string }) => ReactElement;
}> = [
  { value: "light", label: "Light theme", icon: Icon.Sun },
  { value: "dark", label: "Dark theme", icon: Icon.Moon },
  { value: "system", label: "Follow system theme", icon: Icon.Monitor },
];

export function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme();

  return (
    <div
      className="segmented"
      role="group"
      aria-label={`Colour theme (currently ${resolved})`}
    >
      {OPTIONS.map((option) => {
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            className={mode === option.value ? "segment-active" : ""}
            aria-pressed={mode === option.value}
            onClick={() => setMode(option.value)}
            style={{ display: "grid", placeItems: "center", padding: "4px 8px" }}
          >
            <OptionIcon className="theme-icon" />
          </button>
        );
      })}
    </div>
  );
}
