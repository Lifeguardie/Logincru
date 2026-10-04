'use strict';

/** אבטחה וחשבונות: חובת החלפת סיסמה, הגבלת ניסיונות, ניהול משתמשים */

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers');
const { MAX_FAILURES } = require('../src/middleware/loginLimiter');

const h = harness('resto_inventory_test_sec');
const { call, skipIfNoDb } = h;
const login = (username, password, headers) => call('POST', '/auth/login', { body: { username, password }, headers });

test.before(h.before);
test.after(h.after);

let admin;

test('ה-admin מהזריעה חייב להחליף סיסמה, ועד אז חסום מכל דבר חוץ מזה', async (t) => {
  if (skipIfNoDb(t)) return;

  const first = await login('admin', 'admin1234');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.mustChangePassword, true);
  const temp = first.body.token;

  const blocked = await call('GET', '/items', { token: temp });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await call('GET', '/auth/me', { token: temp })).status, 200, 'לראות מי אני - מותר');

  assert.equal((await call('PUT', '/auth/password', { token: temp, body: { currentPassword: 'wrong', newPassword: 'Str0ng-pass' } })).status, 400);
  assert.equal((await call('PUT', '/auth/password', { token: temp, body: { currentPassword: 'admin1234', newPassword: 'short' } })).status, 400);
  assert.equal((await call('PUT', '/auth/password', { token: temp, body: { currentPassword: 'admin1234', newPassword: 'admin1234' } })).status, 400, 'אותה סיסמה');

  const changed = await call('PUT', '/auth/password', { token: temp, body: { currentPassword: 'admin1234', newPassword: 'Str0ng-pass' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.user.mustChangePassword, false);
  admin = changed.body.token;

  assert.equal((await call('GET', '/items', { token: admin })).status, 200, 'הטוקן החדש פתוח');
  // הדגל נקרא מה-DB בכל בקשה, ולכן גם טוקן שהונפק לפני ההחלפה משתחרר מיד
  assert.equal((await call('GET', '/items', { token: temp })).status, 200, 'גם הטוקן הישן משוחרר - המצב נקרא מה-DB');
  assert.equal((await login('admin', 'admin1234')).status, 401, 'הסיסמה הישנה לא עובדת');
  assert.equal((await login('admin', 'Str0ng-pass')).body.user.mustChangePassword, false);
});

