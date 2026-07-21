-- FIO-import — schéma D1 (viz docs/ARCHITECTURE.md)
-- Aplikuj: npx wrangler d1 execute fio-import --remote --file=schema.sql

-- Už uplatněné náklady. Klíč dedupu = fingerprint (datum_txn + částka).
CREATE TABLE IF NOT EXISTS claimed_ledger (
  fingerprint TEXT NOT NULL,
  date_txn    TEXT NOT NULL,          -- RRRR-MM-DD
  amount      REAL NOT NULL,          -- CZK
  merchant    TEXT,                   -- jen pomocné/potvrzující, ne součást klíče
  source      TEXT NOT NULL,          -- fio | revolut | pravidelna | history | prev_xml
  batch_date  TEXT,                   -- datum splatnosti dávky, ve které to odešlo
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fingerprint, source, batch_date)
);
CREATE INDEX IF NOT EXISTS idx_ledger_fp ON claimed_ledger (fingerprint);

-- Šablona pravidelných plateb = zdroj pravdy pro strukturu (texty, mandatory, výchozí částky).
CREATE TABLE IF NOT EXISTS recurring_template (
  ord       INTEGER PRIMARY KEY,
  amount    REAL NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 0,  -- 1 = povinná (stočné, plyn, elektrika)
  template  TEXT NOT NULL                -- text se zástupným {mesic}
);

-- Audit vygenerovaných dávek.
CREATE TABLE IF NOT EXISTS batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_date  TEXT NOT NULL,
  count       INTEGER NOT NULL,
  total       REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
