const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function initializeDatabase() {
  const defaultDataDir = path.join(__dirname, '..', 'data');
  const configuredPath = process.env.DB_PATH;
  const databasePath = configuredPath || path.join(defaultDataDir, 'gold_prices.db');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_mode TEXT NOT NULL,
      symbol TEXT NOT NULL,
      currency TEXT NOT NULL,
      unit TEXT NOT NULL,
      price REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      raw_payload TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_price_snapshots_fetched_at
      ON price_snapshots (fetched_at DESC);
  `);

  return db;
}

module.exports = {
  initializeDatabase
};