test('ניהול משתמשים: רק admin, יצירה, כפילות, עדכון, הגנה על מנהל אחרון ועל עצמי', async (t) => {
  if (skipIfNoDb(t)) return;

  const created = await call('POST', '/users', { token: admin, body: { username: 'moti', password: 'Temp-1234', fullName: 'מוטי המנהל', role: 'manager' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.mustChangePassword, true, 'סיסמה שמנהל קבע היא זמנית');
  const motiId = created.body.id;

  assert.equal((await call('POST', '/users', { token: admin, body: { username: 'moti', password: 'Temp-1234', fullName: 'x', role: 'counter' } })).status, 409, 'שם משתמש כפול');
  assert.equal((await call('POST', '/users', { token: admin, body: { username: 'bad name!', password: 'Temp-1234', fullName: 'x', role: 'counter' } })).status, 400);
  assert.equal((await call('POST', '/users', { token: admin, body: { username: 'ok', password: '123', fullName: 'x', role: 'counter' } })).status, 400, 'סיסמה קצרה');

  // מוטי מתחבר, חייב להחליף, מחליף, ואז לא רואה /users
  const motiTemp = (await login('moti', 'Temp-1234')).body.token;
  assert.equal((await call('GET', '/users', { token: motiTemp })).status, 403);
  const moti = (await call('PUT', '/auth/password', { token: motiTemp, body: { currentPassword: 'Temp-1234', newPassword: 'Moti-pass-1' } })).body.token;
  assert.equal((await call('GET', '/users', { token: moti })).status, 403, 'manager לא מנהל משתמשים');
  assert.equal((await call('GET', '/items', { token: moti })).status, 200);

  const list = await call('GET', '/users', { token: admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 2);

  // הגנות
  const me = list.body.find((u) => u.username === 'admin');
  assert.equal((await call('PUT', `/users/${me.id}`, { token: admin, body: { fullName: 'x', role: 'admin', active: false } })).status, 400, 'לא משביתים את עצמנו');
  assert.equal((await call('PUT', `/users/${me.id}`, { token: admin, body: { fullName: 'x', role: 'manager', active: true } })).status, 400, 'לא מורידים הרשאות לעצמנו');

  // מקדמים את מוטי ל-admin, ואז אפשר להוריד את ה-admin הראשון... אבל רק דרך admin אחר
  assert.equal((await call('PUT', `/users/${motiId}`, { token: admin, body: { fullName: 'מוטי', role: 'admin', active: true } })).status, 200);
  const motiAdmin = (await login('moti', 'Moti-pass-1')).body.token;
  assert.equal((await call('PUT', `/users/${me.id}`, { token: motiAdmin, body: { fullName: 'מנהל', role: 'manager', active: true } })).status, 200, 'יש admin אחר - מותר');
  // עכשיו מוטי הוא ה-admin היחיד - אסור להשבית אותו
  assert.equal((await call('PUT', `/users/${motiId}`, { token: motiAdmin, body: { fullName: 'מוטי', role: 'admin', active: false } })).status, 400);
  // מחזירים
  assert.equal((await call('PUT', `/users/${me.id}`, { token: motiAdmin, body: { fullName: 'מנהל מערכת', role: 'admin', active: true } })).status, 200);

  // איפוס סיסמה -> חובת החלפה
  assert.equal((await call('POST', `/users/${motiId}/reset-password`, { token: admin, body: { newPassword: 'Reset-9999' } })).status, 200);
  assert.equal((await login('moti', 'Moti-pass-1')).status, 401);
  assert.equal((await login('moti', 'Reset-9999')).body.user.mustChangePassword, true);

  // השבתה -> לא מתחבר
  assert.equal((await call('PUT', `/users/${motiId}`, { token: admin, body: { fullName: 'מוטי', role: 'manager', active: false } })).status, 200);
  assert.equal((await login('moti', 'Reset-9999')).status, 401);
});

test('השבתה, הורדת הרשאות ואיפוס סיסמה תופסים מיד, גם על טוקן קיים', async (t) => {
  if (skipIfNoDb(t)) return;

  const created = (await call('POST', '/users', { token: admin, body: { username: 'fired', password: 'Fired-1234', fullName: 'עובד לשעבר', role: 'manager' } })).body;
  const temp = (await login('fired', 'Fired-1234')).body.token;
  const live = (await call('PUT', '/auth/password', { token: temp, body: { currentPassword: 'Fired-1234', newPassword: 'Fired-5678' } })).body.token;
  const asManager = await call('POST', '/counts', { token: live, body: { name: 'x', countDate: '2026-01-01' } });
  assert.ok([201, 409].includes(asManager.status), 'manager פעיל עובר את ההרשאה ומגיע ללוגיקה');
  if (asManager.status === 201) await call('DELETE', `/counts/${asManager.body.id}`, { token: admin });

  // הורדה ל-counter - אותו טוקן מאבד הרשאות מנהל מיד
  await call('PUT', `/users/${created.id}`, { token: admin, body: { fullName: 'x', role: 'counter', active: true } });
  assert.equal((await call('POST', '/counts', { token: live, body: { name: 'x', countDate: '2026-01-01' } })).status, 403);
  assert.equal((await call('GET', '/items', { token: live })).status, 200, 'עדיין מחובר, רק בלי הרשאות מנהל');

  // איפוס סיסמה - אותו טוקן נחסם עד החלפה
  await call('POST', `/users/${created.id}/reset-password`, { token: admin, body: { newPassword: 'Reset-0000' } });
  const gated = await call('GET', '/items', { token: live });
  assert.equal(gated.status, 403);
  assert.equal(gated.body.code, 'PASSWORD_CHANGE_REQUIRED');

  // השבתה - אותו טוקן מת מיד
  await call('PUT', `/users/${created.id}`, { token: admin, body: { fullName: 'x', role: 'counter', active: false } });
  assert.equal((await call('GET', '/auth/me', { token: live })).status, 401);
  assert.equal((await call('GET', '/items', { token: live })).status, 401);
});

test('הגבלת ניסיונות: אחרי 10 כשלונות גם סיסמה נכונה נחסמת, משתמש אחר לא מושפע', async (t) => {
  if (skipIfNoDb(t)) return;

  await call('POST', '/users', { token: admin, body: { username: 'victim', password: 'Victim-123', fullName: 'קורבן', role: 'counter' } });

  for (let i = 0; i < MAX_FAILURES; i += 1) {
    assert.equal((await login('victim', 'nope')).status, 401);
  }
  const locked = await login('victim', 'Victim-123');
  assert.equal(locked.status, 429, 'סיסמה נכונה אבל נעול');
  assert.ok(locked.headers.get('retry-after'));
  assert.match(locked.body.error, /דקות/);

  assert.equal((await login('admin', 'Str0ng-pass')).status, 200, 'משתמש אחר מאותה כתובת לא נחסם');
});

test('בלי TRUST_PROXY, סבב כתובות ב-X-Forwarded-For לא עוקף את הנעילה', async (t) => {
  if (skipIfNoDb(t)) return;

  await call('POST', '/users', { token: admin, body: { username: 'spoofed', password: 'Spoof-1234', fullName: 'x', role: 'counter' } });

  for (let i = 0; i < MAX_FAILURES; i += 1) {
    const status = (await login('spoofed', 'nope', { 'X-Forwarded-For': `10.0.0.${i}` })).status;
    assert.equal(status, 401);
  }
  assert.equal((await login('spoofed', 'Spoof-1234', { 'X-Forwarded-For': '10.0.0.99' })).status, 429,
    'הכותרת מזויפת ולא נספרת - עדיין נעול');
});

test('CORS: מקור של אפליקציית Android מקבל כותרות, מקור זר לא', async (t) => {
  if (skipIfNoDb(t)) return;

  const preflight = await fetch(`${h.state.base}/api/items`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);

  const native = await call('GET', '/health', { headers: { Origin: 'capacitor://localhost' } });
  assert.equal(native.headers.get('access-control-allow-origin'), 'capacitor://localhost');

  const foreign = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.headers.get('access-control-allow-origin'), null, 'מקור זר לא מקבל CORS');
  const foreignPreflight = await fetch(`${h.state.base}/api/items`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.notEqual(foreignPreflight.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('כותרות אבטחה על תשובות API', async (t) => {
  if (skipIfNoDb(t)) return;
  const response = await call('GET', '/health');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
});
