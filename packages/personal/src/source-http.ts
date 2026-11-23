import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { x as extractTar } from "tar";

/**
 * Fetch the public archive over HTTPS instead of `git clone`.
 *
 * The shipped desktop app cannot assume that the client has git installed, so
 * the automatic updater downloads GitHub's tarball for an exact commit. The
 * archive is still MIT-licensed code and data, and its figures are still
 * UNVERIFIED scraped prices; this module only changes the transport.
 */

const REQUIRED_SOURCE_FILE = "data/reference/nepse-symbols.csv";
const GITHUB_API = "https://api.github.com";
const GITHUB_CODELOAD = "https://codeload.github.com";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export interface HttpSourceOptions {
  /** Checkout directory that must end up containing data/reference/nepse-symbols.csv. */
  repoDir: string;
  /** Cache directory holding last-fetch.json and the downloaded tarball. */
  cacheDir: string;
  sourceUrl: string;
  ref?: string;
  force?: boolean;
  /** Reuse a checkout younger than this without asking GitHub. Default 30. */
  maxAgeMinutes?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
  /** Receives human-readable download progress lines. */
  onProgress?: (message: string) => void;
}

export interface HttpSourceResult {
  repoDir: string;
  commit: string;
  retrievedAt: string;
  cached: boolean;
  /** Set when a remote check failed and an older checkout was reused. */
  warning?: string;
}

interface FetchMarker {
  checkedAt?: string;
  commit?: string;
  sourceUrl?: string;
  ref?: string;
  transport?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse github.com and git@github.com remotes. Anything else is not supported. */
export function parseGitHubRepo(sourceUrl: string): GitHubRepo | null {
  const trimmed = sourceUrl.trim();
  const ssh = /^git@github\.com:([^/]+)\/(.+)$/i.exec(trimmed);
  if (ssh) {
    return {
      owner: ssh[1]!,
      repo: ssh[2]!.replace(/\.git$/i, ""),
    };
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0]!,
      repo: parts[1]!.replace(/\.git$/i, ""),
    };
  } catch {
    return null;
  }
}

function readMarker(path: string): FetchMarker | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FetchMarker;
  } catch {
    return null;
  }
}

function writeMarker(path: string, marker: FetchMarker): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

function checkoutLooksUsable(repoDir: string): boolean {
  return existsSync(join(repoDir, REQUIRED_SOURCE_FILE));
}

async function fetchCommitSha(
  repo: GitHubRepo,
  ref: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(
    `${GITHUB_API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${encodeURIComponent(ref)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "nepse-terminal",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub commit check returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { sha?: unknown };
  if (typeof body.sha !== "string" || body.sha.length === 0) {
    throw new Error("GitHub commit check returned no commit sha");
  }
  return body.sha;
}

async function downloadTarball(
  repo: GitHubRepo,
  commit: string,
  target: string,
  fetchImpl: typeof fetch,
  onProgress?: (message: string) => void,
): Promise<void> {
  const response = await fetchImpl(
    `${GITHUB_CODELOAD}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tar.gz/${encodeURIComponent(commit)}`,
    {
      headers: { "user-agent": "nepse-terminal" },
      redirect: "follow",
      // The public archive is about 10 MB. A slow link can need several
      // minutes, so this is a generous total timeout rather than an idle one.
      signal: AbortSignal.timeout(900_000),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Archive download returned HTTP ${response.status}`);
  }
  const lengthHeader = Number(response.headers.get("content-length") ?? "");
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : null;
  let received = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      received += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastReport >= 1_000) {
        lastReport = now;
        const done = (received / 1024 / 1024).toFixed(1);
        onProgress(
          total
            ? `downloading the archive: ${done} of ${(total / 1024 / 1024).toFixed(1)} MB`
            : `downloading the archive: ${done} MB`,
        );
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    counter,
    createWriteStream(target),
  );
}

/**
 * Download the archive for `ref` and swap it into `repoDir`.
 *
 * A failed download never touches the existing checkout: the tarball is
 * extracted into a temporary directory, validated, and only then renamed.
 * If the remote cannot be reached but a previous checkout exists, the caller
 * gets the previous checkout plus a warning instead of a dead app.
 */
