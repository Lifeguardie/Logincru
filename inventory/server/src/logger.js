'use strict';

const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');
const logFile = path.join(logsDir, 'inventory.log');

fs.mkdirSync(logsDir, { recursive: true });

/** כותב שורת לוג לקונסול ולקובץ. שגיאת כתיבה לקובץ לעולם לא מפילה את השרת */
function write(level, message, meta) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  });

  if (level === 'error') console.error(line);
  else console.log(line);

  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (_) {
    // דיסק מלא או הרשאות - ממשיכים, הקונסול כבר קיבל את השורה
  }
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
