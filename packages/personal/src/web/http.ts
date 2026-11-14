import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Small, polite HTTP client for public, server-rendered pages.
 *
 * Every response is written verbatim to a content-addressed snapshot before it
 * is parsed, so an import can always be traced back to the exact bytes that
 * produced it. Requests are serialised per host with a minimum interval,
 * retried with exponential backoff, and cached for a configurable window.
 *
 * This module deliberately does not bypass authentication, paywalls, or bot
 * challenges. If a page cannot be read as an anonymous visitor, the dataset is
 * reported unavailable.
 */

export interface WebClientOptions {
  outputDir: string;
  /** Default minimum delay between requests to the same host. */
  minIntervalMs?: number;
  /** Per-host overrides, e.g. { "merolagani.com": 1500 }. */
  hostIntervalsMs?: Record<string, number>;
  timeoutMs?: number;
  attempts?: number;
  userAgent?: string;
  /** Cache window for identical URLs. Default 60 minutes. */
  maxAgeMinutes?: number;
  now?: () => Date;
}

export interface FetchResult {
  url: string;
  status: number;
  text: string;
  fetchedAt: string;
  sha256: string;
  snapshotPath: string;
  bytes: number;
  cached: boolean;
  contentType: string | null;
}

export interface FetchManifestEntry {
  url: string;
  status: number;
  fetchedAt: string;
  sha256: string;
  snapshotPath: string;
  bytes: number;
  contentType: string | null;
  etag?: string | null;
  lastModified?: string | null;
}

interface Manifest {
  schemaVersion: number;
  entries: Record<string, FetchManifestEntry>;
}

