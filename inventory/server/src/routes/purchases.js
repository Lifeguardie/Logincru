'use strict';

/**
 * רכש בין ספירות.
 * בלי הנתון הזה דוח הצריכה מראה רק שינוי במלאי ולא כמה באמת נצרך.
 */

const express = require('express');
const { z } = require('zod');

const db = require('../db');
const units = require('../services/units');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const purchaseSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך בפורמט YYYY-MM-DD'),
  // הכמות היא תמיד ביחידת הבסיס של הפריט (ק"ג / ליטר / יחידה)
  quantityBase: z.coerce.number().positive('הכמות חייבת להיות גדולה מאפס'),
  totalCost: z.coerce.number().min(0).default(0),
  supplierName: z.string().trim().max(128).nullish().transform((v) => v || null),
  invoiceRef: z.string().trim().max(64).nullish().transform((v) => v || null),
  notes: z.string().trim().max(512).nullish().transform((v) => v || null),
});

router.get('/', asyncRoute(async (req, res) => {
  const query = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    itemId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }).parse(req.query);

  const where = [];
  const params = [];

  if (query.from) { where.push('p.purchase_date >= ?'); params.push(query.from); }
  if (query.to)   { where.push('p.purchase_date <= ?'); params.push(query.to); }
  if (query.itemId) { where.push('p.item_id = ?'); params.push(query.itemId); }

  const rows = await db.query(
    `SELECT p.id, p.item_id AS itemId, i.name AS itemName, i.base_unit AS baseUnit,
            p.purchase_date AS purchaseDate, p.quantity_base AS quantityBase,
            p.total_cost AS totalCost, p.supplier_name AS supplierName,
            p.invoice_ref AS invoiceRef, p.notes, p.source
       FROM purchases p
       JOIN items i ON i.id = p.item_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.purchase_date DESC, p.id DESC
      LIMIT ?`,
    [...params, String(query.limit)]
  );

  res.json(rows.map((row) => ({
    ...row,
    quantityBase: units.toNumber(row.quantityBase),
    totalCost: units.toNumber(row.totalCost),
  })));
}));

router.post('/', requireRole('manager'), asyncRoute(async (req, res) => {
  const body = purchaseSchema.parse(req.body);

  const result = await db.query(
    `INSERT INTO purchases (item_id, purchase_date, quantity_base, total_cost,
                            supplier_name, invoice_ref, notes, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    [body.itemId, body.purchaseDate, body.quantityBase, body.totalCost,
     body.supplierName, body.invoiceRef, body.notes, req.user.id]
  );

  res.status(201).json({ id: result.insertId, ...body });
}));

router.delete('/:id', requireRole('manager'), asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const result = await db.query('DELETE FROM purchases WHERE id = ?', [id]);

  if (result.affectedRows === 0) throw new HttpError(404, 'רשומת הרכש לא נמצאה');
  res.status(204).end();
}));

module.exports = router;
