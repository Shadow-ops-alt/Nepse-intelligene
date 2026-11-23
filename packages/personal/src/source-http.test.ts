import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseGitHubRepo,
  prepareRepoOverHttp,
  type HttpSourceOptions,
} from "./source-http";

const directories: string[] = [];

function temporary(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `stock-http-${name}-`));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

const SOURCE_URL = "https://github.com/binayabaral/nepal-market-data.git";
const ROOT = "binayabaral-nepal-market-data-abc123";

async function tarballFixture(
  directory: string,
  marker: string,
  required = true,
): Promise<string> {
  const root = join(directory, ROOT);
  if (required) {
    mkdirSync(join(root, "data", "reference"), { recursive: true });
    writeFileSync(
      join(root, "data", "reference", "nepse-symbols.csv"),
      `symbol,name\n${marker},${marker}\n`,
      "utf8",
    );
  } else {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
  }
  const tarball = join(directory, "archive.tar.gz");
  await createTar({ file: tarball, cwd: directory, gzip: true }, [ROOT]);
  return tarball;
}

interface FetchScript {
  commit: string;
  tarball?: string;
  failCommit?: boolean;
  failDownload?: boolean;
}

function scriptedFetch(script: FetchScript): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://api.github.com/repos/")) {
      if (script.failCommit) throw new Error("network down");
      return new Response(JSON.stringify({ sha: script.commit }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("https://codeload.github.com/")) {
      if (script.failDownload || !script.tarball) {
        return new Response("nope", { status: 502 });
      }
      return new Response(new Uint8Array(readFileSync(script.tarball)), {
        status: 200,
      });
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { fetchImpl, calls };
}

function options(
  directory: string,
  fetchImpl: typeof fetch,
  overrides: Partial<HttpSourceOptions> = {},
): HttpSourceOptions {
  return {
    repoDir: join(directory, "cache", "repo"),
    cacheDir: join(directory, "cache"),
    sourceUrl: SOURCE_URL,
    now: new Date("2026-11-21T12:00:00.000Z"),
    fetchImpl,
    ...overrides,
  };
}

describe("parseGitHubRepo", () => {
  it("accepts HTTPS and SSH GitHub remotes and rejects everything else", () => {
    expect(parseGitHubRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepo("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGitHubRepo("https://gitlab.com/owner/repo.git")).toBeNull();
    expect(parseGitHubRepo("https://github.com/owner")).toBeNull();
    expect(parseGitHubRepo("not a url")).toBeNull();
  });
});

describe("prepareRepoOverHttp", () => {
  it("downloads the commit tarball, strips the GitHub root and records a marker", async () => {
    const directory = temporary("download");
    const tarball = await tarballFixture(directory, "FIRST");
    const { fetchImpl, calls } = scriptedFetch({
      commit: "abc123def456",
      tarball,
    });

    const result = await prepareRepoOverHttp(
      options(directory, fetchImpl),
    );

    expect(result.commit).toBe("abc123def456");
    expect(result.cached).toBe(false);
    expect(result.warning).toBeUndefined();
    expect(
      readFileSync(
        join(result.repoDir, "data", "reference", "nepse-symbols.csv"),
        "utf8",
      ),
    ).toContain("FIRST");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/commits/main");
    expect(calls[1]).toContain("/tar.gz/abc123def456");

    const marker = JSON.parse(
      readFileSync(join(directory, "cache", "last-fetch.json"), "utf8"),
    ) as { commit: string; transport: string; ref: string };
    expect(marker).toMatchObject({
      commit: "abc123def456",
      transport: "http",
      ref: "main",
    });
  });

  it("reuses a recent checkout without any network request", async () => {
    const directory = temporary("recent");
    const tarball = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball });
    await prepareRepoOverHttp(options(directory, first.fetchImpl));

    const second = scriptedFetch({ commit: "abc123def456", tarball });
    const result = await prepareRepoOverHttp(
      options(directory, second.fetchImpl, {
        now: new Date("2026-11-21T12:10:00.000Z"),
      }),
    );

    expect(result.cached).toBe(true);
    expect(result.commit).toBe("abc123def456");
    expect(second.calls).toHaveLength(0);
  });

  it("checks again after the cache window and skips the download when the commit is unchanged", async () => {
    const directory = temporary("same-commit");
    const tarball = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball });
    await prepareRepoOverHttp(options(directory, first.fetchImpl));

    const second = scriptedFetch({ commit: "abc123def456", tarball });
    const result = await prepareRepoOverHttp(
      options(directory, second.fetchImpl, {
        now: new Date("2026-11-21T14:00:00.000Z"),
      }),
    );

    expect(result.cached).toBe(true);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]).toContain("/commits/main");
  });

  it("swaps in a newer commit and keeps only the newest tarball", async () => {
    const directory = temporary("new-commit");
    const firstTar = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball: firstTar });
    const firstResult = await prepareRepoOverHttp(
      options(directory, first.fetchImpl),
    );

    const secondRoot = temporary("second-fixture");
    const secondTar = await tarballFixture(secondRoot, "SECOND");
    const second = scriptedFetch({ commit: "def456abc123", tarball: secondTar });
    const secondResult = await prepareRepoOverHttp(
      options(directory, second.fetchImpl, {
        now: new Date("2026-11-22T12:00:00.000Z"),
      }),
    );

    expect(secondResult.commit).toBe("def456abc123");
    expect(secondResult.cached).toBe(false);
    expect(
      readFileSync(
        join(secondResult.repoDir, "data", "reference", "nepse-symbols.csv"),
        "utf8",
      ),
    ).toContain("SECOND");
    expect(existsSync(join(directory, "cache", "archive-abc123def456.tar.gz"))).toBe(
      false,
    );
    expect(
      existsSync(join(directory, "cache", "archive-def456abc123.tar.gz")),
    ).toBe(true);
    expect(firstResult.repoDir).toBe(secondResult.repoDir);
  });

  it("forces a re-download even when the commit is unchanged", async () => {
    const directory = temporary("force");
    const tarball = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball });
    await prepareRepoOverHttp(options(directory, first.fetchImpl));

    const second = scriptedFetch({ commit: "abc123def456", tarball });
    const result = await prepareRepoOverHttp(
      options(directory, second.fetchImpl, { force: true }),
    );

    expect(result.cached).toBe(false);
    expect(second.calls).toHaveLength(2);
  });

  it("falls back to the cached checkout when the commit check fails", async () => {
    const directory = temporary("offline");
    const tarball = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball });
    await prepareRepoOverHttp(options(directory, first.fetchImpl));

    const offline = scriptedFetch({ commit: "", failCommit: true });
    const result = await prepareRepoOverHttp(
      options(directory, offline.fetchImpl, {
        now: new Date("2026-11-23T12:00:00.000Z"),
      }),
    );

    expect(result.cached).toBe(true);
    expect(result.commit).toBe("abc123def456");
    expect(result.warning).toMatch(/using the cached archive/);
  });

  it("refuses a tarball without the required source file and keeps the old checkout", async () => {
    const directory = temporary("bad-tarball");
    const goodTar = await tarballFixture(directory, "FIRST");
    const first = scriptedFetch({ commit: "abc123def456", tarball: goodTar });
    const firstResult = await prepareRepoOverHttp(
      options(directory, first.fetchImpl),
    );

    const emptyRoot = temporary("empty-fixture");
    const badTar = await tarballFixture(emptyRoot, "IGNORED", false);
    const second = scriptedFetch({ commit: "def456abc123", tarball: badTar });
    await expect(
      prepareRepoOverHttp(
        options(directory, second.fetchImpl, {
          now: new Date("2026-11-22T12:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow(/does not contain data\/reference\/nepse-symbols\.csv/);

    expect(
      readFileSync(
        join(firstResult.repoDir, "data", "reference", "nepse-symbols.csv"),
        "utf8",
      ),
    ).toContain("FIRST");
  });

  it("fails when there is no checkout to fall back to", async () => {
    const directory = temporary("no-cache");
    const offline = scriptedFetch({ commit: "", failCommit: true });
    await expect(
      prepareRepoOverHttp(options(directory, offline.fetchImpl)),
    ).rejects.toThrow(/network down/);
  });

  it("rejects non-GitHub sources instead of guessing a URL shape", async () => {
    const directory = temporary("wrong-host");
    const { fetchImpl } = scriptedFetch({ commit: "abc" });
    await expect(
      prepareRepoOverHttp(
        options(directory, fetchImpl, {
          sourceUrl: "https://gitlab.com/owner/repo.git",
        }),
      ),
    ).rejects.toThrow(/only supports github\.com/);
  });
});
