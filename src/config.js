require('dotenv').config();

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}

module.exports = {
  aliexpress: {
    appKey: process.env.ALI_APP_KEY,
    appSecret: process.env.ALI_APP_SECRET,
    trackingId: process.env.ALI_TRACKING_ID,
    // First-level affiliate category IDs (see aliexpress.affiliate.category.get)
    categoryIds: (process.env.ALI_CATEGORY_IDS || '15,44')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    minDiscountPercent: num('MIN_DISCOUNT_PERCENT', 30),
    priceRange: {
      min: num('PRICE_MIN_USD', 5),
      max: num('PRICE_MAX_USD', 100),
    },
    shipToCountry: process.env.SHIP_TO_COUNTRY || 'IL',
    apiBase: process.env.ALI_API_BASE || 'https://api-sg.aliexpress.com/sync',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
    adminChatId: process.env.ADMIN_CHAT_ID || null,
  },
  schedule: {
    cronExpression: process.env.CRON_EXPRESSION || '0 */6 * * *',
    postsPerRun: num('POSTS_PER_RUN', 3),
  },
  dedupeDays: num('DEDUPE_DAYS', 30),
  dryRun: process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true',
  dbPath: process.env.DB_PATH || require('path').join(__dirname, '..', 'db', 'bot.sqlite'),
};
