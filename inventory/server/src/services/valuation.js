'use strict';

/**
 * חישובי שווי מלאי, השוואה בין ספירות, ועלות צריכה.
 * כל המרה של כמות/שווי עוברת דרך services/units.
 */

const db = require('../db');
const units = require('./units');
const config = require('../config');

/**
 * שורות הספירה, מסוכמות לרמת פריט+אזור.
 * פריט שנספר בכמה יחידות באותו אזור (3 בקבוקים + בקבוק פתוח ששוקל 400 גרם)
 * מוחזר כשורה אחת עם פירוט ההזנות ב-entries.
 */
async function getCountRows(countId) {
  const rows = await db.query(
    `SELECT cl.item_id AS itemId, cl.location_id AS locationId, cl.unit_name AS unitName,
            cl.item_unit_id AS itemUnitId, cl.quantity_entered AS quantityEntered,
            cl.factor_used AS factorUsed, cl.tare_used AS tareUsed, cl.tare_units AS tareUnits,
            cl.quantity_base AS quantityBase, cl.unit_price_snapshot AS unitPrice,
            cl.line_value AS lineValue, cl.source, cl.counted_at AS countedAt,
            i.name AS itemName, i.sku, i.base_unit AS baseUnit,
            c.id AS categoryId, c.name AS categoryName,
            l.name AS locationName, l.sort_order AS locationSort,
            u.full_name AS countedByName
       FROM count_lines cl
       JOIN items i     ON i.id = cl.item_id
       JOIN locations l ON l.id = cl.location_id
       LEFT JOIN categories c ON c.id = i.category_id
       LEFT JOIN users u      ON u.id = cl.counted_by
      WHERE cl.count_id = ?
      ORDER BY l.sort_order, i.name`,
    [countId]
  );

  const byItemLocation = new Map();

  for (const row of rows) {
    const key = `${row.itemId}:${row.locationId}`;

    if (!byItemLocation.has(key)) {
      byItemLocation.set(key, {
        itemId: row.itemId,
        itemName: row.itemName,
        sku: row.sku,
        baseUnit: row.baseUnit,
        categoryId: row.categoryId,
        categoryName: row.categoryName || 'ללא מחלקה',
        locationId: row.locationId,
        locationName: row.locationName,
        quantityBase: 0,
        totalValue: 0,
        entries: [],
      });
    }

    const group = byItemLocation.get(key);

    group.entries.push({
      itemUnitId: row.itemUnitId,
      unitName: row.unitName,
      quantityEntered: units.toNumber(row.quantityEntered),
      factorUsed: units.toNumber(row.factorUsed),
      tareUsed: units.toNumber(row.tareUsed),
      tareUnits: units.toNumber(row.tareUnits),
      quantityBase: units.toNumber(row.quantityBase),
      lineValue: units.toNumber(row.lineValue),
      source: row.source,
      countedAt: row.countedAt,
      countedByName: row.countedByName,
    });

    group.quantityBase = units.roundQuantity(group.quantityBase + units.toNumber(row.quantityBase));
    group.totalValue = units.roundMoney(group.totalValue + units.toNumber(row.lineValue));
  }

  return [...byItemLocation.values()];
}

/** מסכם רשימת שורות לפי שדה נתון (מחלקה או אזור) */
function groupTotals(rows, idField, nameField) {
  const groups = new Map();

  for (const row of rows) {
    const id = row[idField] ?? 0;

    if (!groups.has(id)) {
      groups.set(id, { id, name: row[nameField], totalValue: 0, itemCount: 0 });
    }

    const group = groups.get(id);
    group.totalValue = units.roundMoney(group.totalValue + row.totalValue);
    group.itemCount += 1;
  }

  return [...groups.values()].sort((a, b) => b.totalValue - a.totalValue);
}

/** הספירה הסגורה האחרונה שקדמה לספירה נתונה */
async function findPreviousCount(countId) {
  const current = await db.queryOne('SELECT count_date, id FROM counts WHERE id = ?', [countId]);
  if (!current) return null;

  return db.queryOne(
    `SELECT id, name, count_date AS countDate, total_value AS totalValue
       FROM counts
      WHERE status = 'closed'
        AND (count_date < ? OR (count_date = ? AND id < ?))
      ORDER BY count_date DESC, id DESC
      LIMIT 1`,
    [current.count_date, current.count_date, countId]
  );
}

