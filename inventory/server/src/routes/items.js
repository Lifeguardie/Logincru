'use strict';

/** קטלוג הפריטים: פרטי הפריט, יחידות הספירה שלו, והאזורים שבהם הוא נספר */

const express = require('express');
const { z } = require('zod');

const db = require('../db');
const units = require('../services/units');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const itemSchema = z.object({
  sku: z.string().trim().max(64).nullish().transform((v) => v || null),
  name: z.string().trim().min(1, 'נדרש שם פריט').max(255),
  categoryId: z.coerce.number().int().positive().nullish(),
  baseUnit: z.enum(units.BASE_UNITS),
  pricePerBaseUnit: z.coerce.number().min(0, 'מחיר לא יכול להיות שלילי').default(0),
  supplierName: z.string().trim().max(128).nullish().transform((v) => v || null),
  notes: z.string().trim().max(512).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
  locationIds: z.array(z.coerce.number().int().positive()).default([]),
});

const unitSchema = z.object({
  unitName: z.string().trim().min(1, 'נדרש שם יחידה').max(64),
  factorToBase: z.coerce.number().positive('מקדם ההמרה חייב להיות גדול מאפס'),
  tareWeight: z.coerce.number().min(0).nullish(),
  isDefault: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

/** טוען את יחידות הספירה של קבוצת פריטים, ממופות לפי item_id */
async function loadUnitsFor(itemIds) {
  if (itemIds.length === 0) return new Map();

  const placeholders = itemIds.map(() => '?').join(',');
  const rows = await db.query(
    `SELECT id, item_id AS itemId, unit_name AS unitName, factor_to_base AS factorToBase,
            tare_weight AS tareWeight, is_default AS isDefault, sort_order AS sortOrder
       FROM item_units
      WHERE item_id IN (${placeholders})
      ORDER BY sort_order, id`,
    itemIds
  );

  const byItem = new Map();
  for (const row of rows) {
    const unit = {
      id: row.id,
      unitName: row.unitName,
      factorToBase: units.toNumber(row.factorToBase),
      tareWeight: row.tareWeight === null ? null : units.toNumber(row.tareWeight),
      isDefault: Boolean(row.isDefault),
      sortOrder: row.sortOrder,
    };
    if (!byItem.has(row.itemId)) byItem.set(row.itemId, []);
    byItem.get(row.itemId).push(unit);
  }
  return byItem;
}

/** רשימת פריטים עם סינון וחיפוש */
router.get('/', asyncRoute(async (req, res) => {
  const query = z.object({
    q: z.string().trim().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    locationId: z.coerce.number().int().positive().optional(),
    // z.coerce.boolean() היה הופך את המחרוזת "false" ל-true. מפרשים במפורש.
    includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);

  const where = [];
  const params = [];

  if (!query.includeInactive) where.push('i.active = 1');
  if (query.q) {
    where.push('(i.name LIKE ? OR i.sku LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like);
  }
  if (query.categoryId) {
    where.push('i.category_id = ?');
    params.push(query.categoryId);
  }
  if (query.locationId) {
    where.push('EXISTS (SELECT 1 FROM item_locations il WHERE il.item_id = i.id AND il.location_id = ?)');
    params.push(query.locationId);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await db.query(
    `SELECT i.id, i.sku, i.name, i.category_id AS categoryId, c.name AS categoryName,
            i.base_unit AS baseUnit, i.price_per_base_unit AS pricePerBaseUnit,
            i.supplier_name AS supplierName, i.notes, i.active
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
       ${whereClause}
      ORDER BY i.name
      LIMIT ? OFFSET ?`,
    [...params, String(query.limit), String(query.offset)]
  );

  const totalRow = await db.queryOne(
    `SELECT COUNT(*) AS total FROM items i ${whereClause}`,
    params
  );

  const unitsByItem = await loadUnitsFor(rows.map((row) => row.id));

  res.json({
    total: totalRow.total,
    items: rows.map((row) => ({
      ...row,
      pricePerBaseUnit: units.toNumber(row.pricePerBaseUnit),
      active: Boolean(row.active),
      units: unitsByItem.get(row.id) || [],
    })),
  });
}));

/** פריט בודד, כולל יחידות ואזורים */
router.get('/:id', asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const item = await db.queryOne(
    `SELECT i.id, i.sku, i.name, i.category_id AS categoryId, i.base_unit AS baseUnit,
            i.price_per_base_unit AS pricePerBaseUnit, i.supplier_name AS supplierName,
            i.notes, i.active
       FROM items i WHERE i.id = ?`,
    [id]
  );

  if (!item) throw new HttpError(404, 'הפריט לא נמצא');

  const locations = await db.query(
    'SELECT location_id AS locationId, sort_order AS sortOrder FROM item_locations WHERE item_id = ?',
    [id]
  );
  const unitsByItem = await loadUnitsFor([id]);

  res.json({
    ...item,
    pricePerBaseUnit: units.toNumber(item.pricePerBaseUnit),
    active: Boolean(item.active),
    units: unitsByItem.get(id) || [],
    locationIds: locations.map((row) => row.locationId),
  });
}));

/**
 * שומר את שיוך הפריט לאזורים *בלי לגעת בסדר הקיים*.
 *
 * sort_order הוא מיקום הפריט בדף הספירה של האזור. מחיקה והכנסה מחדש הייתה
 * מערבבת את הדף בכל עריכת שם. לכן: אזור שנשאר שומר את המקום שלו, אזור שהוסר
 * נמחק, ואזור חדש מצטרף בסוף הדף של אותו אזור.
 */
async function replaceLocations(conn, itemId, locationIds) {
  const wanted = new Set(locationIds);

  const [existing] = await conn.execute(
    'SELECT location_id AS locationId FROM item_locations WHERE item_id = ?',
    [itemId]
  );
  const current = new Set(existing.map((row) => row.locationId));

  for (const locationId of current) {
    if (!wanted.has(locationId)) {
      await conn.execute(
        'DELETE FROM item_locations WHERE item_id = ? AND location_id = ?',
        [itemId, locationId]
      );
    }
  }

  for (const locationId of wanted) {
    if (current.has(locationId)) continue;

    const [[next]] = await conn.execute(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM item_locations WHERE location_id = ?',
      [locationId]
    );
    await conn.execute(
      'INSERT INTO item_locations (item_id, location_id, sort_order) VALUES (?, ?, ?)',
      [itemId, locationId, next.nextOrder]
    );
  }
}

router.post('/', requireRole('manager'), asyncRoute(async (req, res) => {
  const body = itemSchema.parse(req.body);

  const id = await db.transaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO items (sku, name, category_id, base_unit, price_per_base_unit,
                          supplier_name, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.sku, body.name, body.categoryId ?? null, body.baseUnit,
       body.pricePerBaseUnit, body.supplierName, body.notes, body.active ? 1 : 0]
    );

    const newId = result.insertId;

    // כל פריט חייב לפחות דרך ספירה אחת, אחרת אי אפשר לספור אותו.
    // יוצרים ברירת מחדל של יחידת הבסיס עצמה, והמנהל יוסיף ארגז/בקבוק לפי הצורך.
    await conn.execute(
      `INSERT INTO item_units (item_id, unit_name, factor_to_base, is_default, sort_order)
       VALUES (?, ?, 1, 1, 0)`,
      [newId, units.baseUnitLabel(body.baseUnit)]
    );

    await replaceLocations(conn, newId, body.locationIds);
    return newId;
  });

  res.status(201).json({ id });
}));