export async function prepareRepoOverHttp(
  options: HttpSourceOptions,
): Promise<HttpSourceResult> {
  const sourceUrl = options.sourceUrl;
  const ref = options.ref ?? "main";
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const repoDir = resolve(options.repoDir);
  const cacheDir = resolve(options.cacheDir);
  const markerPath = join(cacheDir, "last-fetch.json");
  const maxAgeMs = Math.max(0, options.maxAgeMinutes ?? 30) * 60_000;
  const repo = parseGitHubRepo(sourceUrl);
  if (!repo) {
    throw new Error(
      `the HTTP archive transport only supports github.com remotes, not ${sourceUrl}`,
    );
  }

  const previous = readMarker(markerPath);
  const previousAge = previous?.checkedAt
    ? now.getTime() - new Date(previous.checkedAt).getTime()
    : Infinity;

  // A recent successful check is reused without any network call.
  if (
    !options.force &&
    previous &&
    previous.sourceUrl === sourceUrl &&
    previous.ref === ref &&
    previous.commit &&
    previousAge >= 0 &&
    previousAge <= maxAgeMs &&
    checkoutLooksUsable(repoDir)
  ) {
    return {
      repoDir,
      commit: previous.commit,
      retrievedAt: previous.checkedAt ?? now.toISOString(),
      cached: true,
    };
  }

  let commit: string;
  try {
    commit = await fetchCommitSha(repo, ref, fetchImpl);
  } catch (error) {
    if (checkoutLooksUsable(repoDir)) {
      return {
        repoDir,
        commit: previous?.commit ?? "unknown",
        retrievedAt: previous?.checkedAt ?? now.toISOString(),
        cached: true,
        warning: `Could not check ${sourceUrl} (${message(error)}); using the cached archive from ${previous?.checkedAt ?? "an earlier run"}.`,
      };
    }
    throw error;
  }

  if (
    !options.force &&
    previous?.commit === commit &&
    checkoutLooksUsable(repoDir)
  ) {
    writeMarker(markerPath, {
      ...previous,
      checkedAt: now.toISOString(),
      sourceUrl,
      ref,
      transport: "http",
    });
    return {
      repoDir,
      commit,
      retrievedAt: now.toISOString(),
      cached: true,
    };
  }

  const incoming = `${repoDir}.incoming-${process.pid}-${Date.now().toString(36)}`;
  const tarball = join(cacheDir, `archive-${commit.slice(0, 12)}.tar.gz`);
  mkdirSync(cacheDir, { recursive: true });
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { recursive: true });

  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await downloadTarball(repo, commit, tarball, fetchImpl, options.onProgress);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        rmSync(tarball, { force: true });
        if (attempt === 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
        }
      }
    }
    if (lastError) throw lastError;

    // strip: 1 removes GitHub's <owner>-<repo>-<sha>/ root directory.
    await extractTar({
      file: tarball,
      cwd: incoming,
      strip: 1,
      preservePaths: false,
    });

    if (!checkoutLooksUsable(incoming)) {
      throw new Error(
        `the downloaded archive does not contain ${REQUIRED_SOURCE_FILE}`,
      );
    }

    rmSync(repoDir, { recursive: true, force: true });
    renameSync(incoming, repoDir);
    writeMarker(markerPath, {
      checkedAt: now.toISOString(),
      commit,
      sourceUrl,
      ref,
      transport: "http",
    });
    return {
      repoDir,
      commit,
      retrievedAt: now.toISOString(),
      cached: false,
    };
  } finally {
    rmSync(incoming, { recursive: true, force: true });
    // Keep only the newest tarball so the cache cannot grow without bound.
    const keep = `archive-${commit.slice(0, 12)}.tar.gz`;
    try {
      for (const name of readdirSync(cacheDir)) {
        if (
          name.startsWith("archive-") &&
          name.endsWith(".tar.gz") &&
          name !== keep
        ) {
          rmSync(join(cacheDir, name), { force: true });
        }
      }
    } catch {
      // Cache cleanup is best effort.
    }
  }
}
