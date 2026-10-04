import test from 'node:test';
import assert from 'node:assert/strict';

// שכבת תאימות מינימלית כדי להריץ את קוד הדפדפן ב-node
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { api } = await import('./api.js');
const queue = await import('./queue.js');

const read = () => JSON.parse(localStorage.getItem('inventory.pendingLines') || '[]');
const line = (unitId, qty) => ({ countId: 4, itemId: 3, locationId: 2, itemUnitId: unitId, quantityEntered: qty });

test('הזנה שנכנסת בזמן ששליחה באוויר לא נדרסת ונשלחת בסופו של דבר', async () => {
  store.clear();
  const calls = [];
  let releaseFirst;
  const firstInFlight = new Promise((resolve) => { releaseFirst = resolve; });

  api.saveLines = async (countId, lines) => {
    calls.push(lines.map((l) => `${l.itemUnitId}=${l.quantityEntered}`));
    if (calls.length === 1) await firstInFlight; // הבקשה הראשונה "תקועה" ברשת איטית
    return { saved: lines };
  };

  queue.enqueue(line(7, 2));          // מתחילה שליחה, תקועה
  await new Promise((r) => setTimeout(r, 10));
  queue.enqueue(line(6, 9));          // נכנסת לתור בזמן שהראשונה באוויר
  queue.enqueue(line(8, 3));
  assert.equal(read().length, 3, 'שלוש הזנות בתור לפני שהראשונה חזרה');

  releaseFirst();                     // הרשת "חוזרת"
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(read().length, 0, 'הכל נשלח - שום הזנה לא נדרסה');
  const sent = calls.flat();
  assert.ok(sent.includes('6=9'), 'ההזנה השנייה הגיעה לשרת');
  assert.ok(sent.includes('8=3'), 'ההזנה השלישית הגיעה לשרת');
});

test('ערך חדש לאותו שדה בזמן שליחה - נשלח הערך החדש, לא נמחק כ"נשלח"', async () => {
  store.clear();
  const calls = [];
  let releaseFirst;
  const firstInFlight = new Promise((resolve) => { releaseFirst = resolve; });

  api.saveLines = async (countId, lines) => {
    calls.push(lines.map((l) => `${l.itemUnitId}=${l.quantityEntered}`));
    if (calls.length === 1) await firstInFlight;
    return { saved: lines };
  };

  queue.enqueue(line(7, 2));          // שולח 7=2, תקוע
  await new Promise((r) => setTimeout(r, 10));
  queue.enqueue(line(7, 5));          // המשתמש תיקן ל-5 בזמן שה-2 באוויר
  releaseFirst();
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(read().length, 0);
  assert.ok(calls.flat().includes('7=5'), 'התיקון ל-5 הגיע לשרת ולא נבלע');
});

test('enqueueMany שולח אצווה אחת', async () => {
  store.clear();
  const calls = [];
  api.saveLines = async (countId, lines) => { calls.push(lines.length); return { saved: lines }; };

  queue.enqueueMany([line(6, 1), line(7, 2), line(8, 3), line(9, 4)]);
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(read().length, 0);
  assert.deepEqual(calls, [4], 'ארבע שורות בבקשה אחת');
});
