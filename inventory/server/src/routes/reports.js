'use strict';

/** דוחות: צריכה בין ספירות, וייצוא לאקסל */

const express = require('express');
const { z } = require('zod');

const valuation = require('../services/valuation');
const excel = require('../services/excel');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/** מקודד שם קובץ עברי ל-Content-Disposition לפי RFC 5987 */
function attachment(res, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
}

router.get('/consumption', asyncRoute(async (req, res) => {
  const query = z.object({
    openingCountId: z.coerce.number().int().positive(),
    closingCountId: z.coerce.number().int().positive(),
  }).parse(req.query);

  if (query.openingCountId === query.closingCountId) {
    throw new HttpError(400, 'יש לבחור שתי ספירות שונות');
  }

  const report = await valuation.buildConsumption(query.openingCountId, query.closingCountId);
  if (!report) throw new HttpError(404, 'אחת הספירות לא נמצאה');

  res.json(report);
}));

router.get('/consumption/export', asyncRoute(async (req, res) => {
  const query = z.object({
    openingCountId: z.coerce.number().int().positive(),
    closingCountId: z.coerce.number().int().positive(),
  }).parse(req.query);

  const report = await valuation.buildConsumption(query.openingCountId, query.closingCountId);
  if (!report) throw new HttpError(404, 'אחת הספירות לא נמצאה');

  attachment(res, `דוח צריכה ${report.opening.countDate} עד ${report.closing.countDate}.xlsx`);
  res.send(excel.buildConsumptionWorkbook(report));
}));

router.get('/counts/:id/export', asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);

  const summary = await valuation.buildSummary(countId);
  if (!summary) throw new HttpError(404, 'הספירה לא נמצאה');

  attachment(res, `ספירת מלאי - ${summary.count.name}.xlsx`);
  res.send(excel.buildCountWorkbook(summary));
}));

module.exports = router;
