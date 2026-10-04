'use strict';

/** ניהול משתמשים - למנהל מערכת בלבד */

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const db = require('../db');
const logger = require('../logger');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { publicUser } = require('../services/userView');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const ROLES = ['admin', 'manager', 'counter'];

const createSchema = z.object({
  username: z.string().trim().min(3, 'שם משתמש: לפחות 3 תווים').max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'שם משתמש: אותיות לטיניות, ספרות, נקודה, מקף או קו תחתון'),
  password: z.string().min(8, 'סיסמה: לפחות 8 תווים').max(128),
  fullName: z.string().trim().min(1, 'נדרש שם מלא').max(128),
  role: z.enum(ROLES),
});

const updateSchema = z.object({
  fullName: z.string().trim().min(1).max(128),
  role: z.enum(ROLES),
  active: z.boolean(),
});

const resetSchema = z.object({
  newPassword: z.string().min(8, 'סיסמה: לפחות 8 תווים').max(128),
});

function toPublic(row) {
  return { ...publicUser(row), active: Boolean(row.active), createdAt: row.created_at };
}

/** מוודא שאחרי השינוי יישאר לפחות מנהל מערכת פעיל אחד */
async function ensureAnotherActiveAdmin(excludeUserId) {
  const row = await db.queryOne(
    "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1 AND id <> ?",
    [excludeUserId]
  );
  if (row.total === 0) {
    throw new HttpError(400, 'חייב להישאר לפחות מנהל מערכת פעיל אחד');
  }
}

router.get('/', asyncRoute(async (req, res) => {
  const rows = await db.query(
    `SELECT id, username, full_name, role, active, must_change_password, created_at
       FROM users ORDER BY active DESC, role, username`
  );
  res.json(rows.map(toPublic));
}));

router.post('/', asyncRoute(async (req, res) => {
  const body = createSchema.parse(req.body);

  // סיסמה שמנהל קבע היא זמנית - המשתמש יחליף אותה בהתחברות הראשונה
  const result = await db.query(
    `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
     VALUES (?, ?, ?, ?, 1)`,
    [body.username, await bcrypt.hash(body.password, 10), body.fullName, body.role]
  );

  logger.info('משתמש נוצר', { userId: result.insertId, username: body.username, role: body.role, by: req.user.username });
  res.status(201).json({ id: result.insertId, username: body.username, fullName: body.fullName, role: body.role, active: true, mustChangePassword: true });
}));

router.put('/:id', asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = updateSchema.parse(req.body);

  const target = await db.queryOne('SELECT id, role, active FROM users WHERE id = ?', [id]);
  if (!target) throw new HttpError(404, 'המשתמש לא נמצא');

  if (id === req.user.id && (!body.active || body.role !== 'admin')) {
    throw new HttpError(400, 'אי אפשר להשבית או להוריד הרשאות לעצמך');
  }

  const losesAdmin = target.role === 'admin' && target.active && (body.role !== 'admin' || !body.active);
  if (losesAdmin) await ensureAnotherActiveAdmin(id);

  await db.query(
    'UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?',
    [body.fullName, body.role, body.active ? 1 : 0, id]
  );

  logger.info('משתמש עודכן', { userId: id, role: body.role, active: body.active, by: req.user.username });
  res.json({ id, ...body });
}));

/** איפוס סיסמה על ידי מנהל. המשתמש יידרש להחליף אותה בהתחברות הבאה */
router.post('/:id/reset-password', asyncRoute(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { newPassword } = resetSchema.parse(req.body);

  const result = await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    [await bcrypt.hash(newPassword, 10), id]
  );
  if (result.affectedRows === 0) throw new HttpError(404, 'המשתמש לא נמצא');

  logger.warn('סיסמה אופסה על ידי מנהל', { userId: id, by: req.user.username });
  res.json({ id, mustChangePassword: true });
}));

module.exports = router;