/**
 * סיכום ספירה: שווי כולל, פילוח לפי מחלקה ואזור, והשוואה לספירה הקודמת.
 * פריט מסומן כחריגה אם הכמות שלו השתנתה מעל סף האחוזים שבהגדרות.
 */
async function buildSummary(countId) {
  const count = await db.queryOne(
    `SELECT id, name, count_date AS countDate, status, notes,
            total_value AS totalValue, closed_at AS closedAt
       FROM counts WHERE id = ?`,
    [countId]
  );

  if (!count) return null;

  const rows = await getCountRows(countId);
  const totalValue = units.roundMoney(rows.reduce((sum, row) => sum + row.totalValue, 0));

  const previous = await findPreviousCount(countId);
  let comparison = null;

  if (previous) {
    const previousRows = await getCountRows(previous.id);

    // צוברים לרמת פריט - פריט יכול להופיע בכמה אזורים, וההשוואה היא על הסך הכל
    const previousByItem = new Map();
    for (const row of previousRows) {
      const existing = previousByItem.get(row.itemId) || { quantityBase: 0, totalValue: 0 };
      previousByItem.set(row.itemId, {
        quantityBase: units.roundQuantity(existing.quantityBase + row.quantityBase),
        totalValue: units.roundMoney(existing.totalValue + row.totalValue),
      });
    }

    const currentByItem = new Map();
    for (const row of rows) {
      const existing = currentByItem.get(row.itemId) || {
        itemId: row.itemId, itemName: row.itemName, baseUnit: row.baseUnit,
        categoryName: row.categoryName, quantityBase: 0, totalValue: 0,
      };
      currentByItem.set(row.itemId, {
        ...existing,
        quantityBase: units.roundQuantity(existing.quantityBase + row.quantityBase),
        totalValue: units.roundMoney(existing.totalValue + row.totalValue),
      });
    }

    const threshold = config.business.varianceAlertPercent;
    const changes = [];

    for (const [itemId, current] of currentByItem) {
      const before = previousByItem.get(itemId);
      const previousQuantity = before ? before.quantityBase : 0;
      const quantityDiff = units.roundQuantity(current.quantityBase - previousQuantity);

      // אחוז שינוי מוגדר רק כשהייתה כמות קודמת. פריט חדש מסומן כ-null ולא כאינסוף.
      const percentChange = previousQuantity > 0
        ? units.round((quantityDiff / previousQuantity) * 100, 1)
        : null;

      changes.push({
        itemId,
        itemName: current.itemName,
        baseUnit: current.baseUnit,
        categoryName: current.categoryName,
        previousQuantity,
        currentQuantity: current.quantityBase,
        quantityDiff,
        percentChange,
        valueDiff: units.roundMoney(current.totalValue - (before ? before.totalValue : 0)),
        isVariance: percentChange !== null && Math.abs(percentChange) >= threshold,
      });
    }

    changes.sort((a, b) => Math.abs(b.valueDiff) - Math.abs(a.valueDiff));

    comparison = {
      previousCount: {
        id: previous.id,
        name: previous.name,
        countDate: previous.countDate,
        totalValue: units.toNumber(previous.totalValue),
      },
      valueDiff: units.roundMoney(totalValue - units.toNumber(previous.totalValue)),
      varianceThresholdPercent: threshold,
      changes,
    };
  }

  return {
    count: {
      ...count,
      totalValue: count.status === 'closed' ? units.toNumber(count.totalValue) : totalValue,
    },
    totalValue,
    countedItems: rows.length,
    byCategory: groupTotals(rows, 'categoryId', 'categoryName'),
    byLocation: groupTotals(rows, 'locationId', 'locationName'),
    rows,
    comparison,
  };
}

/**
 * עלות צריכה בין שתי ספירות סגורות:
 *   צריכה = מלאי פתיחה + רכש שבתווך - מלאי סגירה
 *
 * בלי הרכש המספר היה מראה רק שינוי במלאי ולא כמה באמת נצרך.
 * הרכש נספר מהיום שאחרי ספירת הפתיחה ועד יום ספירת הסגירה ועד בכלל.
 */
