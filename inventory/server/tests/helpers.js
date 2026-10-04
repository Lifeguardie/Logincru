'use strict';

/**
 * תשתית משותפת לבדיקות API: DB ייעודי לכל קובץ בדיקה, מיגרציות, זריעה,
 * והרמת app.js בתוך התהליך. חייב להיקרא לפני כל require של config/db.
 */

const mysql = require('mysql2/promise');

function harness(dbName, { demo = false } = {}) {
  process.env.DB_NAME = dbName;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';

  const config = require('../src/config');
  const state = { server: null, base: null, dbAvailable: false };

  /** קריאה ל-API. מחזיר {status, body, headers} ולא זורק, כדי לבדוק גם שגיאות */
  async function call(method, path, { body, token, headers: extra } = {}) {
    const headers = { ...(extra || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${state.base}/api${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
    return { status: response.status, body: payload, headers: response.headers };
  }

  async function before() {
    try {
      const conn = await mysql.createConnection({
        host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password,
      });
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await conn.end();
    } catch (_) {
      return; // dbAvailable נשאר false - הבדיקות ידלגו
    }

    const { runMigrations } = require('../scripts/migrate');
    const { runSeed } = require('../scripts/seed');
    await runMigrations({ log: () => {} });
    await runSeed({ demo, log: () => {} });
    state.dbAvailable = true;

    const app = require('../src/app');
    state.server = app.listen(0);
    state.base = `http://127.0.0.1:${state.server.address().port}`;
  }

  async function after() {
    if (state.server) await new Promise((resolve) => state.server.close(resolve));
    if (state.dbAvailable) await require('../src/db').pool.end();
  }

  const skipIfNoDb = (t) => {
    if (!state.dbAvailable) { t.skip('אין MariaDB זמין'); return true; }
    return false;
  };

  /** ה-admin מהזריעה חייב להחליף סיסמה - מחליף ומחזיר טוקן פתוח */
  async function adminToken(newPassword = 'Admin-Test-2026') {
    const first = (await call('POST', '/auth/login', { body: { username: 'admin', password: 'admin1234' } })).body;
    const changed = await call('PUT', '/auth/password', {
      token: first.token, body: { currentPassword: 'admin1234', newPassword },
    });
    return changed.body.token;
  }

  return { call, before, after, skipIfNoDb, adminToken, state };
}

module.exports = { harness };
