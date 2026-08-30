// Long-running entry point (PM2): schedules runOnce per CRON_EXPRESSION.
const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');
const { runOnce } = require('./runOnce');
const { notifyAdmin } = require('./telegramPost');

if (!cron.validate(config.schedule.cronExpression)) {
  logger.error(`Invalid CRON_EXPRESSION: ${config.schedule.cronExpression}`);
  process.exit(1);
}

let running = false;
async function tick() {
  if (running) {
    logger.warn('Previous run still in progress, skipping this tick');
    return;
  }
  running = true;
  try {
    await runOnce();
  } catch (err) {
    logger.error('Scheduled run crashed:', err);
    await notifyAdmin(`ריצה מתוזמנת קרסה: ${err.message}`).catch(() => {});
  } finally {
    running = false;
  }
}

cron.schedule(config.schedule.cronExpression, tick);
logger.info(
  `Scheduler started: "${config.schedule.cronExpression}", ${config.schedule.postsPerRun} posts per run, channel ${config.telegram.channelId}`
);

// Optional: run immediately on boot with RUN_ON_START=1 (useful for first deploy)
if (process.env.RUN_ON_START === '1') tick();
