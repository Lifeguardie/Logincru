import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { money, quantity, date, todayIso, baseUnitLabel } from '../lib/format';

/**
 * הזנת רכש בין ספירות.
 * בלי הנתון הזה דוח הצריכה מראה רק שינוי במלאי ולא כמה באמת נצרך.
 */
export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    itemId: '', purchaseDate: todayIso(), quantityBase: '',
    totalCost: '', supplierName: '', invoiceRef: '',
  });

  const selectedItem = items.find((item) => String(item.id) === String(form.itemId));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, catalog] = await Promise.all([
        api.listPurchases({}),
        api.listItems({ limit: 500 }),
      ]);
      setPurchases(list);
      setItems(catalog.items);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    try {
      await api.createPurchase({
        itemId: Number(form.itemId),
        purchaseDate: form.purchaseDate,
        quantityBase: Number(form.quantityBase),
        totalCost: Number(form.totalCost) || 0,
        supplierName: form.supplierName.trim() || null,
        invoiceRef: form.invoiceRef.trim() || null,
      });

      setForm({
        itemId: '', purchaseDate: form.purchaseDate, quantityBase: '',
        totalCost: '', supplierName: form.supplierName, invoiceRef: '',
      });
      setMessage('הרכש נרשם');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('למחוק את רשומת הרכש?')) return;
    try {
      await api.deletePurchase(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <form className="card" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 className="grow" style={{ margin: 0 }}>רישום רכש</h2>
          <Link to="/purchases/import"><button type="button" className="secondary small">ייבוא מאקסל</button></Link>
        </div>
        <p className="muted">
          הכמות מוזנת ביחידת הבסיס של הפריט. הנתון הזה נדרש כדי לחשב
          כמה באמת נצרך בין שתי ספירות.
        </p>

        <div className="row" style={{ alignItems: 'flex-start', marginTop: 10 }}>
          <div className="field grow" style={{ minWidth: 200 }}>
            <label htmlFor="item">פריט</label>
            <select id="item" value={form.itemId} required
              onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
              <option value="">בחר פריט…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({baseUnitLabel(item.baseUnit)})
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="date">תאריך</label>
            <input id="date" type="date" value={form.purchaseDate} required
              onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
          </div>

          <div className="field" style={{ minWidth: 130 }}>
            <label htmlFor="qty">
              כמות {selectedItem ? `(${baseUnitLabel(selectedItem.baseUnit)})` : ''}
            </label>
            <input id="qty" type="number" step="any" min="0.001" required
              value={form.quantityBase}
              onChange={(e) => setForm({ ...form, quantityBase: e.target.value })} />
          </div>

          <div className="field" style={{ minWidth: 130 }}>
            <label htmlFor="cost">עלות כוללת</label>
            <input id="cost" type="number" step="any" min="0"
              value={form.totalCost}
              onChange={(e) => setForm({ ...form, totalCost: e.target.value })} />
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow" style={{ minWidth: 150 }}>
            <label htmlFor="supplier">ספק</label>
            <input id="supplier" value={form.supplierName}
              onChange={(e) => setForm({ ...form, supplierName: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="invoice">מספר חשבונית</label>
            <input id="invoice" value={form.invoiceRef}
              onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} />
          </div>
        </div>

        <button type="submit">רישום</button>
      </form>

      <div className="card">
        <h2>רכש אחרון</h2>

        {loading ? (
          <div className="spinner">טוען…</div>
        ) : purchases.length === 0 ? (
          <div className="empty">עוד לא נרשם רכש</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>פריט</th>
                  <th className="num">כמות</th>
                  <th className="num">עלות</th>
                  <th>ספק</th>
                  <th>חשבונית</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{date(purchase.purchaseDate)}</td>
                    <td>{purchase.itemName}</td>
                    <td className="num">
                      {quantity(purchase.quantityBase)}{' '}
                      <span className="muted">{baseUnitLabel(purchase.baseUnit)}</span>
                    </td>
                    <td className="num">{money(purchase.totalCost)}</td>
                    <td className="muted">{purchase.supplierName || '—'}</td>
                    <td className="muted">{purchase.invoiceRef || '—'}</td>
                    <td>
                      <button className="ghost small" onClick={() => remove(purchase.id)}>מחיקה</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
