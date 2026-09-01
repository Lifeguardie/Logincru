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

const router = express.Router();

const loginSchema = z.object({
  username: z.string().trim().min(1, 'נדרש שם משתמש'),
  password: z.string().min(1, 'נדרשת סיסמה'),
});

router.post('/login', asyncRoute(async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);

  const user = await db.queryOne(
    'SELECT id, username, password_hash, full_name, role, active FROM users WHERE username = ?',
    [username]
  );

  // אותה הודעה בדיוק לשם משתמש שגוי ולסיסמה שגויה, כדי לא לחשוף מי קיים במערכת.
  // ההשוואה רצה גם כשהמשתמש לא נמצא, כדי שזמן התגובה לא יסגיר את זה.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!user || !user.active || !passwordMatches) {
    logger.warn('ניסיון התחברות נכשל', { username });
    throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
  }

  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  logger.info('התחברות מוצלחת', { userId: user.id, username: user.username });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    },
  });
}));

/** מחזיר את המשתמש המחובר. הלקוח קורא לזה בטעינה כדי לאמת שהטוקן עוד תקף */
router.get('/me', requireAuth, asyncRoute(async (req, res) => {
  const user = await db.queryOne(
    'SELECT id, username, full_name, role FROM users WHERE id = ? AND active = 1',
    [req.user.id]
  );

  if (!user) throw new HttpError(401, 'המשתמש לא פעיל');

  res.json({
    user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role },
  });
}));

module.exports = router;
