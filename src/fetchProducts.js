const { callAliexpress } = require('./aliexpressClient');
const config = require('./config');
const logger = require('./logger');

function parsePrice(v) {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDiscount(raw, salePrice, originalPrice) {
  const n = Number(String(raw ?? '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  if (salePrice && originalPrice && originalPrice > salePrice) {
    return Math.round((1 - salePrice / originalPrice) * 100);
  }
  return 0;
}

/** Normalize a raw API product into the shape the rest of the bot uses. */
function normalizeProduct(p) {
  const salePrice = parsePrice(p.target_sale_price ?? p.sale_price);
  const originalPrice = parsePrice(p.target_original_price ?? p.original_price) ?? salePrice;
  return {
    productId: String(p.product_id),
    title: p.product_title || '',
    salePrice,
    originalPrice,
    discountPercent: parseDiscount(p.discount, salePrice, originalPrice),
    rating: p.evaluate_rate ? String(p.evaluate_rate).replace('%', '') : null,
    imageUrl: p.product_main_image_url || null,
    detailUrl: p.product_detail_url || `https://www.aliexpress.com/item/${p.product_id}.html`,
    // Some responses already include a tracked promotion link
    promotionLink: p.promotion_link || null,
  };
}

/**
 * Fetch candidate products across the configured categories, filtered by
 * price range and minimum discount. Returns a de-duplicated, shuffled list.
 */
async function fetchProducts({ perCategory = 20 } = {}) {
  const { categoryIds, priceRange, minDiscountPercent, trackingId, shipToCountry } = config.aliexpress;
  const byId = new Map();

  for (const categoryId of categoryIds) {
    try {
      const result = await callAliexpress('aliexpress.affiliate.hotproduct.query', {
        category_ids: categoryId,
        // API expects prices in cents
        min_sale_price: Math.round(priceRange.min * 100),
        max_sale_price: Math.round(priceRange.max * 100),
        target_currency: 'USD',
        target_language: 'EN',
        tracking_id: trackingId,
        ship_to_country: shipToCountry,
        page_size: perCategory,
        page_no: 1,
        sort: 'SALE_PRICE_ASC',
      });
      const raw = result?.products?.product || [];
      for (const p of raw) {
        const product = normalizeProduct(p);
        if (!product.productId || !product.salePrice) continue;
        if (product.salePrice < priceRange.min || product.salePrice > priceRange.max) continue;
        if (product.discountPercent < minDiscountPercent) continue;
        byId.set(product.productId, product);
      }
      logger.info(`Category ${categoryId}: ${raw.length} fetched, ${byId.size} total candidates after filters`);
    } catch (err) {
      logger.error(`Failed fetching category ${categoryId}:`, err.message);
      // Continue with other categories; the caller decides whether zero results is fatal
    }
  }

  // Shuffle so consecutive runs don't always pick the same top items
  const products = [...byId.values()];
  for (let i = products.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [products[i], products[j]] = [products[j], products[i]];
  }
  return products;
}

module.exports = { fetchProducts, normalizeProduct };
