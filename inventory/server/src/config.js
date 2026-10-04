'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

/** ממיר משתנה סביבה למספר, עם ערך ברירת מחדל אם חסר או לא תקין */
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;

if (isProduction && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET חסר או קצר מדי. צור סוד באורך 32 תווים לפחות: openssl rand -hex 32');
}

module.exports = {
  isProduction,
  port: num(process.env.PORT, 4010),
  jwt: {
    secret: jwtSecret || 'dev-only-insecure-secret-do-not-use-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'resto_inventory',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10),
  },
  ocr: {
    // זיהוי מצילום. בלי מפתח API הפיצ'ר מכובה והמסך מסביר למה.
    enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: process.env.OCR_MODEL || 'claude-opus-5-5',
    effort: process.env.OCR_EFFORT || 'high',
    maxImageBytes: num(process.env.OCR_MAX_IMAGE_BYTES, 8 * 1024 * 1024),
  },
  business: {
    varianceAlertPercent: num(process.env.VARIANCE_ALERT_PERCENT, 25),
    maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  },
};
