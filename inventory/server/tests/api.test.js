'use strict';

/**
 * בדיקות API מקצה לקצה על מסד נתונים ייעודי לבדיקות.
 * מריץ את app.js בתוך התהליך, יוצר DB נקי, זורע נתוני דמו, ומדבר איתו ב-HTTP.
 * מדלג על הכל אם אין MariaDB זמין.
 */

process.env.DB_NAME = 'resto_inventory_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const config = require('../src/config');
const { runMigrations } = require('../scripts/migrate');
const { runSeed } = require('../scripts/seed');

let server;
let base;
let dbAvailable = false;
let admin;
let counter;

/** קריאה ל-API. מחזיר {status, body} ולא זורק, כדי לבדוק גם שגיאות */
async function call(method, path, { body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${base}/api${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const text = await response.text();
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { status: response.status, body: payload };
}

const skipIfNoDb = (t) => { if (!dbAvailable) { t.skip('אין MariaDB זמין'); return true; } return false; };

test.before(async () => {
  // DB נקי בכל ריצה
  try {
    const conn = await mysql.createConnection({
      host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
    });
    await conn.query('DROP DATABASE IF EXISTS resto_inventory_test');
    await conn.end();
  } catch (_) {
    return; // dbAvailable נשאר false
  }

  await runMigrations({ log: () => {} });
  await runSeed({ demo: true, log: () => {} });
  dbAvailable = true;

  const app = require('../src/app');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  admin = (await call('POST', '/auth/login', { body: { username: 'admin', password: 'admin1234' } })).body.token;

  // משתמש counter לבדיקת הרשאות
  const bcrypt = require('bcryptjs');
  const db = require('../src/db');
  await db.query(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
    ['sofer', await bcrypt.hash('counter123', 10), 'דני הסופר', 'counter']
  );
  counter = (await call('POST', '/auth/login', { body: { username: 'sofer', password: 'counter123' } })).body.token;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dbAvailable) await require('../src/db').pool.end();
});

test('התחברות: נכון 200, שגוי 401, בלי טוקן 401', async (t) => {
  if (skipIfNoDb(t)) return;
  assert.ok(admin, 'התקבל טוקן');
  assert.equal((await call('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } })).status, 401);
  assert.equal((await call('GET', '/items')).status, 401);
});

test('הרשאות: counter קורא אבל לא עורך, לא פותח ולא סוגר', async (t) => {
  if (skipIfNoDb(t)) return;
  assert.equal((await call('GET', '/items', { token: counter })).status, 200);
  assert.equal((await call('POST', '/items', { token: counter, body: { name: 'x', baseUnit: 'kg' } })).status, 403);
  assert.equal((await call('POST', '/counts', { token: counter, body: { name: 'x', countDate: '2026-01-01' } })).status, 403);
  assert.equal((await call('PUT', '/items/2', { token: counter, body: { name: 'x', baseUnit: 'kg', pricePerBaseUnit: 999, locationIds: [] } })).status, 403);
});

let firstCountId;

test('ספירה מלאה: פתיחה -> שורות -> דף -> התקדמות -> סגירה -> סיכום', async (t) => {
  if (skipIfNoDb(t)) return;

  const created = await call('POST', '/counts', { token: admin, body: { name: 'ספירה א', countDate: '2026-08-31' } });
  assert.equal(created.status, 201);
  firstCountId = created.body.id;

  // ספירה פתוחה שנייה - אסורה
  assert.equal((await call('POST', '/counts', { token: admin, body: { name: 'ב', countDate: '2026-09-01' } })).status, 409);

  // שניצל: 2 ארגז (יחידה 5) + 7 יחידות (יחידה 4) במקפיא (אזור 5). counter מותר לו להזין.
  const saved = await call('PUT', `/counts/${firstCountId}/lines`, {
    token: counter,
    body: { lines: [
      { itemId: 2, locationId: 5, itemUnitId: 5, quantityEntered: 2 },
      { itemId: 2, locationId: 5, itemUnitId: 4, quantityEntered: 7 },
    ] },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.saved[0].quantityBase, 10);
  assert.equal(saved.body.saved[1].lineValue, 56.7);

  const sheet = await call('GET', `/counts/${firstCountId}/sheet?locationId=5`, { token: counter });
  const schnitzel = sheet.body.items.find((item) => item.id === 2);
  assert.equal(schnitzel.entries.length, 2, 'שתי הזנות לאותו פריט באותו אזור');
  assert.equal(schnitzel.units.length, 3);

  const progress = await call('GET', `/counts/${firstCountId}/progress`, { token: counter });
  const freezer = progress.body.find((row) => row.locationId === 5);
  assert.equal(freezer.countedItems, 1);
  assert.equal(freezer.totalValue, 506.7);

  // יחידה שלא שייכת לפריט - נדחית
  assert.equal((await call('PUT', `/counts/${firstCountId}/lines`, {
    token: admin, body: { itemId: 2, locationId: 5, itemUnitId: 1, quantityEntered: 1 },
  })).status, 400);

  // סגירה: counter לא יכול, מנהל כן
  assert.equal((await call('POST', `/counts/${firstCountId}/close`, { token: counter })).status, 403);
  const closed = await call('POST', `/counts/${firstCountId}/close`, { token: admin });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.totalValue, 506.7);

  // אחרי סגירה: אין כתיבה, אין סגירה כפולה
  assert.equal((await call('PUT', `/counts/${firstCountId}/lines`, {
    token: admin, body: { itemId: 2, locationId: 5, itemUnitId: 4, quantityEntered: 1 },
  })).status, 409);
  assert.equal((await call('POST', `/counts/${firstCountId}/close`, { token: admin })).status, 409);

  const summary = await call('GET', `/counts/${firstCountId}/summary`, { token: counter });
  assert.equal(summary.body.totalValue, 506.7);
  assert.equal(summary.body.byCategory[0].name, 'בשר ועוף');
  assert.equal(summary.body.comparison, null, 'אין ספירה קודמת');
});

test('עדכון מחיר בקטלוג לא משנה ספירה סגורה', async (t) => {
  if (skipIfNoDb(t)) return;

  const item = (await call('GET', '/items/2', { token: admin })).body;
  const updated = await call('PUT', '/items/2', {
    token: admin,
    body: { ...item, pricePerBaseUnit: 60 },
  });
  assert.equal(updated.status, 200);

  const summary = await call('GET', `/counts/${firstCountId}/summary`, { token: admin });
  assert.equal(summary.body.totalValue, 506.7, 'המחיר נשמר כתמונת מצב');

  await call('PUT', '/items/2', { token: admin, body: { ...item, pricePerBaseUnit: 45 } });
});

test('רכש + ספירה שנייה -> צריכה = פתיחה + רכש - סגירה, והשוואה עם חריגה', async (t) => {
  if (skipIfNoDb(t)) return;

  assert.equal((await call('POST', '/purchases', {
    token: admin, body: { itemId: 2, purchaseDate: '2026-09-05', quantityBase: 20, totalCost: 900 },
  })).status, 201);

  const second = (await call('POST', '/counts', { token: admin, body: { name: 'ספירה ב', countDate: '2026-09-15' } })).body.id;
  await call('PUT', `/counts/${second}/lines`, {
    token: admin, body: { itemId: 2, locationId: 5, itemUnitId: 3, quantityEntered: 8, source: 'ocr' },
  });
  await call('POST', `/counts/${second}/close`, { token: admin });

  const report = await call('GET', `/reports/consumption?openingCountId=${firstCountId}&closingCountId=${second}`, { token: admin });
  assert.equal(report.status, 200);
  const row = report.body.items.find((r) => r.itemId === 2);
  assert.equal(row.consumedQuantity, 23.26, '11.26 + 20 - 8');
  assert.equal(row.consumedCost, 1046.7, '506.70 + 900 - 360');

  const summary = await call('GET', `/counts/${second}/summary`, { token: admin });
  assert.equal(summary.body.comparison.previousCount.id, firstCountId);
  const change = summary.body.comparison.changes.find((c) => c.itemId === 2);
  assert.equal(change.percentChange, -29);
  assert.equal(change.isVariance, true, 'ירידה של 29% מעל סף 25%');

  // המקור נשמר
  const sheet = await call('GET', `/counts/${second}/sheet?locationId=5`, { token: admin });
  assert.ok(sheet.body.items[0].entries.length > 0);
});

test('מחיקת ספירה: פתוחה נמחקת, סגורה לא', async (t) => {
  if (skipIfNoDb(t)) return;

  const open = (await call('POST', '/counts', { token: admin, body: { name: 'בטעות', countDate: '2026-10-01' } })).body.id;
  await call('PUT', `/counts/${open}/lines`, { token: admin, body: { itemId: 2, locationId: 5, itemUnitId: 4, quantityEntered: 3 } });

  assert.equal((await call('DELETE', `/counts/${open}`, { token: counter })).status, 403);
  assert.equal((await call('DELETE', `/counts/${open}`, { token: admin })).status, 204);
  assert.equal((await call('GET', `/counts/${open}/summary`, { token: admin })).status, 404);

  assert.equal((await call('DELETE', `/counts/${firstCountId}`, { token: admin })).status, 409, 'סגורה לא נמחקת');
  assert.equal((await call('DELETE', '/counts/99999', { token: admin })).status, 404);
});

test('עריכת פריט לא מערבבת את סדר הדף', async (t) => {
  if (skipIfNoDb(t)) return;

  const location = (await call('POST', '/locations', { token: admin, body: { name: 'מדף בדיקה' } })).body.id;
  const ids = [];
  for (const name of ['ראשון', 'שני', 'שלישי']) {
    ids.push((await call('POST', '/items', {
      token: admin, body: { name: `פריט ${name}`, baseUnit: 'unit', pricePerBaseUnit: 1, locationIds: [location] },
    })).body.id);
  }

  const order = async () => (await call('GET', `/items?locationId=${location}`, { token: admin })).body.items
    .map((i) => i.id);
  // סדר הדף נקבע לפי sort_order, שנבדק דרך דף הספירה
  const open = (await call('POST', '/counts', { token: admin, body: { name: 'סדר', countDate: '2026-10-02' } })).body.id;
  const sheetOrder = async () => (await call('GET', `/counts/${open}/sheet?locationId=${location}`, { token: admin })).body.items.map((i) => i.id);

  assert.deepEqual(await sheetOrder(), ids, 'פריטים חדשים מצטרפים בסוף, לפי סדר היצירה');

  // עריכת שם של הפריט הראשון - חייבת להשאיר אותו ראשון
  const first = (await call('GET', `/items/${ids[0]}`, { token: admin })).body;
  await call('PUT', `/items/${ids[0]}`, { token: admin, body: { ...first, name: 'פריט ראשון (ערוך)' } });
  assert.deepEqual(await sheetOrder(), ids, 'עריכת שם לא הזיזה את הפריט');

  // הסרה מהאזור והחזרה - חוזר לסוף
  await call('PUT', `/items/${ids[0]}`, { token: admin, body: { ...first, locationIds: [] } });
  assert.deepEqual(await sheetOrder(), [ids[1], ids[2]]);
  await call('PUT', `/items/${ids[0]}`, { token: admin, body: { ...first, locationIds: [location] } });
  assert.deepEqual(await sheetOrder(), [ids[1], ids[2], ids[0]], 'פריט שחזר מצטרף בסוף');

  await call('DELETE', `/counts/${open}`, { token: admin });
  assert.ok(await order());
});

test('פריט מושבת: נעלם מהרשימה, חוזר עם includeInactive=true, ו-"false" הוא באמת false', async (t) => {
  if (skipIfNoDb(t)) return;

  const item = (await call('GET', '/items/6', { token: admin })).body;
  await call('PUT', '/items/6', { token: admin, body: { ...item, active: false } });

  const has = (list) => list.body.items.some((i) => i.id === 6);
  assert.equal(has(await call('GET', '/items', { token: admin })), false);
  assert.equal(has(await call('GET', '/items?includeInactive=false', { token: admin })), false, 'המחרוזת "false" לא מתפרשת כ-true');
  assert.equal(has(await call('GET', '/items?includeInactive=true', { token: admin })), true);
  assert.equal((await call('GET', '/items?includeInactive=yes', { token: admin })).status, 400);

  await call('PUT', '/items/6', { token: admin, body: { ...item, active: true } });
});

test('יחידות ספירה: אי אפשר למחוק את האחרונה', async (t) => {
  if (skipIfNoDb(t)) return;

  const created = (await call('POST', '/items', {
    token: admin, body: { name: 'פריט עם יחידה אחת', baseUnit: 'kg', pricePerBaseUnit: 10, locationIds: [] },
  })).body.id;
  const item = (await call('GET', `/items/${created}`, { token: admin })).body;
  assert.equal(item.units.length, 1, 'יחידת בסיס נוצרת אוטומטית');
  assert.equal((await call('DELETE', `/items/${created}/units/${item.units[0].id}`, { token: admin })).status, 400);

  const added = await call('POST', `/items/${created}/units`, { token: admin, body: { unitName: 'ארגז', factorToBase: 5 } });
  assert.equal(added.status, 201);
  assert.equal((await call('POST', `/items/${created}/units`, { token: admin, body: { unitName: 'שק', factorToBase: 0 } })).status, 400, 'מקדם אפס נדחה');
  assert.equal((await call('DELETE', `/items/${created}/units/${added.body.id}`, { token: admin })).status, 204);
});

test('פתיחה מחדש של ספירה סגורה', async (t) => {
  if (skipIfNoDb(t)) return;

  assert.equal((await call('POST', `/counts/${firstCountId}/reopen`, { token: counter })).status, 403);
  const reopened = await call('POST', `/counts/${firstCountId}/reopen`, { token: admin });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.status, 'open');
  assert.equal((await call('POST', `/counts/${firstCountId}/close`, { token: admin })).status, 200);
});
