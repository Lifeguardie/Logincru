'use strict';

/** מחלקות ואזורי ספירה - ישויות פשוטות שהקטלוג נשען עליהן */

const express = require('express');
const { z } = require('zod');

const db = require('../db');
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

// שמות הטבלאות קבועים בקוד ולא מגיעים מקלט משתמש
router.use('/categories', requireAuth, simpleCrud('categories'));
router.use('/locations', requireAuth, simpleCrud('locations'));

module.exports = router;
