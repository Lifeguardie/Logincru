'use strict';

/**
 * מריץ מיגרציות SQL לפי סדר שמות הקבצים ב-migrations/.
 * הרצה חוזרת בטוחה: כל מיגרציה שכבר רצה מדולגת.
 *
 * שימוש: npm run migrate
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const migrationsDir = path.join(__dirname, '..', 'migrations');

/**
 * מפצל קובץ SQL להצהרות נפרדות.
 * mysql2 לא מריץ multi-statement בברירת מחדל, ואנחנו לא מדליקים את זה -
 * ריצה הצהרה-הצהרה נותנת שגיאה שמצביעה על ההצהרה הבעייתית.
 * מסיר הערות שורה (--) כדי שנקודה-פסיק בתוך הערה לא תפצל באמצע.
 */
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function runMigrations({ log = console.log } = {}) {
  // מתחברים בלי לבחור DB כדי שנוכל ליצור אותו אם הוא לא קיים
  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4_unicode_ci',
  });

  // שם ה-DB מגיע מקובץ .env של המפעיל ולא מקלט משתמש, אבל בכל זאת
  // מוודאים שהוא מכיל רק תווים חוקיים - identifier לא יכול לעבור כ-placeholder.
  const dbName = config.db.database;
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
    throw new Error(`שם מסד נתונים לא חוקי: ${dbName}`);
  }

  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: dbName,
    charset: 'utf8mb4_unicode_ci',
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [applied] = await conn.execute('SELECT filename FROM schema_migrations');
  const alreadyApplied = new Set(applied.map((row) => row.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let ranCount = 0;

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      log(`דילוג (כבר רץ): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);

    log(`מריץ: ${file} (${statements.length} הצהרות)`);

    // DDL ב-MySQL עושה commit implicit, ולכן טרנזקציה כאן לא באמת מגנה.
    // במקום זה: אם הצהרה נכשלת עוצרים מיד ולא מסמנים את המיגרציה כהושלמה.
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        console.error(`\nכשל ב-${file}:\n${statement.slice(0, 300)}\n`);
        throw err;
      }
    }

    await conn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    ranCount += 1;
  }

  await conn.end();

  log(ranCount === 0 ? '\nאין מיגרציות חדשות.' : `\nהושלמו ${ranCount} מיגרציות.`);
  return ranCount;
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('המיגרציה נכשלה:', err.message);
    process.exit(1);
  });
}
