'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * סדר ההרשאות. תפקיד גבוה יורש את כל מה שמתחתיו.
 * counter  - קורא, ומזין שורות ספירה בלבד
 * manager  - בנוסף: קטלוג, מחירים, מקדמי יחידות, סגירת ספירה, דוחות
 * admin    - בנוסף: ניהול משתמשים
 */
const ROLE_RANK = Object.freeze({ counter: 1, manager: 2, admin: 3 });

/** מוודא טוקן תקין ומצמיד את המשתמש ל-req.user */
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'ההתחברות פגה, יש להתחבר מחדש' });
  }
}

/** דורש תפקיד מינימלי. חייב לרוץ אחרי requireAuth */
function requireRole(minimumRole) {
  const required = ROLE_RANK[minimumRole];

  return (req, res, next) => {
    const actual = ROLE_RANK[req.user?.role] || 0;

    if (actual < required) {
      return res.status(403).json({ error: 'אין לך הרשאה לפעולה הזו' });
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole, ROLE_RANK };
