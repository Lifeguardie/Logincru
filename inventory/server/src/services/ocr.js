'use strict';

/**
 * זיהוי כמויות מצילום של דף ספירה כתוב ביד.
 *
 * הזרימה:
 *   1. הלקוח מצלם את הדף ושולח את התמונה + מזהה האזור.
 *   2. אנחנו שולחים למודל את התמונה יחד עם רשימת הפריטים של אותו אזור
 *      ויחידות הספירה שלהם. טווח ההתאמה קטן, ולכן הדיוק גבוה.
 *   3. המודל מחזיר שורות מובנות: טקסט שנקרא, פריט מותאם, כמות, יחידה, ביטחון.
 *   4. אנחנו מאמתים כל שורה מול הקטלוג ומחזירים הצעות בלבד.
 *
 * שום דבר לא נכתב לספירה כאן. הכתיבה קורית רק אחרי שאדם אישר במסך.
 */

// הסכמה חייבת להיות Zod v4 - ה-helper של ה-SDK קורא schema.def. שאר השרת נשאר על v3 לוולידציית בקשות.
const { z } = require('zod/v4');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');

const config = require('../config');
const logger = require('../logger');
const units = require('./units');

const CONFIDENCE = ['high', 'medium', 'low'];

/** המבנה שהמודל חייב להחזיר. השדות הם nullable ולא optional - structured output דורש את כולם */
const SheetSchema = z.object({
  rows: z.array(z.object({
    rawText: z.string().describe('הטקסט כפי שנקרא מהשורה בדף, כולל המספר'),
    itemId: z.number().int().nullable().describe('מזהה הפריט מהקטלוג, או null אם אין התאמה ברורה'),
    quantity: z.number().nullable().describe('הכמות שנכתבה. null אם לא ניתן לקרוא'),
    unitName: z.string().nullable().describe('שם יחידת הספירה מהקטלוג. null אם לא צוינה בדף'),
    confidence: z.enum(CONFIDENCE),
    note: z.string().nullable().describe('הערה קצרה כשיש ספק - למשל "המספר מטושטש"'),
  })),
  sheetNote: z.string().nullable().describe('הערה כללית על הדף אם רלוונטי'),
});

/** יוצר לקוח. בנפרד כדי שבבדיקות אפשר להזריק לקוח מזויף */
function createClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  const Ctor = Anthropic.default || Anthropic;
  return new Ctor();
}

/** בונה את תיאור הקטלוג שהמודל מקבל - רק מה שצריך להתאמה */
function describeCatalog(items) {
  return items.map((item) => {
    const unitList = item.units
      .map((unit) => `${unit.unitName}${unit.isDefault ? ' (ברירת מחדל)' : ''}`)
      .join(', ');
    const sku = item.sku ? ` [${item.sku}]` : '';
    return `- id=${item.id}: ${item.name}${sku} | יחידת בסיס: ${units.baseUnitLabel(item.baseUnit)} | יחידות ספירה: ${unitList}`;
  }).join('\n');
}

const SYSTEM_PROMPT = `אתה קורא דפי ספירת מלאי כתובים ביד במסעדה ישראלית ומתרגם אותם לנתונים מובנים.

תקבל צילום של דף ספירה של אזור אחד, ורשימת הפריטים ששייכים לאותו אזור עם יחידות הספירה המותרות לכל פריט.

כללים:
- כל שורה כתובה בדף הופכת לשורה אחת בפלט. אל תמציא שורות ואל תשמיט שורות שיש בהן מספר.
- התאם כל שורה לפריט מהרשימה לפי השם. שמות בכתב יד יכולים להיות מקוצרים או עם שגיאות כתיב - התאם לפי המשמעות. אם אין התאמה ברורה, החזר itemId=null.
- unitName חייב להיות אחד משמות יחידות הספירה של אותו פריט בדיוק כפי שהם ברשימה. אם בדף לא כתובה יחידה, החזר null ונשתמש בברירת המחדל.
- אם בשורה אחת כתובות כמה כמויות ביחידות שונות (למשל "2 ארגז + 7"), החזר שורה נפרדת לכל כמות, עם אותו itemId.
- כמויות יכולות להיות עשרוניות (0.5, 2.4). ספרות יכולות להיות עבריות או לטיניות. פסיק יכול לשמש כנקודה עשרונית.
- confidence=high רק כשגם ההתאמה לפריט וגם המספר ברורים לחלוטין. ספק באחד מהם = medium. מספר לא קריא או התאמה מפוקפקת = low.
- שורה ריקה או מחוקה בדף - אל תחזיר אותה בכלל.
- אל תחשב, אל תסכם, אל תמיר יחידות. רק תקרא מה שכתוב.`;

