const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

const stmtWasPosted = db.prepare(
  `SELECT 1 FROM posted_products
   WHERE product_id = ? AND posted_at >= datetime('now', ?)
   LIMIT 1`
);

const stmtMarkPosted = db.prepare(
  `INSERT INTO posted_products (product_id, title, price, discount_percent, affiliate_link)
   VALUES (@productId, @title, @price, @discountPercent, @affiliateLink)
   ON CONFLICT(product_id) DO UPDATE SET
     title = excluded.title,
     price = excluded.price,
     discount_percent = excluded.discount_percent,
     affiliate_link = excluded.affiliate_link,
     posted_at = datetime('now')`
);

const stmtLogPost = db.prepare(
  `INSERT INTO post_log (product_id, status, error_message) VALUES (?, ?, ?)`
);

module.exports = {
  /** True if the product was already posted within the dedupe window. */
  wasPostedRecently(productId, days = config.dedupeDays) {
    return !!stmtWasPosted.get(String(productId), `-${days} days`);
  },

  markPosted(product) {
    stmtMarkPosted.run({
      productId: String(product.productId),
      title: product.title || null,
      price: product.salePrice ?? null,
      discountPercent: product.discountPercent ?? null,
      affiliateLink: product.affiliateLink || null,
    });
  },

  logPost(productId, status, errorMessage = null) {
    stmtLogPost.run(productId ? String(productId) : null, status, errorMessage);
  },

  _db: db,
};
