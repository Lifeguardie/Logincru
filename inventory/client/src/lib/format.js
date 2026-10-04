/** עיצוב מספרים, כמויות ותאריכים לתצוגה בעברית */

const BASE_UNIT_LABELS = { kg: 'ק"ג', liter: 'ליטר', unit: 'יחידה' };

export const baseUnitLabel = (baseUnit) => BASE_UNIT_LABELS[baseUnit] || baseUnit || '';

/** סכום כספי עם סימן שקל */
export function money(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 2,
  });
}

/** כמות - עד 3 ספרות אחרי הנקודה, בלי אפסים מיותרים */
export function quantity(value) {
  const number = Number(value) || 0;
  return number.toLocaleString('he-IL', { maximumFractionDigits: 3 });
}

/** אחוז עם סימן, או "חדש" כשאין בסיס להשוואה */
export function percent(value) {
  if (value === null || value === undefined) return 'חדש';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toLocaleString('he-IL', { maximumFractionDigits: 1 })}%`;
}

/** תאריך בפורמט ישראלי */
export function date(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString('he-IL');
}

/** תאריך כ-YYYY-MM-DD לפי אזור הזמן המקומי ולא UTC. ברירת מחדל: היום */
export function todayIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** מפתח חודש YYYY-MM מתוך תאריך (מחרוזת ISO או Date) */
export function monthKey(value) {
  const text = value instanceof Date ? todayIso(value) : String(value);
  return text.slice(0, 7);
}

/** "אוקטובר 2026" */
export function monthLabel(value) {
  const key = monthKey(value);
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

/** YYYY-MM של החודש הקודם לחודש נתון (ברירת מחדל: היום) */
export function previousMonthKey(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
