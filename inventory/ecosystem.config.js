// PM2 - מערכת המלאי רצה כתהליך נפרד לחלוטין, בפורט משלה.
module.exports = {
  apps: [
    {
      name: 'inventory',
      script: 'server/src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      time: true,
    },
  ],
};