async function buildConsumption(openingCountId, closingCountId) {
  const [opening, closing] = await Promise.all([
    db.queryOne('SELECT id, name, count_date AS countDate, status FROM counts WHERE id = ?', [openingCountId]),
    db.queryOne('SELECT id, name, count_date AS countDate, status FROM counts WHERE id = ?', [closingCountId]),
  ]);

  if (!opening || !closing) return null;

  const [openingRows, closingRows] = await Promise.all([
    getCountRows(openingCountId),
    getCountRows(closingCountId),
  ]);

  const purchaseRows = await db.query(
    `SELECT p.item_id AS itemId,
            SUM(p.quantity_base) AS quantityBase,
            SUM(p.total_cost)    AS totalCost
       FROM purchases p
      WHERE p.purchase_date > ? AND p.purchase_date <= ?
      GROUP BY p.item_id`,
    [opening.countDate, closing.countDate]
  );

  /** מכווץ שורות ספירה לרמת פריט */
  function toItemMap(rows) {
    const map = new Map();
    for (const row of rows) {
      const existing = map.get(row.itemId) || { quantityBase: 0, totalValue: 0, meta: row };
      map.set(row.itemId, {
        meta: existing.meta,
        quantityBase: units.roundQuantity(existing.quantityBase + row.quantityBase),
        totalValue: units.roundMoney(existing.totalValue + row.totalValue),
      });
    }
    return map;
  }

  const openingByItem = toItemMap(openingRows);
  const closingByItem = toItemMap(closingRows);
  const purchasesByItem = new Map(
    purchaseRows.map((row) => [row.itemId, {
      quantityBase: units.toNumber(row.quantityBase),
      totalCost: units.toNumber(row.totalCost),
    }])
  );

  const allItemIds = new Set([
    ...openingByItem.keys(),
    ...closingByItem.keys(),
    ...purchasesByItem.keys(),
  ]);

  // פריטים שהופיעו רק ברכש חסרים מטא-דאטה משורות הספירה
  const missingMeta = [...allItemIds].filter(
    (id) => !openingByItem.has(id) && !closingByItem.has(id)
  );
  const metaById = new Map();

  if (missingMeta.length > 0) {
    const placeholders = missingMeta.map(() => '?').join(',');
    const metaRows = await db.query(
      `SELECT i.id, i.name, i.base_unit AS baseUnit, c.name AS categoryName
         FROM items i LEFT JOIN categories c ON c.id = i.category_id
        WHERE i.id IN (${placeholders})`,
      missingMeta
    );
    for (const row of metaRows) metaById.set(row.id, row);
  }

  const items = [];
  let totalConsumptionCost = 0;

  for (const itemId of allItemIds) {
    const before = openingByItem.get(itemId);
    const after = closingByItem.get(itemId);
    const purchased = purchasesByItem.get(itemId) || { quantityBase: 0, totalCost: 0 };
    const meta = before?.meta || after?.meta || metaById.get(itemId) || {};

    const openingQuantity = before ? before.quantityBase : 0;
    const closingQuantity = after ? after.quantityBase : 0;
    const openingValue = before ? before.totalValue : 0;
    const closingValue = after ? after.totalValue : 0;

    const consumedQuantity = units.roundQuantity(
      openingQuantity + purchased.quantityBase - closingQuantity
    );
    const consumedCost = units.roundMoney(
      openingValue + purchased.totalCost - closingValue
    );

    totalConsumptionCost = units.roundMoney(totalConsumptionCost + consumedCost);

    items.push({
      itemId,
      itemName: meta.itemName || meta.name || `פריט ${itemId}`,
      baseUnit: meta.baseUnit,
      categoryName: meta.categoryName || 'ללא מחלקה',
      openingQuantity,
      openingValue,
      purchasedQuantity: purchased.quantityBase,
      purchasedCost: purchased.totalCost,
      closingQuantity,
      closingValue,
      consumedQuantity,
      consumedCost,
      // בלי רכש רשום, מספר שלילי אומר שנכנסה סחורה שלא דווחה - לא שנוצר מלאי מהאוויר
      hasNegativeConsumption: consumedQuantity < 0,
    });
  }

  items.sort((a, b) => b.consumedCost - a.consumedCost);

  return {
    opening: { id: opening.id, name: opening.name, countDate: opening.countDate, status: opening.status },
    closing: { id: closing.id, name: closing.name, countDate: closing.countDate, status: closing.status },
    totalConsumptionCost,
    itemsWithoutPurchaseData: items.filter((item) => item.hasNegativeConsumption).length,
    items,
  };
}

module.exports = { getCountRows, buildSummary, buildConsumption, findPreviousCount, groupTotals };
