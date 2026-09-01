'use strict';

const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const { pool } = require('./db');

const server = app.listen(config.port, () => {
  logger.info('שרת המלאי עלה', { port: config.port, env: process.env.NODE_ENV || 'development' });
});

/** סגירה מסודרת: מפסיקים לקבל בקשות חדשות, ואז סוגרים את ה-pool */
async function shutdown(signal) {
  logger.info('סגירה מסודרת', { signal });

  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      logger.error('שגיאה בסגירת ה-pool', { message: err.message });
    }
    process.exit(0);
  });

  // אם חיבור פתוח תקוע, לא נשארים תלויים לנצח
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: String(reason) });
});
