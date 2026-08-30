// One full bot cycle: fetch -> dedupe -> affiliate link -> build post -> publish.
// Used by the scheduler and runnable manually: `npm run once` (DRY_RUN=1 supported).
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { fetchProducts } = require('./fetchProducts');
const { buildAffiliateLink } = require('./buildAffiliateLink');
const { buildPost } = require('./buildPost');
const { postToChannel, notifyAdmin } = require('./telegramPost');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOnce() {
  logger.info(`--- Run started (dryRun=${config.dryRun}) ---`);
  let posted = 0;

  let products;
  try {
    products = await fetchProducts();
  } catch (err) {
    logger.error('Product fetch failed:', err);
    await notifyAdmin(`שליפת מוצרים נכשלה: ${err.message}`);
    return 0;
  }

  const fresh = products.filter((p) => !db.wasPostedRecently(p.productId));
  logger.info(`${products.length} candidates, ${fresh.length} after dedupe (${config.dedupeDays} days)`);
  if (fresh.length === 0) {
    logger.warn('No new products to post this run');
    return 0;
  }

  for (const product of fresh) {
    if (posted >= config.schedule.postsPerRun) break;
    try {
      product.affiliateLink = await buildAffiliateLink(product);
      const caption = buildPost(product);

      if (config.dryRun) {
        logger.info(`[DRY RUN] Would post ${product.productId}:\n${caption}`);
      } else {
        await postToChannel({ caption, imageUrl: product.imageUrl });
        db.markPosted(product);
        db.logPost(product.productId, 'success');
        logger.info(`Posted ${product.productId}: ${product.title.slice(0, 60)}`);
      }
      posted++;
      // Stay well under Telegram rate limits between posts
      if (posted < config.schedule.postsPerRun) await sleep(3000);
    } catch (err) {
      logger.error(`Failed to post ${product.productId}:`, err.message);
      if (!config.dryRun) db.logPost(product.productId, 'failed', err.message);
      // Token/quota problems affect every product — alert once and stop the run
      if (/quota|401|unauthorized|forbidden|token/i.test(err.message)) {
        await notifyAdmin(`שגיאה קריטית בפרסום: ${err.message}`);
        break;
      }
    }
  }

  logger.info(`--- Run finished: ${posted} posted ---`);
  return posted;
}

module.exports = { runOnce };

if (require.main === module) {
  runOnce()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('runOnce crashed:', err);
      process.exit(1);
    });
}
