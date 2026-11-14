/**
 * Sector-name matching between the three places a sector name appears:
 * the company master (e.g. "Commercial Bank", "Hotel & Tourism"), the index
 * list ("Banking SubIndex", "Hotels And Tourism") and the source-published
 * sector performance table ("Commercial Banks", "Hotels and Tourism").
 *
 * Matching is by normalised name only. Nothing is matched by guesswork: a
 * name that does not normalise to the same key stays unmatched and is shown
 * as such.
 */

const STOP_WORDS = new Set(["index", "subindex", "sub", "sector", "sectors"]);

/** Explicit synonyms, applied after normalisation. */
const ALIASES: Record<string, string> = {
  banking: "commercial bank",
  "commercial banking": "commercial bank",
  "hydro power": "hydropower",
  "hotel tourism": "hotel and tourism",
  "manufacturing processing": "manufacturing and processing",
  "nonlife insurance": "non life insurance",
  "micro finance": "microfinance",
};

function singular(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss")
    ? token.slice(0, -1)
    : token;
}

export function sectorKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/sub[\s-]*index/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "" && !STOP_WORDS.has(token))
    .map(singular);
  const key = tokens.join(" ");
  return ALIASES[key] ?? key;
}

/** Index candidates by normalised name; the first candidate wins a tie. */
export function indexByKey<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = sectorKey(nameOf(item));
    if (key && !map.has(key)) map.set(key, item);
  }
  return map;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function sumOrNull(values: ReadonlyArray<number | null | undefined>): {
  total: number | null;
  count: number;
} {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return { total: count > 0 ? total : null, count };
}
