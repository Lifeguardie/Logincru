// One-off sanity check: verifies the bot token and channel admin rights.
// Usage: npm run test:telegram
const config = require('../src/config');
const { callTelegram } = require('../src/telegramPost');

(async () => {
  if (!config.telegram.botToken || !config.telegram.channelId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID in .env');
    process.exit(1);
  }
  const me = await callTelegram('getMe', {});
  console.log(`Bot OK: @${me.username}`);
  const msg = await callTelegram('sendMessage', {
    chat_id: config.telegram.channelId,
    text: '✅ בדיקת חיבור — הבוט מחובר לערוץ בהצלחה',
  });
  console.log(`Test message sent to ${config.telegram.channelId} (message_id=${msg.message_id})`);
})().catch((err) => {
  console.error('Telegram test failed:', err.message);
  process.exit(1);
});
