'use strict';

/**
 * המרות יחידות מידה ותמחור.
 *
 * זו נקודת האמת היחידה בקוד לכל חישוב של כמות ושווי. שום route ושום
 * קומפוננטה לא מחשבים המרה בעצמם - הכל עובר דרך כאן.
 *
 * המודל:
 *   לכל פריט יש base_unit (kg / liter / unit) ו-price_per_base_unit.
 *   לכל דרך ספירה יש שורה ב-item_units עם factor_to_base:
 *   כמה יחידות בסיס יש ביחידת הספירה הזו.
 *
 *   דוגמה - שניצל: base_unit=kg, price_per_base_unit=45
 *     'ק"ג'   -> factor 1.0
 *     'יחידה' -> factor 0.180
 *     'ארגז'  -> factor 5.0
 *   ספירה של 2 ארגזים + 7 יחידות = 2*5.0 + 7*0.180 = 11.26 ק"ג = 506.70 ש"ח
 */

const BASE_UNITS = Object.freeze(['kg', 'liter', 'unit']);

const BASE_UNIT_LABELS = Object.freeze({
  kg: 'ק"ג',
  liter: 'ליטר',
  unit: 'יחידה',
});

// כמויות נשמרות ב-3 ספרות אחרי הנקודה, כסף ב-2
const QUANTITY_DECIMALS = 3;
const MONEY_DECIMALS = 2;

/** עיגול חצי-כלפי-מעלה שלא סובל מרעש של float (0.1+0.2, 1.005 וכדומה) */
function round(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  // ה-epsilon מטפל במקרים כמו 1.005*100 = 100.49999999999999
  return Math.round((value * factor) + (Math.sign(value) * Number.EPSILON * factor)) / factor;
}

const roundQuantity = (value) => round(value, QUANTITY_DECIMALS);
const roundMoney = (value) => round(value, MONEY_DECIMALS);

/** ממיר ערך מה-DB (mysql2 מחזיר DECIMAL כמחרוזת) למספר */
function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * מחשב שורת ספירה אחת: כמות ביחידות בסיס ושווי כספי.
 *
 * @param {object} input
 * @param {number|string} input.quantityEntered  מה שהוקלד, ביחידת הספירה. ברוטו אם יש טרה.
 * @param {number|string} input.factorToBase     כמה יחידות בסיס ביחידת ספירה אחת
 * @param {number|string} [input.pricePerBaseUnit] מחיר ליחידת בסיס
 * @param {number|string} [input.tareWeight]     משקל אריזה ריקה, *באותה יחידה* שבה הוזנה הכמות
 * @param {number|string} [input.tareUnits]      כמה מיכלים לנכות. ברירת מחדל 1 כשיש טרה
 * @returns {{quantityBase:number, lineValue:number, netEntered:number, tareDeducted:number}}
 */
function computeLine(input) {
  const quantityEntered = toNumber(input.quantityEntered);
  const factorToBase = toNumber(input.factorToBase);
  const pricePerBaseUnit = toNumber(input.pricePerBaseUnit);
  const tareWeight = toNumber(input.tareWeight);

  // כשאין טרה מוגדרת ליחידה, אין מה לנכות - גם אם נשלח tareUnits
  const tareUnits = tareWeight > 0
    ? toNumber(input.tareUnits, 1)
    : 0;

  const tareDeducted = roundQuantity(tareWeight * tareUnits);

  // משקל אריזה גדול מהמשקל שנשקל = טעות הזנה. מתאפסים ולא הולכים למינוס,
  // כדי ששורה אחת שגויה לא תקזז שווי אמיתי של פריטים אחרים בסיכום.
  const netEntered = Math.max(0, roundQuantity(quantityEntered - tareDeducted));

  const quantityBase = roundQuantity(netEntered * factorToBase);
  const lineValue = roundMoney(quantityBase * pricePerBaseUnit);

  return { quantityBase, lineValue, netEntered, tareDeducted };
}

/**
 * מסכם כמה הזנות של אותו פריט (למשל 2 ארגזים + 7 יחידות של אותו שניצל).
 * @param {Array} lines - כל אחת בפורמט הקלט של computeLine
 */
function sumLines(lines) {
  let quantityBase = 0;
  let totalValue = 0;

  for (const line of lines) {
    const computed = computeLine(line);
    quantityBase += computed.quantityBase;
    totalValue += computed.lineValue;
  }

  return {
    quantityBase: roundQuantity(quantityBase),
    totalValue: roundMoney(totalValue),
  };
}

/** בודק שיחידת בסיס תקינה */
function isValidBaseUnit(baseUnit) {
  return BASE_UNITS.includes(baseUnit);
}

/** תווית עברית ליחידת בסיס */
function baseUnitLabel(baseUnit) {
  return BASE_UNIT_LABELS[baseUnit] || baseUnit;
}

module.exports = {
  BASE_UNITS,
  BASE_UNIT_LABELS,
  QUANTITY_DECIMALS,
  MONEY_DECIMALS,
  round,
  roundQuantity,
  roundMoney,
  toNumber,
  computeLine,
  sumLines,
  isValidBaseUnit,
  baseUnitLabel,
};
