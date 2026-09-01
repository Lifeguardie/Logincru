'use strict';

const { ZodError } = require('zod');
const logger = require('../logger');
const config = require('../config');

/** שגיאה עם קוד HTTP מכוון, לשימוש ב-routes */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** עוטף route אסינכרוני כך ששגיאה תגיע ל-error handler ולא תיפול כ-unhandled rejection */
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** 404 לנתיבי API שלא קיימים */
function notFound(req, res) {
  res.status(404).json({ error: 'הנתיב לא נמצא' });
}

// eslint-disable-next-line no-unused-vars -- express מזהה error handler לפי 4 הפרמטרים
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({ error: 'נתונים לא תקינים', details });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  // הפרות אילוצים של MySQL - מתורגמות להודעה שהמשתמש יכול להבין
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'הערך כבר קיים במערכת' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(400).json({ error: 'אחד הערכים שנשלחו מפנה לרשומה שלא קיימת' });
  }
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    return res.status(409).json({ error: 'אי אפשר למחוק - יש רשומות שתלויות בזה' });
  }

  logger.error('שגיאה לא מטופלת', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  return res.status(500).json({
    error: 'שגיאת שרת',
    ...(config.isProduction ? {} : { detail: err.message }),
  });
}

module.exports = { HttpError, asyncRoute, notFound, errorHandler };