/**
 * קורא דף ספירה מצולם ומחזיר הצעות מאומתות.
 *
 * @param {object} params
 * @param {string} params.imageBase64
 * @param {string} params.mediaType     image/jpeg | image/png | image/webp
 * @param {string} params.locationName
 * @param {Array}  params.items         הפריטים של האזור, עם units (id, unitName, factorToBase, isDefault)
 * @param {object} [params.client]      להזרקה בבדיקות
 */
async function readCountSheet({ imageBase64, mediaType, locationName, items, client }) {
  if (!items || items.length === 0) {
    throw new Error('אין פריטים משויכים לאזור הזה - אין למה להתאים');
  }

  const anthropic = client || createClient();

  const userText =
    `האזור: ${locationName}\n\n` +
    `הפריטים של האזור הזה:\n${describeCatalog(items)}\n\n` +
    `קרא את דף הספירה המצולם והחזר את השורות.`;

  const startedAt = Date.now();

  // fallbacks="default": אם מסנן בטיחות דוחה את הבקשה, השרת מריץ אותה מחדש
  // על מודל חלופי באותה קריאה במקום להחזיר סירוב. בדף ספירה זה לא צפוי, אבל זול.
  const response = await anthropic.beta.messages.parse({
    model: config.ocr.model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: {
      effort: config.ocr.effort,
      format: betaZodOutputFormat(SheetSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: userText },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') {
    logger.warn('המודל סירב לקרוא את הדף', { category: response.stop_details?.category });
    throw new Error('המודל סירב לעבד את התמונה. נסה לצלם שוב');
  }

  if (!response.parsed_output) {
    throw new Error('המודל החזיר תשובה לא תקינה. נסה שוב');
  }

  const result = validateRows(response.parsed_output.rows, items);

  logger.info('זיהוי דף ספירה הושלם', {
    locationName,
    rows: result.rows.length,
    matched: result.matched,
    unmatched: result.unmatched,
    model: response.model,
    ms: Date.now() - startedAt,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  });

  return {
    ...result,
    sheetNote: response.parsed_output.sheetNote,
    model: response.model,
  };
}

/**
 * מאמת את מה שהמודל החזיר מול הקטלוג האמיתי.
 * המודל יכול להמציא itemId או unitName - כאן זה נתפס, לא במסך.
 * מחזיר שורות מועשרות בנתוני הפריט ובתצוגה מקדימה של הכמות והשווי.
 */
function validateRows(rawRows, items) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  let matched = 0;
  let unmatched = 0;

  const rows = (rawRows || []).map((raw, index) => {
    let confidence = CONFIDENCE.includes(raw.confidence) ? raw.confidence : 'low';
    const notes = raw.note ? [raw.note] : [];

    let item = raw.itemId !== null && raw.itemId !== undefined ? itemsById.get(raw.itemId) : null;
    if (raw.itemId !== null && raw.itemId !== undefined && !item) {
      // המודל החזיר מזהה שלא קיים באזור - מתייחסים כאל "לא זוהה"
      notes.push('הפריט שזוהה לא נמצא ברשימת האזור');
      confidence = 'low';
      item = null;
    }

    let quantity = units.toNumber(raw.quantity, null);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      notes.push('כמות לא תקינה');
      quantity = null;
    }

    let unit = null;
    if (item) {
      if (raw.unitName) {
        unit = item.units.find((u) => u.unitName === raw.unitName) || null;
        if (!unit) {
          notes.push(`היחידה "${raw.unitName}" לא מוגדרת לפריט - נבחרה ברירת המחדל`);
          if (confidence === 'high') confidence = 'medium';
        }
      }
      if (!unit) {
        unit = item.units.find((u) => u.isDefault) || item.units[0] || null;
      }
    }

    let preview = null;
    if (item && unit && quantity !== null) {
      preview = units.computeLine({
        quantityEntered: quantity,
        factorToBase: unit.factorToBase,
        tareWeight: unit.tareWeight,
        pricePerBaseUnit: item.pricePerBaseUnit,
      });
    }

    if (item) matched += 1; else unmatched += 1;

    return {
      index,
      rawText: String(raw.rawText || ''),
      itemId: item ? item.id : null,
      itemName: item ? item.name : null,
      itemUnitId: unit ? unit.id : null,
      unitName: unit ? unit.unitName : null,
      quantity,
      confidence,
      note: notes.length ? notes.join('. ') : null,
      previewQuantityBase: preview ? preview.quantityBase : null,
      previewValue: preview ? preview.lineValue : null,
    };
  });

  return { rows, matched, unmatched };
}

module.exports = { readCountSheet, validateRows, describeCatalog, SheetSchema, SYSTEM_PROMPT };