const DEFAULT_USER_AGENT =
  "NEPSE-Terminal-Free-Edition/0.1 (+local research prototype; respects robots.txt)";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "page";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class WebClient {
  private readonly outputDir: string;
  private readonly manifestPath: string;
  private readonly minIntervalMs: number;
  private readonly hostIntervalsMs: Record<string, number>;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly userAgent: string;
  private readonly maxAgeMinutes: number;
  private readonly now: () => Date;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly manifest: Manifest;
  /**
   * In-memory cookie jar. Some public pages issue a short-lived session cookie
   * before their AJAX tabs will answer. The jar is deliberately per-client and
   * never persisted: a new acquisition run starts as a fresh anonymous visitor.
   */
  private readonly cookies = new Map<string, Map<string, string>>();

  constructor(options: WebClientOptions) {
    this.outputDir = options.outputDir;
    this.manifestPath = join(
      options.outputDir,
      "source",
      "web",
      "manifest.json",
    );
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 1_000);
    this.hostIntervalsMs = options.hostIntervalsMs ?? {};
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 30_000);
    this.attempts = Math.max(1, options.attempts ?? 3);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.maxAgeMinutes = Math.max(0, options.maxAgeMinutes ?? 60);
    this.now = options.now ?? (() => new Date());
    this.manifest = this.readManifest();
  }

  private readManifest(): Manifest {
    if (!existsSync(this.manifestPath)) {
      return { schemaVersion: 1, entries: {} };
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.manifestPath, "utf8"),
      ) as Manifest;
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.entries &&
        typeof parsed.entries === "object"
      ) {
        return parsed;
      }
    } catch {
      // A damaged manifest is not fatal: snapshots remain on disk.
    }
    return { schemaVersion: 1, entries: {} };
  }

  private writeManifest(): void {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    writeFileSync(
      this.manifestPath,
      `${JSON.stringify(this.manifest, null, 2)}\n`,
      "utf8",
    );
  }

  private snapshotDir(url: string): string {
    return join(
      this.outputDir,
      "source",
      "web",
      safeName(hostOf(url)),
    );
  }

  private snapshotPath(url: string, digest: string): string {
    return join(this.snapshotDir(url), `${digest}.snapshot`);
  }

  private async throttle(host: string): Promise<void> {
    const interval =
      this.hostIntervalsMs[host] ?? this.minIntervalMs;
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + interval - this.now().getTime();
    if (wait > 0) await delay(wait);
    this.lastRequestAt.set(host, this.now().getTime());
  }

  private cached(key: string): FetchResult | null {
    if (this.maxAgeMinutes <= 0) return null;
    const entry = this.manifest.entries[key];
    if (!entry) return null;
    const fetchedAt = new Date(entry.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime())) return null;
    const ageMs = this.now().getTime() - fetchedAt.getTime();
    if (ageMs < 0 || ageMs > this.maxAgeMinutes * 60_000) return null;
    if (!existsSync(entry.snapshotPath)) return null;
    try {
      const text = readFileSync(entry.snapshotPath, "utf8");
      if (sha256(text) !== entry.sha256) return null;
      return {
        url: entry.url,
        status: entry.status,
        text,
        fetchedAt: entry.fetchedAt,
        sha256: entry.sha256,
        snapshotPath: entry.snapshotPath,
        bytes: entry.bytes,
        cached: true,
        contentType: entry.contentType,
      };
    } catch {
      return null;
    }
  }

  private captureCookies(response: Response, host: string): void {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    if (setCookies.length === 0) return;
    const jar = this.cookies.get(host) ?? new Map<string, string>();
    for (const raw of setCookies) {
      const pair = raw.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name) continue;
      if (value === "" || /max-age=0/i.test(raw)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }
    if (jar.size > 0) {
      this.cookies.set(host, jar);
    } else {
      this.cookies.delete(host);
    }
  }

  private cookieHeader(host: string): string | undefined {
    const jar = this.cookies.get(host);
    if (!jar || jar.size === 0) return undefined;
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  /**
   * `headers` is used for endpoints that only return JSON when requested with
   * `X-Requested-With: XMLHttpRequest`. The cache key includes the header set so
   * an HTML fallback can never be mistaken for an AJAX payload.
   */
  async getText(
    url: string,
    headers: Record<string, string> = {},
    options: { bypassCache?: boolean } = {},
  ): Promise<FetchResult> {
    const extraKeys = Object.keys(headers).sort();
    const cacheKey =
      extraKeys.length === 0
        ? url
        : `${url}#${extraKeys.map((key) => `${key}=${headers[key]}`).join("&")}`;
    // A cached page cannot be used to start a session: its embedded CSRF
    // token has no matching session cookie in this process.
    const hit = options.bypassCache ? null : this.cached(cacheKey);
    if (hit) return hit;

    const host = hostOf(url);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      await this.throttle(host);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "follow",
          headers: {
            "user-agent": this.userAgent,
            accept:
              "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.9,ne;q=0.8",
            ...(this.cookieHeader(host)
              ? { cookie: this.cookieHeader(host)! }
              : {}),
            ...headers,
          },
        });
        this.captureCookies(response, host);
        const retryable =
          response.status === 429 ||
          response.status === 408 ||
          response.status >= 500;
        if (!response.ok) {
          const snippet = (await response.text()).slice(0, 300);
          if (retryable && attempt < this.attempts - 1) {
            const retryAfter = Number(response.headers.get("retry-after"));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1_000
              : 750 * 2 ** attempt;
            await delay(waitMs);
            continue;
          }
          throw new Error(
            `${url} returned HTTP ${response.status}: ${snippet.replace(/\s+/g, " ").trim()}`,
          );
        }
        const text = await response.text();
        const digest = sha256(text);
        const fetchedAt = this.now().toISOString();
        const snapshotPath = this.snapshotPath(url, digest);
        mkdirSync(dirname(snapshotPath), { recursive: true });
        if (!existsSync(snapshotPath)) {
          writeFileSync(snapshotPath, text, "utf8");
        }
        const entry: FetchManifestEntry = {
          url,
          status: response.status,
          fetchedAt,
          sha256: digest,
          snapshotPath,
          bytes: Buffer.byteLength(text),
          contentType: response.headers.get("content-type"),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        };
        this.manifest.entries[cacheKey] = entry;
        this.writeManifest();
        return {
          url,
          status: response.status,
          text,
          fetchedAt,
          sha256: digest,
          snapshotPath,
          bytes: entry.bytes,
          cached: false,
          contentType: entry.contentType,
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts - 1) {
          await delay(750 * 2 ** attempt);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`could not fetch ${url}`);
  }

  /**
   * Submit an ASP.NET WebForms postback. Used for paginated server-rendered
   * tables (e.g. the Merolagani floorsheet) that do not expose a GET pager.
   * Responses are snapshotted exactly like GET responses; nothing is cached.
   */
  async postForm(
    url: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<FetchResult> {
    const host = hostOf(url);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      await this.throttle(host);
      try {
        const body = new URLSearchParams(fields).toString();
        const response = await fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "follow",
          headers: {
            "user-agent": this.userAgent,
            accept:
              "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.9,ne;q=0.8",
            "content-type": "application/x-www-form-urlencoded",
            ...(this.cookieHeader(host)
              ? { cookie: this.cookieHeader(host)! }
              : {}),
            ...headers,
          },
          body,
        });
        this.captureCookies(response, host);
        const retryable =
          response.status === 429 ||
          response.status === 408 ||
          response.status >= 500;
        if (!response.ok) {
          const snippet = (await response.text()).slice(0, 300);
          if (retryable && attempt < this.attempts - 1) {
            await delay(750 * 2 ** attempt);
            continue;
          }
          throw new Error(
            `${url} returned HTTP ${response.status}: ${snippet.replace(/\s+/g, " ").trim()}`,
          );
        }
        const text = await response.text();
        const digest = sha256(text);
        const fetchedAt = this.now().toISOString();
        const snapshotPath = this.snapshotPath(url, digest);
        mkdirSync(dirname(snapshotPath), { recursive: true });
        if (!existsSync(snapshotPath)) {
          writeFileSync(snapshotPath, text, "utf8");
        }
        return {
          url,
          status: response.status,
          text,
          fetchedAt,
          sha256: digest,
          snapshotPath,
          bytes: Buffer.byteLength(text),
          cached: false,
          contentType: response.headers.get("content-type"),
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts - 1) {
          await delay(750 * 2 ** attempt);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`could not post to ${url}`);
  }

  get snapshotRoot(): string {
    return join(this.outputDir, "source", "web");
  }
}
