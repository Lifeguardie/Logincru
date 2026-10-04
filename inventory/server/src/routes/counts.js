'use strict';

/** ספירות מלאי: פתיחה, דף ספירה לפי אזור, הזנת שורות, סגירה וסיכום */

const express = require('express');
const { z } = require('zod');

const db = require('../db');
const units = require('../services/units');
const valuation = require('../services/valuation');
const ocr = require('../services/ocr');
const { loadLocationItems } = require('../services/sheet');
const config = require('../config');
const multer = require('multer');
const logger = require('../logger');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/** מוודא שהספירה קיימת ופתוחה לעריכה */
async function loadOpenCount(countId) {
  const count = await db.queryOne('SELECT id, name, status FROM counts WHERE id = ?', [countId]);

  if (!count) throw new HttpError(404, 'הספירה לא נמצאה');
  if (count.status === 'closed') {
    throw new HttpError(409, 'הספירה סגורה. אי אפשר לשנות אותה');
  }

  return count;
}

router.get('/', asyncRoute(async (req, res) => {
  const rows = await db.query(
    `SELECT c.id, c.name, c.count_date AS countDate, c.status, c.notes,
            c.total_value AS totalValue, c.closed_at AS closedAt,
            u.full_name AS createdByName,
            (SELECT COUNT(DISTINCT cl.item_id) FROM count_lines cl WHERE cl.count_id = c.id) AS countedItems
       FROM counts c
       LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.count_date DESC, c.id DESC
      LIMIT 100`
  );

  res.json(rows.map((row) => ({ ...row, totalValue: units.toNumber(row.totalValue) })));
}));

const createCountSchema = z.object({
  name: z.string().trim().min(1, 'נדרש שם לספירה').max(128),
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך בפורמט YYYY-MM-DD'),
  notes: z.string().trim().max(512).nullish().transform((v) => v || null),
});

router.post('/', requireRole('manager'), asyncRoute(async (req, res) => {
  const body = createCountSchema.parse(req.body);

  const open = await db.queryOne("SELECT id, name FROM counts WHERE status = 'open' LIMIT 1");
  if (open) {
    throw new HttpError(409, `כבר קיימת ספירה פתוחה: "${open.name}". יש לסגור אותה קודם`);
  }

  const result = await db.query(
    'INSERT INTO counts (name, count_date, notes, created_by) VALUES (?, ?, ?, ?)',
    [body.name, body.countDate, body.notes, req.user.id]
  );

  logger.info('נפתחה ספירה', { countId: result.insertId, by: req.user.username });
  res.status(201).json({ id: result.insertId, ...body, status: 'open' });
}));

/** התקדמות הספירה לפי אזור - כמה פריטים נספרו מתוך כמה משויכים */
router.get('/:id/progress', asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);

  const rows = await db.query(
    `SELECT l.id AS locationId, l.name AS locationName, l.sort_order AS sortOrder,
            COUNT(DISTINCT il.item_id) AS totalItems,
            COUNT(DISTINCT cl.item_id) AS countedItems,
            COALESCE(SUM(cl.line_value), 0) AS totalValue
       FROM locations l
       LEFT JOIN item_locations il ON il.location_id = l.id
       LEFT JOIN items i           ON i.id = il.item_id AND i.active = 1
       LEFT JOIN count_lines cl    ON cl.location_id = l.id AND cl.item_id = il.item_id
                                  AND cl.count_id = ?
      WHERE l.active = 1
      GROUP BY l.id, l.name, l.sort_order
      ORDER BY l.sort_order, l.name`,
    [countId]
  );

  res.json(rows.map((row) => ({
    ...row,
    totalValue: units.toNumber(row.totalValue),
  })));
}));

/**
 * דף הספירה של אזור אחד - שקול לדף הנייר.
 * מחזיר את הפריטים בסדר שנקבע ב-item_locations, עם כל יחידות הספירה
 * ועם מה שכבר הוזן, כדי שאפשר יהיה להמשיך ספירה שנקטעה.
 */
router.get('/:id/sheet', asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);
  const locationId = z.coerce.number().int().positive().parse(req.query.locationId);

  const count = await db.queryOne(
    'SELECT id, name, status FROM counts WHERE id = ?',
    [countId]
  );
  if (!count) throw new HttpError(404, 'הספירה לא נמצאה');

  const location = await db.queryOne('SELECT id, name FROM locations WHERE id = ?', [locationId]);
  if (!location) throw new HttpError(404, 'האזור לא נמצא');

  const items = await loadLocationItems(locationId);
  const itemIds = items.map((item) => item.id);
  let linesByItem = new Map();

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');

    const lineRows = await db.query(
      `SELECT cl.item_id AS itemId, cl.item_unit_id AS itemUnitId, cl.unit_name AS unitName,
              cl.quantity_entered AS quantityEntered, cl.tare_units AS tareUnits,
              cl.quantity_base AS quantityBase, cl.line_value AS lineValue,
              cl.counted_at AS countedAt, u.full_name AS countedByName
         FROM count_lines cl
         LEFT JOIN users u ON u.id = cl.counted_by
        WHERE cl.count_id = ? AND cl.location_id = ? AND cl.item_id IN (${placeholders})`,
      [countId, locationId, ...itemIds]
    );

    for (const row of lineRows) {
      if (!linesByItem.has(row.itemId)) linesByItem.set(row.itemId, []);
      linesByItem.get(row.itemId).push({
        itemUnitId: row.itemUnitId,
        unitName: row.unitName,
        quantityEntered: units.toNumber(row.quantityEntered),
        tareUnits: units.toNumber(row.tareUnits),
        quantityBase: units.toNumber(row.quantityBase),
        lineValue: units.toNumber(row.lineValue),
        countedAt: row.countedAt,
        countedByName: row.countedByName,
      });
    }
  }

  res.json({
    count: { id: count.id, name: count.name, status: count.status },
    location: { id: location.id, name: location.name },
    items: items.map((item) => ({
      ...item,
      entries: linesByItem.get(item.id) || [],
    })),
  });
}));

const lineSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  locationId: z.coerce.number().int().positive(),
  itemUnitId: z.coerce.number().int().positive(),
  // null מוחק את ההזנה. 0 הוא ערך תקין ומשמעותי: "נספר, ואין במלאי".
  quantityEntered: z.coerce.number().min(0).nullable(),
  tareUnits: z.coerce.number().min(0).default(1),
  // מאיפה הגיעה ההזנה. ocr = אושרה על ידי אדם אחרי זיהוי מצילום
  source: z.enum(['manual', 'ocr']).default('manual'),
});

const linesBatchSchema = z.object({
  lines: z.array(lineSchema).min(1).max(500),
});

/**
 * upsert של שורות ספירה. מקבל גם שורה בודדת (autosave) וגם אצווה
 * (התור של הלקוח מתרוקן אחרי ניתוק רשת).
 *
 * המקדם והמחיר נשמרים כתמונת מצב בשורה, ולכן עדכון מחיר בקטלוג
 * לא ישנה ספירות היסטוריות.
 */
router.put('/:id/lines', asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);
  await loadOpenCount(countId);

  const payload = Array.isArray(req.body?.lines)
    ? linesBatchSchema.parse(req.body)
    : { lines: [lineSchema.parse(req.body)] };

  const saved = await db.transaction(async (conn) => {
    const results = [];

    for (const line of payload.lines) {
      const [unitRows] = await conn.execute(
        `SELECT iu.id, iu.unit_name, iu.factor_to_base, iu.tare_weight,
                i.price_per_base_unit
           FROM item_units iu
           JOIN items i ON i.id = iu.item_id
          WHERE iu.id = ? AND iu.item_id = ?`,
        [line.itemUnitId, line.itemId]
      );

      if (unitRows.length === 0) {
        throw new HttpError(400, `יחידת ספירה ${line.itemUnitId} לא שייכת לפריט ${line.itemId}`);
      }

      const unitRow = unitRows[0];

      // מחיקה: הסופר ניקה את השדה. שונה מ-0, שמשמעו "נספר ואין במלאי".
      if (line.quantityEntered === null) {
        await conn.execute(
          `DELETE FROM count_lines
            WHERE count_id = ? AND item_id = ? AND location_id = ? AND unit_name = ?`,
          [countId, line.itemId, line.locationId, unitRow.unit_name]
        );
        results.push({ ...line, deleted: true });
        continue;
      }

      const computed = units.computeLine({
        quantityEntered: line.quantityEntered,
        factorToBase: unitRow.factor_to_base,
        tareWeight: unitRow.tare_weight,
        tareUnits: line.tareUnits,
        pricePerBaseUnit: unitRow.price_per_base_unit,
      });

      await conn.execute(
        `INSERT INTO count_lines
           (count_id, item_id, location_id, item_unit_id, unit_name, quantity_entered,
            factor_used, tare_used, tare_units, quantity_base, unit_price_snapshot,
            line_value, source, counted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           item_unit_id        = VALUES(item_unit_id),
           quantity_entered    = VALUES(quantity_entered),
           factor_used         = VALUES(factor_used),
           tare_used           = VALUES(tare_used),
           tare_units          = VALUES(tare_units),
           quantity_base       = VALUES(quantity_base),
           unit_price_snapshot = VALUES(unit_price_snapshot),
           line_value          = VALUES(line_value),
           source              = VALUES(source),
           counted_by          = VALUES(counted_by)`,
        [countId, line.itemId, line.locationId, line.itemUnitId, unitRow.unit_name,
         line.quantityEntered, units.toNumber(unitRow.factor_to_base),
         units.toNumber(unitRow.tare_weight), computed.tareDeducted > 0 ? line.tareUnits : 0,
         computed.quantityBase, units.toNumber(unitRow.price_per_base_unit),
         computed.lineValue, line.source, req.user.id]
      );

      results.push({
        itemId: line.itemId,
        locationId: line.locationId,
        itemUnitId: line.itemUnitId,
        unitName: unitRow.unit_name,
        quantityEntered: line.quantityEntered,
        quantityBase: computed.quantityBase,
        lineValue: computed.lineValue,
        tareDeducted: computed.tareDeducted,
      });
    }

    return results;
  });

  res.json({ saved });
}));


