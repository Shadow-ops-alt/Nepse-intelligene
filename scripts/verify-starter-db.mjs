#!/usr/bin/env node
/**
 * Verify the compressed starter database that travels inside the Windows
 * installer. Run with `node --experimental-sqlite` on Node 22.
 *
 * Usage: node --experimental-sqlite scripts/verify-starter-db.mjs [path]
 */
import { createReadStream, createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const REQUIRED_TABLES = [
  "companies",
  "candles",
  "quotes",
  "snapshots",
  "watchlist",
  "portfolio_transactions",
];

const source = process.argv[2] ?? "apps/desktop/resources/personal.db.gz";
const directory = mkdtempSync(join(tmpdir(), "nepse-starter-"));
const dbPath = join(directory, "personal.db");

try {
  await pipeline(
    createReadStream(source),
    createGunzip(),
    createWriteStream(dbPath),
  );

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") {
      throw new Error(`integrity_check returned ${JSON.stringify(integrity)}`);
    }

    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of REQUIRED_TABLES) {
      if (!tables.has(table)) throw new Error(`missing table ${table}`);
    }

    const companies = Number(
      db.prepare("SELECT COUNT(*) AS n FROM companies").get().n,
    );
    const candles = Number(
      db.prepare("SELECT COUNT(*) AS n FROM candles").get().n,
    );
    const latest = db.prepare("SELECT MAX(timestamp) AS t FROM candles").get().t;

    if (companies < 400 || candles < 500_000) {
      throw new Error(
        `unexpected starter contents: ${companies} companies, ${candles} candles`,
      );
    }

    console.log(
      `starter database OK: ${companies} companies, ${candles} candles, latest ${latest}`,
    );
  } finally {
    db.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
