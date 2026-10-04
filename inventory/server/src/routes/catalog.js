'use strict';

/** מחלקות ואזורי ספירה - ישויות פשוטות שהקטלוג נשען עליהן */

const express = require('express');
const { z } = require('zod');

const db = require('../db');
const logger = require('../logger');
const { loadLocationItems } = require('../services/sheet');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const nameSchema = z.object({
  name: z.string().trim().min(1, 'נדרש שם').max(128),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

/** בונה זוג נתיבי CRUD זהים לטבלה פשוטה עם name/sort_order/active */
function simpleCrud(table) {
  const sub = express.Router();

  sub.get('/', asyncRoute(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await db.query(
      `SELECT id, name, sort_order AS sortOrder, active
         FROM ${table}
        WHERE (? = 1 OR active = 1)
        ORDER BY sort_order, name`,
      [includeInactive ? 1 : 0]
    );
    res.json(rows.map((row) => ({ ...row, active: Boolean(row.active) })));
  }));

  sub.post('/', requireRole('manager'), asyncRoute(async (req, res) => {
    const body = nameSchema.parse(req.body);
    const result = await db.query(
      `INSERT INTO ${table} (name, sort_order, active) VALUES (?, ?, ?)`,
      [body.name, body.sortOrder, body.active ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, ...body });
  }));

  sub.put('/:id', requireRole('manager'), asyncRoute(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = nameSchema.parse(req.body);

    const result = await db.query(
      `UPDATE ${table} SET name = ?, sort_order = ?, active = ? WHERE id = ?`,
      [body.name, body.sortOrder, body.active ? 1 : 0, id]
    );

    if (result.affectedRows === 0) throw new HttpError(404, 'הרשומה לא נמצאה');
    res.json({ id, ...body });
  }));

  return sub;
}

/* ---------- סדר הדף של אזור ---------- */

/** הפריטים של האזור בסדר שבו הם מופיעים בדף הספירה */
router.get('/locations/:id/items', requireAuth, asyncRoute(async (req, res) => {
  const locationId = z.coerce.number().int().positive().parse(req.params.id);
  const location = await db.queryOne('SELECT id, name FROM locations WHERE id = ?', [locationId]);
  if (!location) throw new HttpError(404, 'האזור לא נמצא');

  res.json({ location, items: await loadLocationItems(locationId) });
}));

const orderSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1).max(1000),
});

/**
 * קובע את סדר הפריטים בדף של אזור. זה מה שהופך את מסך הספירה ל"דף הנייר".
 * פריטים שלא נשלחו שומרים את סדרם היחסי ונדחפים אחרי אלה שנשלחו.
 */
router.put('/locations/:id/order', requireAuth, requireRole('manager'), asyncRoute(async (req, res) => {
  const locationId = z.coerce.number().int().positive().parse(req.params.id);
  const { itemIds } = orderSchema.parse(req.body);

  if (new Set(itemIds).size !== itemIds.length) {
    throw new HttpError(400, 'פריט מופיע פעמיים ברשימה');
  }

  const rows = await db.query(
    'SELECT item_id AS itemId FROM item_locations WHERE location_id = ? ORDER BY sort_order, item_id',
    [locationId]
  );
  const assigned = new Set(rows.map((row) => row.itemId));

  for (const itemId of itemIds) {
    if (!assigned.has(itemId)) throw new HttpError(400, `פריט ${itemId} לא משויך לאזור הזה`);
  }

  const sent = new Set(itemIds);
  const finalOrder = [...itemIds, ...rows.map((row) => row.itemId).filter((id) => !sent.has(id))];

  // הצהרה אחת לכל הדף במקום UPDATE לכל פריט. כל הזוגות כבר קיימים (אומת
  // למעלה), ולכן ON DUPLICATE KEY רק מעדכן את הסדר.
  const values = finalOrder.map((itemId, index) => [itemId, locationId, index]);
  await db.query(
    `INSERT INTO item_locations (item_id, location_id, sort_order)
     VALUES ${values.map(() => '(?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
    values.flat()
  );

  logger.info('סדר הדף עודכן', { locationId, items: finalOrder.length, by: req.user.username });
  res.json({ locationId, itemIds: finalOrder });
}));

// שמות הטבלאות קבועים בקוד ולא מגיעים מקלט משתמש
router.use('/categories', requireAuth, simpleCrud('categories'));
router.use('/locations', requireAuth, simpleCrud('locations'));

module.exports = router;
