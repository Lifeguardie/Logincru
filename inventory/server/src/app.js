'use strict';

const path = require('path');
const express = require('express');

const logger = require('./logger');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const itemsRoutes = require('./routes/items');
const countsRoutes = require('./routes/counts');
const purchasesRoutes = require('./routes/purchases');
const importsRoutes = require('./routes/imports');
const reportsRoutes = require('./routes/reports');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));

// לוג בקשות. סיסמאות לעולם לא נכנסות ללוג - רק method, path וסטטוס.
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/api')) {
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - startedAt,
      });
    }
  });
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/counts', countsRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/reports', reportsRoutes);

app.use('/api', notFound);

// הלקוח מוגש מאותו שרת, ולכן אין CORS ואין צורך בהגדרת origin
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));

// כל נתיב שאינו API מוחזר ל-index.html כדי ש-React Router יטפל בו
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(errorHandler);

module.exports = app;
