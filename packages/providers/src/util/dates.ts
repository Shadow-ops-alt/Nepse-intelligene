const NEPAL_OFFSET = "+05:45";

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/**
 * NEPSE frequently returns local timestamps without a timezone, e.g.
 * "2026-11-04 11:10:00.785032". Treat those as Asia/Kathmandu (+05:45).
 */
export function normalizeNepalDateTime(value: string): string {
  const trimmed = value.trim();

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed).toISOString();
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/,
  );
  if (match) {
    const [, year, month, day, hour, minute, second, fraction] = match;
    const millis = (fraction ?? "").padEnd(3, "0").slice(0, 3);
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis || "000"}${NEPAL_OFFSET}`;
    return new Date(iso).toISOString();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date/time: "${value}"`);
  }
  return parsed.toISOString();
}

export function normalizeTradingDate(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid trading date: "${value}"`);
  }
  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
}

export function nepalToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function eachTradingDay(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days: string[] = [];
  for (
    let cursor = start;
    cursor.getTime() <= end.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const day = cursor.getUTCDay();
    // NEPSE trades Sunday through Thursday.
    if (day >= 0 && day <= 4) {
      days.push(cursor.toISOString().slice(0, 10));
    }
  }
  return days;
}
