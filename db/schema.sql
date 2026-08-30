-- SQLite schema for the AliExpress -> Telegram affiliate bot

CREATE TABLE IF NOT EXISTS posted_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL UNIQUE,
  title TEXT,
  price REAL,
  discount_percent INTEGER,
  affiliate_link TEXT,
  posted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posted_products_posted_at ON posted_products (posted_at);
CREATE INDEX IF NOT EXISTS idx_post_log_created_at ON post_log (created_at);
