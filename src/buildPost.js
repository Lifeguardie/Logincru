const CAPTION_LIMIT = 1024; // Telegram sendPhoto caption limit

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the Hebrew channel post (HTML parse_mode) for a product that already
 * has an affiliateLink. Kept under Telegram's 1024-char photo caption limit.
 */
function buildPost(product) {
  const title = escapeHtml(product.title).slice(0, 200);
  const lines = [`🔥 <b>${title}</b>`, ''];

  const hasDeal = product.originalPrice && product.originalPrice > product.salePrice;
  lines.push(
    hasDeal
      ? `💰 מחיר: <b>$${product.salePrice}</b> (במקום <s>$${product.originalPrice}</s>)`
      : `💰 מחיר: <b>$${product.salePrice}</b>`
  );
  if (product.discountPercent > 0) lines.push(`📉 הנחה: ${product.discountPercent}%`);
  if (product.rating) lines.push(`⭐ דירוג: ${product.rating}% חיוביות`);
  lines.push('', `🔗 <a href="${escapeHtml(product.affiliateLink)}">להזמנה באלי אקספרס</a>`, '', '#AliExpress #מבצע');

  let caption = lines.join('\n');
  if (caption.length > CAPTION_LIMIT) {
    // Only the title is unbounded input; trim it further if needed
    const overflow = caption.length - CAPTION_LIMIT;
    const shortTitle = title.slice(0, Math.max(20, title.length - overflow - 1)) + '…';
    caption = caption.replace(title, shortTitle);
  }
  return caption;
}

module.exports = { buildPost, escapeHtml, CAPTION_LIMIT };
