export function toNumber(
  value: unknown,
  fallback?: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned === "" || cleaned === "-" || cleaned === "—") {
      if (fallback !== undefined) return fallback;
      throw new Error(`Cannot parse number from "${value}"`);
    }
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Cannot parse number from "${String(value)}"`);
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  try {
    return toNumber(value);
  } catch {
    return undefined;
  }
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}
