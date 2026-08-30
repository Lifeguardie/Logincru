const { callAliexpress } = require('./aliexpressClient');
const config = require('./config');
const logger = require('./logger');

/**
 * Build a fresh affiliate (promotion) link for a product via the official API,
 * so the tracking_id is always valid. Falls back to the promotion link that
 * came with the product query, if any.
 */
async function buildAffiliateLink(product) {
  try {
    const result = await callAliexpress('aliexpress.affiliate.link.generate', {
      promotion_link_type: 0,
      source_values: product.detailUrl,
      tracking_id: config.aliexpress.trackingId,
    });
    const link = result?.promotion_links?.promotion_link?.[0]?.promotion_link;
    if (link) return link;
    throw new Error('empty promotion_links in response');
  } catch (err) {
    logger.warn(`link.generate failed for ${product.productId} (${err.message})`);
    if (product.promotionLink) {
      logger.warn(`Using promotion link from product query for ${product.productId}`);
      return product.promotionLink;
    }
    throw err;
  }
}

module.exports = { buildAffiliateLink };