router.put('/:id', requireRole('manager'), asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = itemSchema.parse(req.body);

  await db.transaction(async (conn) => {
    const [result] = await conn.execute(
      `UPDATE items SET sku = ?, name = ?, category_id = ?, base_unit = ?,
              price_per_base_unit = ?, supplier_name = ?, notes = ?, active = ?
       WHERE id = ?`,
      [body.sku, body.name, body.categoryId ?? null, body.baseUnit,
       body.pricePerBaseUnit, body.supplierName, body.notes, body.active ? 1 : 0, id]
    );

    if (result.affectedRows === 0) throw new HttpError(404, 'הפריט לא נמצא');

    await replaceLocations(conn, id, body.locationIds);
  });

  res.json({ id });
}));

/* ---------- יחידות ספירה ---------- */

/** יחידת ברירת מחדל אחת לפריט - כשמסמנים אחת, השאר מתנקות */
async function clearOtherDefaults(itemId, keepUnitId) {
  await db.query(
    'UPDATE item_units SET is_default = 0 WHERE item_id = ? AND id <> ?',
    [itemId, keepUnitId ?? 0]
  );
}

router.post('/:id/units', requireRole('manager'), asyncRoute(async (req, res) => {
  const itemId = z.coerce.number().int().positive().parse(req.params.id);
  const body = unitSchema.parse(req.body);

  if (body.isDefault) await clearOtherDefaults(itemId, null);

  const result = await db.query(
    `INSERT INTO item_units (item_id, unit_name, factor_to_base, tare_weight, is_default, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [itemId, body.unitName, body.factorToBase, body.tareWeight ?? null,
     body.isDefault ? 1 : 0, body.sortOrder]
  );

  res.status(201).json({ id: result.insertId, ...body });
}));

router.put('/:id/units/:unitId', requireRole('manager'), asyncRoute(async (req, res) => {
  const itemId = z.coerce.number().int().positive().parse(req.params.id);
  const unitId = z.coerce.number().int().positive().parse(req.params.unitId);
  const body = unitSchema.parse(req.body);

  if (body.isDefault) await clearOtherDefaults(itemId, unitId);

  const result = await db.query(
    `UPDATE item_units
        SET unit_name = ?, factor_to_base = ?, tare_weight = ?, is_default = ?, sort_order = ?
      WHERE id = ? AND item_id = ?`,
    [body.unitName, body.factorToBase, body.tareWeight ?? null,
     body.isDefault ? 1 : 0, body.sortOrder, unitId, itemId]
  );

  if (result.affectedRows === 0) throw new HttpError(404, 'יחידת הספירה לא נמצאה');
  res.json({ id: unitId, ...body });
}));

router.delete('/:id/units/:unitId', requireRole('manager'), asyncRoute(async (req, res) => {
  const itemId = z.coerce.number().int().positive().parse(req.params.id);
  const unitId = z.coerce.number().int().positive().parse(req.params.unitId);

  const remaining = await db.queryOne(
    'SELECT COUNT(*) AS total FROM item_units WHERE item_id = ?',
    [itemId]
  );

  if (remaining.total <= 1) {
    throw new HttpError(400, 'לפריט חייבת להישאר לפחות יחידת ספירה אחת');
  }

  const result = await db.query(
    'DELETE FROM item_units WHERE id = ? AND item_id = ?',
    [unitId, itemId]
  );

  if (result.affectedRows === 0) throw new HttpError(404, 'יחידת הספירה לא נמצאה');
  res.status(204).end();
}));

module.exports = router;
