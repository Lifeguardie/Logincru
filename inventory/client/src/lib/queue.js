/**
 * תור שמירה עמיד לרשת.
 *
 * במחסן ובמקררים אין קליטה. אם הזנה תלך לאיבוד כשהרשת נופלת,
 * הסופר לא ידע על זה והספירה תצא שגויה. לכן כל הזנה נכנסת קודם
 * ל-localStorage, ורק אחר כך נשלחת. היא נמחקת מהתור רק אחרי
 * שהשרת אישר אותה.
 *
 * הזנה חוזרת לאותו פריט+יחידה דורסת את הקודמת בתור - שולחים
 * את הערך האחרון בלבד ולא היסטוריה של הקלדות ביניים.
 */

import { api, ApiError, getToken } from './api';

const STORAGE_KEY = 'inventory.pendingLines';
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

let retryTimer = null;
let retryAttempt = 0;
let flushing = false;
const listeners = new Set();

function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function writeQueue(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (_) {
    // אחסון מלא או חסום. לא מפילים את המסך - השליחה הרגילה עדיין תעבוד.
  }
}

function notify() {
  const state = { pending: readQueue().length, flushing };
  for (const listener of listeners) listener(state);
}

/** נרשם לשינויים במצב התור, כדי להציג חיווי למשתמש */
export function subscribe(listener) {
  listeners.add(listener);
  listener({ pending: readQueue().length, flushing });
  return () => listeners.delete(listener);
}

export function pendingCount() {
  return readQueue().length;
}

const keyOf = (line) => `${line.countId}:${line.itemId}:${line.locationId}:${line.itemUnitId}`;

/** מוסיף הזנה לתור ומפעיל שליחה. ההזנה האחרונה לאותו שדה מנצחת. */
export function enqueue(line) {
  const entries = readQueue().filter((entry) => keyOf(entry) !== keyOf(line));
  entries.push({ ...line, queuedAt: Date.now() });
  writeQueue(entries);
  notify();
  flush();
}

function scheduleRetry() {
  if (retryTimer) return;

  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
  retryAttempt += 1;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    flush();
  }, delay);
}

/**
 * שולח את התור לשרת. שולח את כל השורות של אותה ספירה באצווה אחת.
 * @returns {Promise<{sent:number, failed:boolean}>}
 */
export async function flush() {
  if (flushing) return { sent: 0, failed: false };

  const entries = readQueue();
  if (entries.length === 0) {
    retryAttempt = 0;
    return { sent: 0, failed: false };
  }

  flushing = true;
  notify();

  // מקבצים לפי ספירה - ה-API מקבל אצווה אחת לכל ספירה
  const byCount = new Map();
  for (const entry of entries) {
    if (!byCount.has(entry.countId)) byCount.set(entry.countId, []);
    byCount.get(entry.countId).push(entry);
  }

  let sent = 0;
  let failed = false;
  let remaining = [...entries];

  for (const [countId, group] of byCount) {
    const payload = group.map((entry) => ({
      itemId: entry.itemId,
      locationId: entry.locationId,
      itemUnitId: entry.itemUnitId,
      quantityEntered: entry.quantityEntered,
      tareUnits: entry.tareUnits ?? 1,
    }));

    try {
      await api.saveLines(countId, payload);
      const sentKeys = new Set(group.map(keyOf));
      remaining = remaining.filter((entry) => !sentKeys.has(keyOf(entry)));
      sent += group.length;
    } catch (err) {
      // 401/403/429 חולפים: הטוקן יתחדש בהתחברות מחדש, וחסימת קצב משתחררת.
      // מחיקת ההזנות במקרים האלה הייתה מאבדת ספירה שכבר הוקלדה.
      const isRecoverable = [401, 403, 408, 429].includes(err.status);

      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && !isRecoverable) {
        // 4xx שלא ייפתר בניסיון חוזר (הספירה נסגרה, יחידת הספירה נמחקה).
        // מוציאים מהתור כדי שלא ייתקע לנצח, ומדווחים למשתמש.
        const stuckKeys = new Set(group.map(keyOf));
        remaining = remaining.filter((entry) => !stuckKeys.has(keyOf(entry)));
        failed = true;
        console.error('שורות נדחו על ידי השרת', err.message);
      } else {
        failed = true;
      }
    }
  }

  writeQueue(remaining);
  flushing = false;
  notify();

  if (remaining.length > 0) scheduleRetry();
  else retryAttempt = 0;

  return { sent, failed };
}

/** מנקה את התור. לשימוש אחרי התנתקות בלבד. */
export function clearQueue() {
  writeQueue([]);
  notify();
}

/** שליחה רק אם יש טוקן. בלעדיו הבקשה תיפול ב-401 ותזרוק למסך ההתחברות. */
function flushIfAuthenticated() {
  if (getToken()) flush();
}

// כשהרשת חוזרת או שחוזרים ללשונית - מנסים מיד ולא מחכים לטיימר
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { retryAttempt = 0; flushIfAuthenticated(); });
  window.addEventListener('focus', () => flushIfAuthenticated());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushIfAuthenticated();
  });

  // בטעינת האפליקציה: מרוקנים תור שנשאר מסשן קודם.
  // סופר שסגר את האפליקציה במחסן בלי רשת ופתח אותה שוב ליד הראוטר
  // צריך שההזנות שלו יישלחו בלי שיצטרך לגעת בכלום.
  setTimeout(flushIfAuthenticated, 800);

  // אזהרה לפני סגירת הדף עם הזנות שלא נשלחו
  window.addEventListener('beforeunload', (event) => {
    if (readQueue().length > 0) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
