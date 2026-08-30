const config = require('./config');
const logger = require('./logger');

const API = (method) => `https://api.telegram.org/bot${config.telegram.botToken}/${method}`;

async function callTelegram(method, payload) {
  const res = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(`Telegram ${method} failed: ${data.description || res.status}`);
    err.telegram = data;
    throw err;
  }
  return data.result;
}

/**
 * Post a product to the channel. Tries sendPhoto (image + caption),
 * falls back to sendMessage when there is no image or the photo send fails.
 */
async function postToChannel({ caption, imageUrl }) {
  if (imageUrl) {
    try {
      return await callTelegram('sendPhoto', {
        chat_id: config.telegram.channelId,
        photo: imageUrl,
        caption,
        parse_mode: 'HTML',
      });
    } catch (err) {
      logger.warn('sendPhoto failed, falling back to sendMessage:', err.message);
    }
  }
  return callTelegram('sendMessage', {
    chat_id: config.telegram.channelId,
    text: caption,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: false },
  });
}

/** Send an operational alert to the private admin chat (never to the public channel). */
async function notifyAdmin(text) {
  if (!config.telegram.adminChatId) return;
  try {
    await callTelegram('sendMessage', {
      chat_id: config.telegram.adminChatId,
      text: `⚠️ aliexpress-bot: ${text}`.slice(0, 4000),
    });
  } catch (err) {
    logger.error('Failed to notify admin:', err.message);
  }
}

module.exports = { postToChannel, notifyAdmin, callTelegram };