/* ---------- זיהוי מצילום ---------- */

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ocr.maxImageBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new HttpError(400, 'נתמכות תמונות JPEG, PNG או WebP בלבד'));
    }
    return cb(null, true);
  },
});

/** עוטף את multer כדי ששגיאות גודל יגיעו ל-error handler בעברית */
function singleImage(req, res, next) {
  imageUpload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'התמונה גדולה מדי'));
      return next(new HttpError(400, `שגיאה בהעלאת התמונה: ${err.message}`));
    }
    if (err) return next(err);
    if (!req.file) return next(new HttpError(400, 'לא צורפה תמונה'));
    return next();
  });
}

/** האם זיהוי מצילום זמין. הלקוח מסתיר את הכפתור כשלא */
router.get('/ocr/status', (req, res) => {
  res.json({ enabled: config.ocr.enabled, model: config.ocr.enabled ? config.ocr.model : null });
});

/**
 * קורא דף ספירה מצולם ומחזיר הצעות. לא כותב כלום.
 * הכתיבה קורית ב-PUT /lines אחרי שהמשתמש אישר במסך, עם source='ocr'.
 */
router.post('/:id/ocr', singleImage, asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);
  const locationId = z.coerce.number().int().positive().parse(req.body.locationId);

  if (!config.ocr.enabled) {
    throw new HttpError(503, 'זיהוי מצילום לא מוגדר בשרת. יש להגדיר ANTHROPIC_API_KEY');
  }

  await loadOpenCount(countId);

  const location = await db.queryOne('SELECT id, name FROM locations WHERE id = ?', [locationId]);
  if (!location) throw new HttpError(404, 'האזור לא נמצא');

  const items = await loadLocationItems(locationId);
  if (items.length === 0) throw new HttpError(400, 'אין פריטים משויכים לאזור הזה');

  let result;
  try {
    result = await ocr.readCountSheet({
      imageBase64: req.file.buffer.toString('base64'),
      mediaType: req.file.mimetype,
      locationName: location.name,
      items,
    });
  } catch (err) {
    const Anthropic = require('@anthropic-ai/sdk');
    const A = Anthropic.default || Anthropic;
    if (err instanceof A.AuthenticationError) {
      throw new HttpError(503, 'מפתח ה-API של שירות הזיהוי לא תקין');
    }
    if (err instanceof A.RateLimitError) {
      throw new HttpError(503, 'שירות הזיהוי עמוס כרגע. נסה שוב בעוד רגע');
    }
    if (err instanceof A.APIError || err instanceof A.APIConnectionError) {
      logger.error('שגיאת API בזיהוי מצילום', { status: err.status, message: err.message });
      throw new HttpError(502, 'שירות הזיהוי לא זמין כרגע');
    }
    throw new HttpError(502, err.message || 'הזיהוי נכשל');
  }

  logger.info('OCR הופעל', { countId, locationId, by: req.user.username, rows: result.rows.length });

  res.json({
    location: { id: location.id, name: location.name },
    ...result,
  });
}));

/** סוגר את הספירה ומקבע את השווי הכולל */
router.post('/:id/close', requireRole('manager'), asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);
  await loadOpenCount(countId);

  const totalRow = await db.queryOne(
    'SELECT COALESCE(SUM(line_value), 0) AS total FROM count_lines WHERE count_id = ?',
    [countId]
  );
  const totalValue = units.toNumber(totalRow.total);

  await db.query(
    `UPDATE counts
        SET status = 'closed', closed_at = NOW(), closed_by = ?, total_value = ?
      WHERE id = ? AND status = 'open'`,
    [req.user.id, totalValue, countId]
  );

  logger.info('ספירה נסגרה', { countId, totalValue, by: req.user.username });
  res.json({ id: countId, status: 'closed', totalValue });
}));

/** פותח מחדש ספירה סגורה - למקרה שהתגלתה טעות אחרי הסגירה */
router.post('/:id/reopen', requireRole('manager'), asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);

  const other = await db.queryOne(
    "SELECT id, name FROM counts WHERE status = 'open' AND id <> ? LIMIT 1",
    [countId]
  );
  if (other) {
    throw new HttpError(409, `כבר קיימת ספירה פתוחה: "${other.name}"`);
  }

  const result = await db.query(
    `UPDATE counts SET status = 'open', closed_at = NULL, closed_by = NULL, total_value = NULL
      WHERE id = ? AND status = 'closed'`,
    [countId]
  );

  if (result.affectedRows === 0) throw new HttpError(404, 'לא נמצאה ספירה סגורה עם המזהה הזה');

  logger.warn('ספירה נפתחה מחדש', { countId, by: req.user.username });
  res.json({ id: countId, status: 'open' });
}));

router.get('/:id/summary', asyncRoute(async (req, res) => {
  const countId = z.coerce.number().int().positive().parse(req.params.id);
  const summary = await valuation.buildSummary(countId);

  if (!summary) throw new HttpError(404, 'הספירה לא נמצאה');
  res.json(summary);
}));

module.exports = router;
