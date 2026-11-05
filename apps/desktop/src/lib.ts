/** Shared helpers for session dates and data age (Nepal Time, UTC+05:45). */

const NPT_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/** Trading date in Nepal Time for a stored UTC timestamp. */
export function nptDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value.slice(0, 10);
  return new Date(ms + NPT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole calendar days between the session date and today (Nepal Time). */
export function sessionAgeDays(value: string | null | undefined): number | null {
  const session = nptDate(value);
  if (!session) return null;
  const today = new Date(Date.now() + NPT_OFFSET_MS).toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${session}T00:00:00Z`)) /
      86_400_000,
  );
}

export function describeAge(days: number | null): string {
  if (days === null) return "unknown age";
  if (days <= 0) return "today";
  if (days === 1) return "1 day old";
  return `${days} days old`;
}

/**
 * NEPSE trades Sunday–Thursday, so a Thursday close is still the latest
 * session on Saturday. Anything older than four calendar days most likely
 * means the local archive needs a manual update.
 */
export const UPDATE_REMINDER_DAYS = 4;

export const UPDATE_COMMAND =
  'DATA_EDITION=free pnpm personal:update --data-dir "$HOME/.config/NEPSE Terminal/data" --db "$HOME/.config/NEPSE Terminal/personal.db"';

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage may be unavailable; fall back silently.
  }
  return fallback;
}

export function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Best-effort persistence.
  }
}
