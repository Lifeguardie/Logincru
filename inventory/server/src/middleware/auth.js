'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

/**
 * סדר ההרשאות. תפקיד גבוה יורש את כל מה שמתחתיו.
 * counter  - קורא, ומזין שורות ספירה בלבד
 * manager  - בנוסף: קטלוג, מחירים, מקדמי יחידות, סגירת ספירה, דוחות
 * admin    - בנוסף: ניהול משתמשים
 */
const ROLE_RANK = Object.freeze({ counter: 1, manager: 2, admin: 3 });

/**
 * מוודא טוקן תקין ומצמיד את המשתמש ל-req.user.
 *
 * התפקיד, הסטטוס ודגל החלפת הסיסמה נקראים מה-DB בכל בקשה ולא מהטוקן:
 * השבתת עובד, הורדת הרשאות או איפוס סיסמה על ידי מנהל חייבים לתפוס מיד,
 * לא בעוד 12 שעות כשהטוקן יפוג. שליפה אחת לפי מפתח ראשי - זניח.
 */
async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'נדרשת התחברות' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch (_) {
    return res.status(401).json({ error: 'ההתחברות פגה, יש להתחבר מחדש' });
  }

  let row;
  try {
    row = await db.queryOne(
      'SELECT username, role, active, must_change_password FROM users WHERE id = ?',
      [payload.sub]
    );
  } catch (err) {
    return next(err);
  }

  if (!row || !row.active) {
    return res.status(401).json({ error: 'המשתמש הושבת. יש לפנות למנהל' });
  }

  req.user = {
    id: payload.sub,
    username: row.username,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };

  // משתמש שחייב להחליף סיסמה יכול רק להחליף אותה (ולראות מי הוא).
  // נאכף בשרת ולא רק בלקוח, אחרת סיסמה זמנית הייתה נשארת לנצח.
  if (req.user.mustChangePassword && !req.originalUrl.startsWith('/api/auth')) {
    return res.status(403).json({
      error: 'יש להחליף סיסמה לפני המשך העבודה',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }

  return next();
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
