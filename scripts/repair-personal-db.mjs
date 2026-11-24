#!/usr/bin/env node
// Repair a NEPSE Terminal personal.db whose schema_migrations table records
// migration 5 while the trading tables are missing. The app's migration 6 then
// runs ALTER TABLE trade_journal on a table that does not exist and dies with
// "no such table: trade_journal" before the UI can start.
//
// The script is idempotent, takes a consistent backup first (VACUUM INTO), and
// does not touch existing rows. Run it with the app closed:
//
//   node scripts/repair-personal-db.mjs "/home/aditya/.config/NEPSE Terminal/personal.db"
//
// With no argument it uses ~/.config/NEPSE Terminal/personal.db.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dbPath =
  process.argv[2] ?? join(homedir(), ".config", "NEPSE Terminal", "personal.db");

if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${dbPath}.backup-${stamp}`;
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
console.log(`backup: ${backupPath}`);

const tables = () =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name)),
  );

const before = tables();
console.log(
  `journal before repair: ${before.has("trade_journal") ? "present" : "MISSING"}`,
);
if (!before.has("portfolio_transactions")) {
  console.warn(
    "warning: portfolio_transactions is missing; the app's base migration did not run. Repairing the trading tables only.",
  );
}

db.exec("BEGIN IMMEDIATE");
try {
  // Same definitions as migration 5, plus snapshot_image from migration 6, so
  // the repaired file is complete whichever version row the app checks next.
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      entry REAL NOT NULL,
      stop REAL NOT NULL,
      targets TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      risk_amount REAL,
      risk_percent REAL,
      reward_risk REAL,
      fees REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trade_plans_symbol
      ON trade_plans (symbol, id);

    CREATE TABLE IF NOT EXISTS trade_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      paper INTEGER NOT NULL DEFAULT 0,
      planned_entry REAL,
      planned_stop REAL,
      planned_target REAL,
      actual_entry REAL,
      actual_exit REAL,
      quantity REAL,
      fees REAL NOT NULL DEFAULT 0,
      pnl REAL,
      reason TEXT,
      mistakes TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      snapshot TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      snapshot_image TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trade_journal_symbol
      ON trade_journal (symbol, opened_at);

    CREATE TABLE IF NOT EXISTS corporate_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('dividend', 'bonus', 'right', 'other')),
      ex_date TEXT,
      amount REAL,
      shares REAL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_corporate_ledger_symbol
      ON corporate_ledger (symbol, ex_date);

    CREATE TABLE IF NOT EXISTS reconciliation_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      rows_count INTEGER NOT NULL,
      summary TEXT
    );
  `);

  if (tables().has("portfolio_transactions")) {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(portfolio_transactions)")
        .all()
        .map((row) => String(row.name)),
    );
    if (!columns.has("source")) {
      db.exec("ALTER TABLE portfolio_transactions ADD COLUMN source TEXT");
    }
    if (!columns.has("external_id")) {
      db.exec("ALTER TABLE portfolio_transactions ADD COLUMN external_id TEXT");
    }
    if (!columns.has("kind")) {
      db.exec(
        "ALTER TABLE portfolio_transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'trade'",
      );
    }
    if (!columns.has("notes")) {
      db.exec("ALTER TABLE portfolio_transactions ADD COLUMN notes TEXT");
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_external_id
        ON portfolio_transactions (external_id)
        WHERE external_id IS NOT NULL;
    `);
  }

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  console.error(`repair failed, database unchanged: ${error.message}`);
  process.exit(1);
}

const journalColumns = db
  .prepare("PRAGMA table_info(trade_journal)")
  .all()
  .map((row) => String(row.name));
const created = [
  "trade_plans",
  "trade_journal",
  "corporate_ledger",
  "reconciliation_imports",
].filter((name) => tables().has(name));

console.log(`tables present: ${created.join(", ")}`);
console.log(
  `trade_journal.snapshot_image: ${journalColumns.includes("snapshot_image") ? "present" : "MISSING"}`,
);
console.log("done. start the app; it will record migration 6 and open normally.");
db.close();
