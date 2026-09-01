'use strict';

/**
 * ייבוא וייצוא אקסל.
 *
 * הייבוא הוא תמיד דו-שלבי: parse מחזיר תצוגה מקדימה עם שגיאות ואזהרות,
 * והכתיבה קורית רק בקריאה נפרדת אחרי שהמשתמש אישר. ייבוא עיוור לקטלוג
 * מלאי הוא דרך בטוחה לשבור מחירים של מאות פריטים בבת אחת.
 */

const XLSX = require('xlsx');
const unitsService = require('./units');

/** כותרות מזוהות, בעברית ובאנגלית, לכל שדה */
const ITEM_COLUMN_ALIASES = {
  sku: ['sku', 'מקט', 'מק"ט', 'מקט פריט', 'קוד', 'קוד פריט'],
  name: ['name', 'שם', 'שם פריט', 'פריט', 'תיאור'],
  categoryName: ['category', 'מחלקה', 'קטגוריה', 'קבוצה'],
  baseUnit: ['base unit', 'יחידת בסיס', 'יחידה', 'יחידת מידה'],
  pricePerBaseUnit: ['price', 'מחיר', 'מחיר ליחידה', 'מחיר לקילו', 'מחיר בסיס', 'עלות'],
  supplierName: ['supplier', 'ספק', 'שם ספק'],
  locationName: ['location', 'אזור', 'מיקום', 'אזור ספירה'],
};

const PURCHASE_COLUMN_ALIASES = {
  sku: ['sku', 'מקט', 'מק"ט', 'קוד', 'קוד פריט'],
  name: ['name', 'שם', 'שם פריט', 'פריט'],
  purchaseDate: ['date', 'תאריך', 'תאריך קניה', 'תאריך רכישה', 'תאריך חשבונית'],
  quantityBase: ['quantity', 'כמות', 'כמות בסיס'],
  totalCost: ['cost', 'עלות', 'סכום', 'מחיר', 'סה"כ'],
  supplierName: ['supplier', 'ספק', 'שם ספק'],
  invoiceRef: ['invoice', 'חשבונית', 'מספר חשבונית', 'אסמכתא'],
};

/** מנרמל כותרת: אותיות קטנות, בלי רווחים כפולים, בלי גרשיים */
function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ');
}

/** מוצא לכל שדה את שם העמודה בפועל בקובץ */
function mapColumns(headers, aliases) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};

  for (const [field, options] of Object.entries(aliases)) {
    const index = normalized.findIndex((header) => options.includes(header));
    if (index !== -1) mapping[field] = headers[index];
  }

  return mapping;
}

/** ממיר טקסט למספר. תומך בפסיק עשרוני ובסימן שקל */
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/[₪,\s]/g, '').replace(/,/g, '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** מזהה יחידת בסיס מטקסט עברי או אנגלי */
function parseBaseUnit(value) {
  const text = normalizeHeader(value);
  if (!text) return null;
  if (['kg', 'קג', 'קילו', 'קילוגרם', 'ק ג'].includes(text)) return 'kg';
  if (['liter', 'litre', 'l', 'ליטר'].includes(text)) return 'liter';
  if (['unit', 'יחידה', 'יח', 'יחידות'].includes(text)) return 'unit';
  return null;
}

/**
 * ממיר תאריך מאקסל ל-YYYY-MM-DD.
 * אקסל שומר תאריכים כמספר סידורי, ולכן צריך לטפל בשני המקרים.
 */
function parseDate(value) {
  if (!value && value !== 0) return null;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  }

  const text = String(value).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // DD/MM/YYYY או DD.MM.YYYY - הפורמט הנפוץ בישראל
  const match = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

/** קורא את הגיליון הראשון לשורות אובייקט */
function readSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('הקובץ ריק - לא נמצא אף גיליון');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0 })[0] || [];

  return { sheetName, rows, headers: headers.filter((h) => h !== null && h !== undefined) };
}

/**
 * מנתח קובץ קטלוג ומחזיר תצוגה מקדימה.
 * לא כותב כלום - הכתיבה היא בקריאה נפרדת.
 */
function parseItemsFile(buffer) {
  const { sheetName, rows, headers } = readSheet(buffer);
  const columns = mapColumns(headers, ITEM_COLUMN_ALIASES);

  if (!columns.name) {
    throw new Error(
      `לא נמצאה עמודת שם פריט. הכותרות שנמצאו: ${headers.join(', ') || '(אין)'}`
    );
  }

  const parsed = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // שורה 1 היא הכותרות
    const name = String(row[columns.name] ?? '').trim();

    if (!name) return; // שורה ריקה - מדלגים בשקט

    const rawPrice = columns.pricePerBaseUnit ? parseNumber(row[columns.pricePerBaseUnit]) : null;
    const rawUnit = columns.baseUnit ? parseBaseUnit(row[columns.baseUnit]) : null;
    const rowErrors = [];

    if (columns.baseUnit && row[columns.baseUnit] && !rawUnit) {
      rowErrors.push(`יחידת בסיס לא מזוהה: "${row[columns.baseUnit]}"`);
    }
    if (rawPrice !== null && rawPrice < 0) {
      rowErrors.push('מחיר שלילי');
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, name, messages: rowErrors });
      return;
    }

    parsed.push({
      row: rowNumber,
      sku: columns.sku ? (String(row[columns.sku] ?? '').trim() || null) : null,
      name,
      categoryName: columns.categoryName
        ? (String(row[columns.categoryName] ?? '').trim() || null) : null,
      locationName: columns.locationName
        ? (String(row[columns.locationName] ?? '').trim() || null) : null,
      baseUnit: rawUnit || 'unit',
      baseUnitWasGuessed: !rawUnit,
      pricePerBaseUnit: rawPrice ?? 0,
      priceWasMissing: rawPrice === null,
      supplierName: columns.supplierName
        ? (String(row[columns.supplierName] ?? '').trim() || null) : null,
    });
  });

  return {
    sheetName,
    detectedColumns: columns,
    unmappedHeaders: headers.filter((header) => !Object.values(columns).includes(header)),
    totalRows: rows.length,
    validRows: parsed.length,
    errors,
    rows: parsed,
  };
}

