'use strict';

/**
 * הגנה מניחושי סיסמה: עד 10 כשלונות ל-15 דקות לכל צירוף של שם משתמש + כתובת.
 * בזיכרון, בלי תלות חיצונית - מספיק לשרת יחיד של מסעדה.
 * המפתח כולל גם את שם המשתמש כדי שתוקף מכתובת אחת לא ינעל את כולם,
 * וגם את הכתובת כדי שלא ינעל משתמש ספציפי מכל מקום.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map();
let lastPrune = Date.now();

function keyFor(req) {
  const username = String(req.body?.username || '').trim().toLowerCase();
  return `${username}|${req.ip}`;
}

/** מנקה רשומות ישנות אחת לכמה דקות, כדי שהמפה לא תגדל לנצח */
function prune(now) {
  if (now - lastPrune < 60 * 1000) return;
  lastPrune = now;
  for (const [key, entry] of failures) {
    if (now - entry.firstAt >= WINDOW_MS) failures.delete(key);
  }
}

function loginLimiter(req, res, next) {
  const now = Date.now();
  prune(now);

  const entry = failures.get(keyFor(req));
  if (entry && entry.count >= MAX_FAILURES && now - entry.firstAt < WINDOW_MS) {
    const retrySeconds = Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retrySeconds));
    return res.status(429).json({
      error: `יותר מדי ניסיונות התחברות. נסה שוב בעוד ${Math.max(1, Math.ceil(retrySeconds / 60))} דקות`,
    });
  }

  return next();
}

function recordFailure(req) {
  const key = keyFor(req);
  const now = Date.now();
  const entry = failures.get(key);

  if (!entry || now - entry.firstAt >= WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clearFailures(req) {
  failures.delete(keyFor(req));
}

module.exports = { loginLimiter, recordFailure, clearFailures, MAX_FAILURES, WINDOW_MS };
