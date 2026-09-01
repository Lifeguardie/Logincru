'use strict';

/**
 * ייבוא אקסל. תמיד דו-שלבי:
 *   POST /preview  - מנתח ומחזיר תצוגה מקדימה, לא כותב כלום
 *   POST /commit   - כותב את מה שהמשתמש אישר
 */

const express = require('express');
const multer = require('multer');
const { z } = require('zod');

const db = require('../db');
const excel = require('../services/excel');
const units = require('../services/units');
const logger = require('../logger');
const config = require('../config');
const { asyncRoute, HttpError } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.business.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(xlsx|xlsm|xls|csv)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new HttpError(400, 'רק קבצי Excel או CSV נתמכים'));
    }
    return cb(null, true);
  },
});

router.use(requireAuth, requireRole('manager'));

/** עוטף את multer כדי ששגיאות גודל/סוג יגיעו ל-error handler בעברית */
function singleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(400, 'הקובץ גדול מדי'));
      }
      return next(new HttpError(400, `שגיאה בהעלאת הקובץ: ${err.message}`));
    }
    if (err) return next(err);
    if (!req.file) return next(new HttpError(400, 'לא צורף קובץ'));
    return next();
  });
}

router.post('/items/preview', singleFile, asyncRoute(async (req, res) => {
  let preview;
  try {
    preview = excel.parseItemsFile(req.file.buffer);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  // מסמנים אילו שורות יעדכנו פריט קיים ואילו ייצרו חדש
  const skus = preview.rows.map((row) => row.sku).filter(Boolean);
  const names = preview.rows.map((row) => row.name);

  const existingBySku = new Map();
  const existingByName = new Map();

  if (skus.length > 0) {
    const rows = await db.query(
      `SELECT id, sku, name FROM items WHERE sku IN (${skus.map(() => '?').join(',')})`,
      skus
    );
    for (const row of rows) existingBySku.set(row.sku, row);
  }
  if (names.length > 0) {
    const rows = await db.query(
      `SELECT id, sku, name FROM items WHERE name IN (${names.map(() => '?').join(',')})`,
      names
    );
    for (const row of rows) existingByName.set(row.name, row);
  }

  const rows = preview.rows.map((row) => {
    const match = (row.sku && existingBySku.get(row.sku)) || existingByName.get(row.name) || null;
    return { ...row, action: match ? 'update' : 'create', existingItemId: match?.id ?? null };
  });

  res.json({
    ...preview,
    rows,
    willCreate: rows.filter((row) => row.action === 'create').length,
    willUpdate: rows.filter((row) => row.action === 'update').length,
  });
}));

const commitItemsSchema = z.object({
  rows: z.array(z.object({
    sku: z.string().nullish(),
    name: z.string().trim().min(1),
    categoryName: z.string().nullish(),
    locationName: z.string().nullish(),
    baseUnit: z.enum(units.BASE_UNITS),
    pricePerBaseUnit: z.coerce.number().min(0),
    supplierName: z.string().nullish(),
  })).min(1).max(5000),
  // כשכבוי, שורות שמתאימות לפריט קיים מדולגות במקום לעדכן אותו
  updateExisting: z.boolean().default(true),
});

/** מוצא או יוצר רשומה בטבלה פשוטה לפי שם, ומחזיר מזהה */
async function findOrCreateByName(conn, table, name) {
  if (!name) return null;

  const [existing] = await conn.execute(`SELECT id FROM ${table} WHERE name = ?`, [name]);
  if (existing.length > 0) return existing[0].id;

  const [created] = await conn.execute(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
  return created.insertId;
}

router.post('/items/commit', asyncRoute(async (req, res) => {
  const body = commitItemsSchema.parse(req.body);

  const result = await db.transaction(async (conn) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of body.rows) {
      const categoryId = await findOrCreateByName(conn, 'categories', row.categoryName);
      const locationId = await findOrCreateByName(conn, 'locations', row.locationName);

      const [matches] = await conn.execute(
        'SELECT id FROM items WHERE (sku IS NOT NULL AND sku = ?) OR name = ? LIMIT 1',
        [row.sku ?? null, row.name]
      );
      const existingId = matches.length > 0 ? matches[0].id : null;

      let itemId;

      if (existingId) {
        if (!body.updateExisting) {
          skipped += 1;
          continue;
        }

        await conn.execute(
          `UPDATE items SET name = ?, category_id = COALESCE(?, category_id),
                  base_unit = ?, price_per_base_unit = ?,
                  supplier_name = COALESCE(?, supplier_name)
            WHERE id = ?`,
          [row.name, categoryId, row.baseUnit, row.pricePerBaseUnit,
           row.supplierName ?? null, existingId]
        );
        itemId = existingId;
        updated += 1;
      } else {
        const [insert] = await conn.execute(
          `INSERT INTO items (sku, name, category_id, base_unit, price_per_base_unit, supplier_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.sku || null, row.name, categoryId, row.baseUnit,
           row.pricePerBaseUnit, row.supplierName ?? null]
        );
        itemId = insert.insertId;

        // יחידת ספירה ברירת מחדל, אחרת אי אפשר יהיה לספור את הפריט
        await conn.execute(
          `INSERT INTO item_units (item_id, unit_name, factor_to_base, is_default, sort_order)
           VALUES (?, ?, 1, 1, 0)`,
          [itemId, units.baseUnitLabel(row.baseUnit)]
        );
        created += 1;
      }

      if (locationId) {
        await conn.execute(
          `INSERT INTO item_locations (item_id, location_id, sort_order)
           VALUES (?, ?, 0)
           ON DUPLICATE KEY UPDATE sort_order = sort_order`,
          [itemId, locationId]
        );
      }
    }

    return { created, updated, skipped };
  });

  logger.info('ייבוא קטלוג הושלם', { ...result, by: req.user.username });
  res.json(result);
}));

router.post('/purchases/preview', singleFile, asyncRoute(async (req, res) => {
  let preview;
  try {
    preview = excel.parsePurchasesFile(req.file.buffer);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  // מתאימים כל שורה לפריט בקטלוג. שורה בלי התאמה לא תיובא.
  const rows = [];
  for (const row of preview.rows) {
    const match = await db.queryOne(
      'SELECT id, name FROM items WHERE (sku IS NOT NULL AND sku = ?) OR name = ? LIMIT 1',
      [row.sku ?? null, row.name ?? '']
    );
    rows.push({
      ...row,
      itemId: match?.id ?? null,
      matchedItemName: match?.name ?? null,
      matched: Boolean(match),
    });
  }

  res.json({
    ...preview,
    rows,
    matched: rows.filter((row) => row.matched).length,
    unmatched: rows.filter((row) => !row.matched).length,
  });
}));

const commitPurchasesSchema = z.object({
  rows: z.array(z.object({
    itemId: z.coerce.number().int().positive(),
    purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantityBase: z.coerce.number().positive(),
    totalCost: z.coerce.number().min(0).default(0),
    supplierName: z.string().nullish(),
    invoiceRef: z.string().nullish(),
  })).min(1).max(5000),
});

router.post('/purchases/commit', asyncRoute(async (req, res) => {
  const body = commitPurchasesSchema.parse(req.body);

  const inserted = await db.transaction(async (conn) => {
    let count = 0;
    for (const row of body.rows) {
      await conn.execute(
        `INSERT INTO purchases (item_id, purchase_date, quantity_base, total_cost,
                                supplier_name, invoice_ref, source, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'excel', ?)`,
        [row.itemId, row.purchaseDate, row.quantityBase, row.totalCost,
         row.supplierName ?? null, row.invoiceRef ?? null, req.user.id]
      );
      count += 1;
    }
    return count;
  });

  logger.info('ייבוא רכש הושלם', { inserted, by: req.user.username });
  res.json({ inserted });
}));

module.exports = router;
