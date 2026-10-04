'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('../src/services/ocr');

/** קטלוג של אזור "מקפיא" לבדיקות - שניצל שמתומחר בקילו ונספר ביחידות */
const ITEMS = [
  {
    id: 2, sku: 'MEAT-014', name: 'שניצל עוף קפוא', baseUnit: 'kg', pricePerBaseUnit: 45,
    units: [
      { id: 3, unitName: 'ק"ג', factorToBase: 1, tareWeight: null, isDefault: false },
      { id: 4, unitName: 'יחידה', factorToBase: 0.18, tareWeight: null, isDefault: true },
      { id: 5, unitName: 'ארגז', factorToBase: 5, tareWeight: null, isDefault: false },
    ],
  },
  {
    id: 6, sku: 'DAIRY-007', name: 'גבינת מוצרלה', baseUnit: 'kg', pricePerBaseUnit: 34.5,
    units: [
      { id: 12, unitName: 'ק"ג', factorToBase: 1, tareWeight: null, isDefault: true },
      { id: 13, unitName: 'חבילה', factorToBase: 2.5, tareWeight: null, isDefault: false },
    ],
  },
];

/** לקוח מזויף שמחזיר תשובה מוכנה ושומר את הבקשה לבדיקה */
function fakeClient(parsedOutput, extra = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async parse(params) {
          calls.push(params);
          return {
            stop_reason: 'end_turn',
            model: 'claude-opus-5-5',
            usage: { input_tokens: 1200, output_tokens: 90 },
            parsed_output: parsedOutput,
            ...extra,
          };
        },
      },
    },
  };
}

test('שורה תקינה - "2 ארגז + 7" הופכת לשתי שורות עם תצוגה מקדימה', async () => {
  const client = fakeClient({
    rows: [
      { rawText: 'שניצל 2 ארגז', itemId: 2, quantity: 2, unitName: 'ארגז', confidence: 'high', note: null },
      { rawText: 'שניצל 7', itemId: 2, quantity: 7, unitName: 'יחידה', confidence: 'high', note: null },
    ],
    sheetNote: null,
  });

  const result = await ocr.readCountSheet({
    imageBase64: 'AAAA', mediaType: 'image/jpeg', locationName: 'מקפיא', items: ITEMS, client,
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 0);

  assert.equal(result.rows[0].itemUnitId, 5);
  assert.equal(result.rows[0].previewQuantityBase, 10);
  assert.equal(result.rows[0].previewValue, 450);

  assert.equal(result.rows[1].itemUnitId, 4);
  assert.equal(result.rows[1].previewQuantityBase, 1.26);
  assert.equal(result.rows[1].previewValue, 56.7);
});

test('הבקשה למודל כוללת את התמונה, הקטלוג, המודל והמאמץ מההגדרות', async () => {
  const client = fakeClient({ rows: [], sheetNote: null });

  await ocr.readCountSheet({
    imageBase64: 'BASE64DATA', mediaType: 'image/png', locationName: 'מקפיא', items: ITEMS, client,
  });

  const params = client.calls[0];
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.output_config.effort, 'high');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(params.thinking, { type: 'adaptive' });
  assert.ok(params.output_config.format, 'חייב להיות פורמט פלט מובנה');

  const content = params.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/png');
  assert.equal(content[0].source.data, 'BASE64DATA');
  assert.ok(content[1].text.includes('שניצל עוף קפוא'), 'הקטלוג נשלח למודל');
  assert.ok(content[1].text.includes('id=2'), 'המזהים נשלחים כדי שהמודל יוכל להתאים');
  assert.ok(content[1].text.includes('ארגז'), 'יחידות הספירה נשלחות');
});

test('itemId שהמודל המציא - לא נכשל, הופך ללא-מזוהה עם ביטחון נמוך', async () => {
  const client = fakeClient({
    rows: [{ rawText: 'משהו 5', itemId: 999, quantity: 5, unitName: null, confidence: 'high', note: null }],
    sheetNote: null,
  });

  const result = await ocr.readCountSheet({
    imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'מקפיא', items: ITEMS, client,
  });

  assert.equal(result.rows[0].itemId, null);
  assert.equal(result.rows[0].confidence, 'low');
  assert.equal(result.unmatched, 1);
  assert.ok(result.rows[0].note.includes('לא נמצא'));
  assert.equal(result.rows[0].previewValue, null, 'בלי פריט אין תצוגה מקדימה');
});

test('יחידה שלא קיימת לפריט - נופלת לברירת המחדל והביטחון יורד', async () => {
  const client = fakeClient({
    rows: [{ rawText: 'שניצל 3 שקיות', itemId: 2, quantity: 3, unitName: 'שקית', confidence: 'high', note: null }],
    sheetNote: null,
  });

  const result = await ocr.readCountSheet({
    imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'מקפיא', items: ITEMS, client,
  });

  assert.equal(result.rows[0].itemUnitId, 4, 'ברירת המחדל של שניצל היא יחידה');
  assert.equal(result.rows[0].unitName, 'יחידה');
  assert.equal(result.rows[0].confidence, 'medium');
  assert.ok(result.rows[0].note.includes('שקית'));
});

test('בלי יחידה בדף - ברירת המחדל של הפריט', async () => {
  const client = fakeClient({
    rows: [{ rawText: 'מוצרלה 4', itemId: 6, quantity: 4, unitName: null, confidence: 'high', note: null }],
    sheetNote: null,
  });

  const result = await ocr.readCountSheet({
    imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'מקרר', items: ITEMS, client,
  });

  assert.equal(result.rows[0].itemUnitId, 12);
  assert.equal(result.rows[0].previewQuantityBase, 4);
  assert.equal(result.rows[0].previewValue, 138);
});

test('כמות שלילית או לא קריאה - null, לא קריסה', async () => {
  const client = fakeClient({
    rows: [
      { rawText: 'שניצל -3', itemId: 2, quantity: -3, unitName: null, confidence: 'medium', note: null },
      { rawText: 'מוצרלה ???', itemId: 6, quantity: null, unitName: null, confidence: 'low', note: 'מטושטש' },
    ],
    sheetNote: null,
  });

  const result = await ocr.readCountSheet({
    imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'מקפיא', items: ITEMS, client,
  });

  assert.equal(result.rows[0].quantity, null);
  assert.ok(result.rows[0].note.includes('לא תקינה'));
  assert.equal(result.rows[1].quantity, null);
  assert.equal(result.rows[1].note, 'מטושטש');
  assert.equal(result.matched, 2, 'הפריטים זוהו גם אם הכמות לא');
});

test('סירוב של המודל - שגיאה ברורה, לא תשובה ריקה', async () => {
  const client = fakeClient(null, {
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category: null, explanation: '' },
  });

  await assert.rejects(
    () => ocr.readCountSheet({
      imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'מקפיא', items: ITEMS, client,
    }),
    /סירב/
  );
});

test('אזור בלי פריטים - שגיאה לפני שפונים למודל', async () => {
  const client = fakeClient({ rows: [], sheetNote: null });

  await assert.rejects(
    () => ocr.readCountSheet({
      imageBase64: 'x', mediaType: 'image/jpeg', locationName: 'ריק', items: [], client,
    }),
    /אין פריטים/
  );
  assert.equal(client.calls.length, 0, 'לא בוזבזה קריאה למודל');
});

test('ביטחון לא מוכר מהמודל - מנורמל ל-low', () => {
  const { rows } = ocr.validateRows(
    [{ rawText: 'x', itemId: 2, quantity: 1, unitName: null, confidence: 'certain', note: null }],
    ITEMS
  );
  assert.equal(rows[0].confidence, 'low');
});
