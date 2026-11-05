import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { Company } from "../types";
import { Icon } from "./icons";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: (props: { className?: string }) => ReactElement;
  run: () => void;
}

interface Entry {
  key: string;
  group: "Go to" | "Companies" | "Actions";
  icon: (props: { className?: string }) => ReactElement;
  primary: string;
  secondary: string;
  meta?: string;
  run: () => void;
}

/**
 * Keyboard-first command palette (Ctrl/⌘ K or "/"). Searches the locally
 * stored company master and app commands; it never calls a network source.
 */
export function CommandPalette({
  open,
  onClose,
  companies,
  pages,
  actions,
  onOpenSymbol,
}: {
  open: boolean;
  onClose: () => void;
  companies: Company[];
  pages: PaletteCommand[];
  actions: PaletteCommand[];
  onOpenSymbol: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const needle = query.trim().toUpperCase();
    const matchCommand = (command: PaletteCommand) =>
      needle === "" || command.label.toUpperCase().includes(needle);

    const pageEntries: Entry[] = pages.filter(matchCommand).map((command) => ({
      key: `page:${command.id}`,
      group: "Go to",
      icon: command.icon,
      primary: command.label,
      secondary: command.hint ?? "",
      run: command.run,
    }));

    let companyEntries: Entry[] = [];
    if (needle !== "") {
      const scored = companies
        .map((company) => {
          const symbol = company.symbol.toUpperCase();
          const name = company.name.toUpperCase();
          let score = -1;
          if (symbol === needle) score = 0;
          else if (symbol.startsWith(needle)) score = 1;
          else if (symbol.includes(needle)) score = 2;
          else if (name.startsWith(needle)) score = 3;
          else if (name.includes(needle)) score = 4;
          return { company, score };
        })
        .filter((item) => item.score >= 0)
        .sort(
          (a, b) =>
            a.score - b.score ||
            (a.company.status === b.company.status
              ? a.company.symbol.localeCompare(b.company.symbol)
              : a.company.status === "active"
                ? -1
                : 1),
        )
        .slice(0, 12);
      companyEntries = scored.map(({ company }) => ({
        key: `company:${company.symbol}`,
        group: "Companies",
        icon: Icon.Companies,
        primary: company.symbol,
        secondary: company.name,
        meta: `${company.instrumentType} · ${company.sector}${
          company.status !== "active" ? ` · ${company.status}` : ""
        }`,
        run: () => onOpenSymbol(company.symbol),
      }));
    }

    const actionEntries: Entry[] = actions.filter(matchCommand).map((command) => ({
      key: `action:${command.id}`,
      group: "Actions",
      icon: command.icon,
      primary: command.label,
      secondary: command.hint ?? "",
      run: command.run,
    }));

    return needle === ""
      ? [...pageEntries, ...actionEntries]
      : [...companyEntries, ...pageEntries, ...actionEntries];
  }, [query, companies, pages, actions, onOpenSymbol]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const node = list.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    entry.run();
    onClose();
  };

  let lastGroup: Entry["group"] | null = null;

  return (
    <div
      className="palette-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="palette-input-row">
          <Icon.Search />
          <input
            ref={input}
            className="palette-input"
            placeholder="Jump to a symbol, company, page or action…"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={
              entries[active] ? `palette-${active}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, entries.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(entries[active]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {entries.length === 0 ? (
            <div className="palette-empty">
              {companies.length === 0
                ? "No company master imported yet."
                : `Nothing matches “${query.trim()}”.`}
            </div>
          ) : (
            entries.map((entry, index) => {
              const header =
                entry.group !== lastGroup ? (
                  <div className="palette-group" key={`g-${entry.group}`}>
                    {entry.group}
                  </div>
                ) : null;
              lastGroup = entry.group;
              const EntryIcon = entry.icon;
              return [
                header,
                <button
                  key={entry.key}
                  id={`palette-${index}`}
                  data-index={index}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`palette-item ${
                    index === active ? "palette-item-active" : ""
                  }`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(entry)}
                >
                  <EntryIcon />
                  <strong>{entry.primary}</strong>
                  <span className="muted nowrap" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.secondary}
                  </span>
                  <span className="subtle tiny nowrap">{entry.meta ?? ""}</span>
                </button>,
              ];
            })
          )}
        </div>
        <div className="palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Ctrl</kbd> <kbd>K</kbd> toggle
          </span>
          <span style={{ marginLeft: "auto" }}>
            Searches the local company master only
          </span>
        </div>
      </div>
    </div>
  );
}
