module.exports = {
  apps: [
    {
      name: 'aliexpress-bot',
      script: 'src/scheduler.js',
      autorestart: true,
      watch: false,
      // Safety net: never let the bot grow enough to affect other apps (ShiftMate) on the box
      max_memory_restart: '150M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
