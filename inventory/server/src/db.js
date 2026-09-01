'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'Z',
  // מחזיר DECIMAL כמחרוזת ולא כ-float; אנחנו ממירים במפורש היכן שצריך
  decimalNumbers: false,
  namedPlaceholders: false,
});

/** שאילתה עם placeholders בלבד. אין הרכבת SQL ממחרוזות בשום מקום בקוד */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** מחזיר שורה אחת או null */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * מריץ פונקציה בתוך טרנזקציה. מקבל connection ומבצע commit/rollback אוטומטית.
 * שימוש: await transaction(async (conn) => { await conn.execute(...); });
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, transaction };