/** מנתח קובץ רכש */
function parsePurchasesFile(buffer) {
  const { sheetName, rows, headers } = readSheet(buffer);
  const columns = mapColumns(headers, PURCHASE_COLUMN_ALIASES);

  if (!columns.sku && !columns.name) {
    throw new Error('נדרשת עמודת מק"ט או שם פריט כדי לזהות לאיזה פריט שייך הרכש');
  }
  if (!columns.quantityBase) {
    throw new Error('לא נמצאה עמודת כמות');
  }

  const parsed = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const sku = columns.sku ? (String(row[columns.sku] ?? '').trim() || null) : null;
    const name = columns.name ? (String(row[columns.name] ?? '').trim() || null) : null;

    if (!sku && !name) return;

    const quantity = parseNumber(row[columns.quantityBase]);
    const cost = columns.totalCost ? parseNumber(row[columns.totalCost]) : null;
    const date = columns.purchaseDate ? parseDate(row[columns.purchaseDate]) : null;
    const rowErrors = [];

    if (quantity === null || quantity <= 0) rowErrors.push('כמות חסרה או לא חוקית');
    if (columns.purchaseDate && row[columns.purchaseDate] && !date) {
      rowErrors.push(`תאריך לא מזוהה: "${row[columns.purchaseDate]}"`);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, name: name || sku, messages: rowErrors });
      return;
    }

    parsed.push({
      row: rowNumber,
      sku,
      name,
      purchaseDate: date,
      dateWasMissing: !date,
      quantityBase: quantity,
      totalCost: cost ?? 0,
      costWasMissing: cost === null,
      supplierName: columns.supplierName
        ? (String(row[columns.supplierName] ?? '').trim() || null) : null,
      invoiceRef: columns.invoiceRef
        ? (String(row[columns.invoiceRef] ?? '').trim() || null) : null,
    });
  });

  return {
    sheetName,
    detectedColumns: columns,
    totalRows: rows.length,
    validRows: parsed.length,
    errors,
    rows: parsed,
  };
}

/** בונה קובץ אקסל של סיכום ספירה, עם גיליון פירוט וגיליון סיכומים */
function buildCountWorkbook(summary) {
  const workbook = XLSX.utils.book_new();

  const detailRows = summary.rows.map((row) => ({
    'מק"ט': row.sku || '',
    'פריט': row.itemName,
    'מחלקה': row.categoryName,
    'אזור': row.locationName,
    'פירוט הזנות': row.entries
      .map((entry) => `${entry.quantityEntered} ${entry.unitName}`)
      .join(' + '),
    'כמות (יחידת בסיס)': row.quantityBase,
    'יחידת בסיס': unitsService.baseUnitLabel(row.baseUnit),
    'שווי (₪)': row.totalValue,
  }));

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(detailRows),
    'פירוט'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summary.byCategory.map((group) => ({
      'מחלקה': group.name,
      'מספר פריטים': group.itemCount,
      'שווי (₪)': group.totalValue,
    }))),
    'לפי מחלקה'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(summary.byLocation.map((group) => ({
      'אזור': group.name,
      'מספר פריטים': group.itemCount,
      'שווי (₪)': group.totalValue,
    }))),
    'לפי אזור'
  );

  if (summary.comparison) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summary.comparison.changes.map((change) => ({
        'פריט': change.itemName,
        'מחלקה': change.categoryName,
        'כמות קודמת': change.previousQuantity,
        'כמות נוכחית': change.currentQuantity,
        'הפרש': change.quantityDiff,
        'שינוי באחוזים': change.percentChange === null ? 'פריט חדש' : change.percentChange,
        'הפרש בשקלים': change.valueDiff,
        'חריגה': change.isVariance ? 'כן' : '',
      }))),
      'השוואה לקודמת'
    );
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/** בונה קובץ אקסל של דוח צריכה */
function buildConsumptionWorkbook(report) {
  const workbook = XLSX.utils.book_new();

  const rows = report.items.map((item) => ({
    'פריט': item.itemName,
    'מחלקה': item.categoryName,
    'יחידה': unitsService.baseUnitLabel(item.baseUnit),
    'מלאי פתיחה': item.openingQuantity,
    'רכש': item.purchasedQuantity,
    'מלאי סגירה': item.closingQuantity,
    'נצרך': item.consumedQuantity,
    'שווי פתיחה (₪)': item.openingValue,
    'עלות רכש (₪)': item.purchasedCost,
    'שווי סגירה (₪)': item.closingValue,
    'עלות צריכה (₪)': item.consumedCost,
    'התראה': item.hasNegativeConsumption ? 'צריכה שלילית - כנראה חסר דיווח רכש' : '',
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'צריכה');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  parseItemsFile,
  parsePurchasesFile,
  buildCountWorkbook,
  buildConsumptionWorkbook,
  parseNumber,
  parseDate,
  parseBaseUnit,
};
