'use strict';

/**
 * הגנה מניחושי סיסמה: עד 10 כשלונות ל-15 דקות לכל צירוף של שם משתמש + כתובת.
 * בזיכרון, בלי תלות חיצונית - מספיק לשרת יחיד של מסעדה.
 * המפתח כולל גם את שם המשתמש כדי שתוקף מכתובת אחת לא ינעל את כולם,
 * וגם את הכתובת כדי שלא ינעל משתמש ספציפי מכל מקום.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;          // לכל שם משתמש + כתובת
const MAX_PER_USERNAME = 30;      // לכל שם משתמש מכל הכתובות יחד - נגד סבב כתובות מזויפות

const failures = new Map();
const failuresByUser = new Map();
let lastPrune = Date.now();

function usernameOf(req) {
  return String(req.body?.username || '').trim().toLowerCase();
}

function keyFor(req) {
  return `${usernameOf(req)}|${req.ip}`;
}

/** מנקה רשומות ישנות אחת לכמה דקות, כדי שהמפה לא תגדל לנצח */
function prune(now) {
  if (now - lastPrune < 60 * 1000) return;
  lastPrune = now;
  for (const map of [failures, failuresByUser]) {
    for (const [key, entry] of map) {
      if (now - entry.firstAt >= WINDOW_MS) map.delete(key);
    }
  }
}

function isLocked(entry, limit, now) {
  return Boolean(entry) && entry.count >= limit && now - entry.firstAt < WINDOW_MS;
}

function bump(map, key, now) {
  const entry = map.get(key);
  if (!entry || now - entry.firstAt >= WINDOW_MS) map.set(key, { count: 1, firstAt: now });
  else entry.count += 1;
}

function loginLimiter(req, res, next) {
  const now = Date.now();
  prune(now);

  const perAddress = failures.get(keyFor(req));
  const perUser = failuresByUser.get(usernameOf(req));
  const entry = isLocked(perAddress, MAX_FAILURES, now) ? perAddress
    : isLocked(perUser, MAX_PER_USERNAME, now) ? perUser : null;

  if (entry) {
    const retrySeconds = Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retrySeconds));
    return res.status(429).json({
      error: `יותר מדי ניסיונות התחברות. נסה שוב בעוד ${Math.max(1, Math.ceil(retrySeconds / 60))} דקות`,
    });
  }

  return next();
}

function recordFailure(req) {
  const now = Date.now();
  bump(failures, keyFor(req), now);
  bump(failuresByUser, usernameOf(req), now);
}

function clearFailures(req) {
  failures.delete(keyFor(req));
  failuresByUser.delete(usernameOf(req));
}

module.exports = { loginLimiter, recordFailure, clearFailures, MAX_FAILURES, MAX_PER_USERNAME, WINDOW_MS };
