'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const units = require('../src/services/units');

test('פריט שנספר ביחידות ומתומחר בקילו - שניצל', (t) => {
  // base_unit=kg, 45 ש"ח לק"ג. ארגז=5 ק"ג, יחידה=0.180 ק"ג
  const result = units.sumLines([
    { quantityEntered: 2, factorToBase: 5.0, pricePerBaseUnit: 45 },
    { quantityEntered: 7, factorToBase: 0.180, pricePerBaseUnit: 45 },
  ]);

  assert.equal(result.quantityBase, 11.26, '2 ארגזים + 7 יחידות = 11.26 ק"ג');
  assert.equal(result.totalValue, 506.7, '11.26 ק"ג * 45 = 506.70 ש"ח');
});

test('שקילת מיכל פתוח - משקל האריזה מנוכה', () => {
  const result = units.computeLine({
    quantityEntered: 3.2,   // משקל ברוטו
    factorToBase: 1,
    tareWeight: 0.25,       // המיכל הריק
    pricePerBaseUnit: 8,
  });

  assert.equal(result.netEntered, 2.95);
  assert.equal(result.quantityBase, 2.95);
  assert.equal(result.tareDeducted, 0.25);
  assert.equal(result.lineValue, 23.6);
});

test('ניכוי טרה של כמה מיכלים', () => {
  const result = units.computeLine({
    quantityEntered: 9.6,
    factorToBase: 1,
    tareWeight: 0.25,
    tareUnits: 3,
    pricePerBaseUnit: 8,
  });

  assert.equal(result.tareDeducted, 0.75);
  assert.equal(result.quantityBase, 8.85);
});

test('טרה גדולה מהמשקל שנשקל מתאפסת ולא הולכת למינוס', () => {
  const result = units.computeLine({
    quantityEntered: 0.1,
    factorToBase: 1,
    tareWeight: 0.25,
    pricePerBaseUnit: 8,
  });

  assert.equal(result.quantityBase, 0, 'טעות הזנה לא מקזזת שווי של פריטים אחרים');
  assert.equal(result.lineValue, 0);
});

test('tareUnits בלי tareWeight מוגדר לא מנכה כלום', () => {
  const result = units.computeLine({
    quantityEntered: 5,
    factorToBase: 1,
    tareUnits: 3,
    pricePerBaseUnit: 10,
  });

  assert.equal(result.tareDeducted, 0);
  assert.equal(result.quantityBase, 5);
});

test('פריט שנספר ונמכר ביחידות - factor 1', () => {
  const result = units.computeLine({
    quantityEntered: 24,
    factorToBase: 1,
    pricePerBaseUnit: 4.5,
  });

  assert.equal(result.quantityBase, 24);
  assert.equal(result.lineValue, 108);
});

test('כמות עשרונית עוברת בלי עיגול לשלם - חצי ארגז', () => {
  const result = units.computeLine({
    quantityEntered: 0.5,
    factorToBase: 5.0,
    pricePerBaseUnit: 45,
  });

  assert.equal(result.quantityBase, 2.5);
  assert.equal(result.lineValue, 112.5);
});

test('ערכים מה-DB מגיעים כמחרוזות ומטופלים נכון', () => {
  // mysql2 מחזיר DECIMAL כמחרוזת. אם לא נמיר, "2" * "5.0" עוד יעבוד
  // אבל "0.180" + "5" ישרשר ל-"0.1805" - ולכן ההמרה חייבת להיות מפורשת.
  const result = units.sumLines([
    { quantityEntered: '2', factorToBase: '5.0000', pricePerBaseUnit: '45.0000' },
    { quantityEntered: '7', factorToBase: '0.1800', pricePerBaseUnit: '45.0000' },
  ]);

  assert.equal(result.quantityBase, 11.26);
  assert.equal(result.totalValue, 506.7);
});

test('קלט לא תקין לא מפיל את החישוב', () => {
  assert.equal(units.computeLine({ quantityEntered: null, factorToBase: 1 }).quantityBase, 0);
  assert.equal(units.computeLine({ quantityEntered: 'abc', factorToBase: 1 }).quantityBase, 0);
  assert.equal(units.computeLine({ quantityEntered: 5, factorToBase: undefined }).quantityBase, 0);
});

test('שגיאות float מעוגלות נכון', () => {
  // 0.1 + 0.2 = 0.30000000000000004 ב-float
  const result = units.sumLines([
    { quantityEntered: 0.1, factorToBase: 1, pricePerBaseUnit: 1 },
    { quantityEntered: 0.2, factorToBase: 1, pricePerBaseUnit: 1 },
  ]);

  assert.equal(result.quantityBase, 0.3);
  assert.equal(result.totalValue, 0.3);
});

test('סכימה של פריט אחד בשתי יחידות - 3 בקבוקים סגורים + בקבוק פתוח שנשקל', () => {
  // ויסקי: base_unit=liter, 120 ש"ח לליטר. בקבוק=0.7 ליטר
  const result = units.sumLines([
    { quantityEntered: 3, factorToBase: 0.7, pricePerBaseUnit: 120 },
    { quantityEntered: 0.4, factorToBase: 1, pricePerBaseUnit: 120 },
  ]);

  assert.equal(result.quantityBase, 2.5, '2.1 ליטר סגור + 0.4 ליטר פתוח');
  assert.equal(result.totalValue, 300);
});

test('יחידות בסיס תקינות', () => {
  assert.ok(units.isValidBaseUnit('kg'));
  assert.ok(units.isValidBaseUnit('liter'));
  assert.ok(units.isValidBaseUnit('unit'));
  assert.ok(!units.isValidBaseUnit('box'));
  assert.equal(units.baseUnitLabel('kg'), 'ק"ג');
});
