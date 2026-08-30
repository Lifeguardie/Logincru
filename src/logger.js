const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bot.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function write(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => (a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ')}`;
  // eslint-disable-next-line no-console
  console[level === 'ERROR' ? 'error' : 'log'](line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* logging must never crash the bot */
  }
}

module.exports = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
};
