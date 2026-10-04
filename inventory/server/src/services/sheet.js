'use strict';

const db = require('../db');
const units = require('./units');

/**
 * הפריטים הפעילים של אזור, בסדר הדף, עם יחידות הספירה שלהם.
 * משמש גם את מסך הספירה וגם את זיהוי הצילום, כדי ששניהם יראו אותו דף.
 */
async function loadLocationItems(locationId) {
  const items = await db.query(
    `SELECT i.id, i.sku, i.name, i.base_unit AS baseUnit,
            i.price_per_base_unit AS pricePerBaseUnit,
            c.name AS categoryName, il.sort_order AS sortOrder
       FROM item_locations il
       JOIN items i ON i.id = il.item_id
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE il.location_id = ? AND i.active = 1
      ORDER BY il.sort_order, i.name`,
    [locationId]
  );

  if (items.length === 0) return [];

  const placeholders = items.map(() => '?').join(',');
  const unitRows = await db.query(
    `SELECT id, item_id AS itemId, unit_name AS unitName, factor_to_base AS factorToBase,
            tare_weight AS tareWeight, is_default AS isDefault, sort_order AS sortOrder
       FROM item_units
      WHERE item_id IN (${placeholders})
      ORDER BY sort_order, id`,
    items.map((item) => item.id)
  );

  const unitsByItem = new Map();
  for (const row of unitRows) {
    if (!unitsByItem.has(row.itemId)) unitsByItem.set(row.itemId, []);
    unitsByItem.get(row.itemId).push({
      id: row.id,
      unitName: row.unitName,
      factorToBase: units.toNumber(row.factorToBase),
      tareWeight: row.tareWeight === null ? null : units.toNumber(row.tareWeight),
      isDefault: Boolean(row.isDefault),
    });
  }

  return items.map((item) => ({
    ...item,
    pricePerBaseUnit: units.toNumber(item.pricePerBaseUnit),
    units: unitsByItem.get(item.id) || [],
  }));
}

module.exports = { loadLocationItems };
