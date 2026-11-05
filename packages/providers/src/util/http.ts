import { ProviderUnavailableError, ProviderResponseError } from "@stock/core";

export interface FetchJsonOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  providerId: string;
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: FetchJsonOptions,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("request timed out")),
    options.timeoutMs ?? 30_000,
  );

  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();

    if (!response.ok) {
      throw new ProviderUnavailableError(
        options.providerId,
        `HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new ProviderResponseError(
        options.providerId,
        `expected JSON from ${url}, received: ${text.slice(0, 200)}`,
        error,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
