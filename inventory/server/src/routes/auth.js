'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter, recordFailure, clearFailures } = require('../middleware/loginLimiter');
const { publicUser } = require('../services/userView');

const router = express.Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'נדרש שם משתמש'),
  password: z.string().min(1, 'נדרשת סיסמה'),
});

/**
 * חותם טוקן. הטוקן נושא רק זהות - תפקיד, סטטוס ודגל החלפת סיסמה נקראים
 * מה-DB בכל בקשה (ראו middleware/auth.js), ולכן לא נכנסים לכאן.
 */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);

  const user = await db.queryOne(
    `SELECT id, username, password_hash, full_name, role, active, must_change_password
       FROM users WHERE username = ?`,
    [username]
  );

  // אותה הודעה בדיוק לשם משתמש שגוי ולסיסמה שגויה, כדי לא לחשוף מי קיים במערכת.
  // ההשוואה רצה גם כשהמשתמש לא נמצא, כדי שזמן התגובה לא יסגיר את זה.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !user.active || !passwordMatches) {
    recordFailure(req);
    logger.warn('ניסיון התחברות נכשל', { username, ip: req.ip });
    throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
  }

  clearFailures(req);
  logger.info('התחברות מוצלחת', { userId: user.id, username: user.username });

  res.json({ token: signToken(user), user: publicUser(user) });
}));

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'נדרשת הסיסמה הנוכחית'),
  newPassword: z.string().min(8, 'הסיסמה החדשה חייבת להכיל לפחות 8 תווים').max(128),
});

/** החלפת סיסמה עצמית. מחזיר טוקן חדש בלי דגל חובת ההחלפה */
router.put('/password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = passwordSchema.parse(req.body);

  if (currentPassword === newPassword) {
    throw new HttpError(400, 'הסיסמה החדשה חייבת להיות שונה מהנוכחית');
  }

  const user = await db.queryOne(
    'SELECT id, username, password_hash, full_name, role, active FROM users WHERE id = ? AND active = 1',
    [req.user.id]
  );
  if (!user) throw new HttpError(401, 'המשתמש לא פעיל');

  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'הסיסמה הנוכחית שגויה');
  }

  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [await bcrypt.hash(newPassword, 10), user.id]
  );

  logger.info('סיסמה הוחלפה', { userId: user.id, username: user.username });

  const refreshed = { ...user, must_change_password: 0 };
  res.json({ token: signToken(refreshed), user: publicUser(refreshed) });
}));

/** מחזיר את המשתמש המחובר. הלקוח קורא לזה בטעינה כדי לאמת שהטוקן עוד תקף */
router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await db.queryOne(
    'SELECT id, username, full_name, role, must_change_password FROM users WHERE id = ? AND active = 1',
    [req.user.id]
  );

  if (!user) throw new HttpError(401, 'המשתמש לא פעיל');

  res.json({ user: publicUser(user) });
}));

module.exports = router;
