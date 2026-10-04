import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { baseUnitLabel } from '../lib/format';

/**
 * סידור הפריטים בדף הספירה של אזור - כמו בדף הנייר.
 * מסך הספירה מציג את הפריטים בדיוק בסדר הזה.
 */
export default function SheetOrder() {
  const { locationId } = useParams();

  const [location, setLocation] = useState(null);
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getLocationItems(locationId);
      setLocation(data.location);
      setItems(data.items);
      setDirty(false);
    } catch (err) {
      setError(err.message);
    }
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setDirty(true);
    setMessage('');
  }

  function moveToEdge(index, edge) {
    const next = [...items];
    const [row] = next.splice(index, 1);
    if (edge === 'top') next.unshift(row); else next.push(row);
    setItems(next);
    setDirty(true);
    setMessage('');
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.saveLocationOrder(locationId, items.map((item) => item.id));
      setDirty(false);
      setMessage('הסדר נשמר. מסך הספירה יציג את הפריטים כך.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!location) return error ? <div className="alert error">{error}</div> : <div className="spinner">טוען…</div>;

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <h2 style={{ margin: 0 }}>סדר הדף: {location.name}</h2>
            <span className="muted">{items.length} פריטים. סדר אותם כמו בדף הנייר.</span>
          </div>
          <Link to="/settings"><button className="ghost small">חזרה</button></Link>
        </div>

        {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
        {message && <div className="alert success" style={{ marginTop: 10 }}>{message}</div>}

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={save} disabled={!dirty || saving}>{saving ? 'שומר…' : 'שמירת הסדר'}</button>
          {dirty && <button className="ghost" onClick={load}>ביטול שינויים</button>}
        </div>
      </div>

      {items.length === 0 && (
        <div className="empty">אין פריטים משויכים לאזור הזה. משייכים פריט לאזור במסך עריכת הפריט.</div>
      )}

      {items.map((item, index) => (
        <div key={item.id} className="sheet-item uncounted" style={{ padding: '8px 12px' }}>
          <div className="row">
            <span className="muted" style={{ width: 24, textAlign: 'center' }}>{index + 1}</span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{item.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {item.categoryName || 'ללא מחלקה'} · {baseUnitLabel(item.baseUnit)}
              </div>
            </div>
            <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
              <button className="ghost small" disabled={index === 0} onClick={() => moveToEdge(index, 'top')} title="לראש הדף">⤒</button>
              <button className="ghost small" disabled={index === 0} onClick={() => move(index, -1)} title="למעלה">▲</button>
              <button className="ghost small" disabled={index === items.length - 1} onClick={() => move(index, 1)} title="למטה">▼</button>
              <button className="ghost small" disabled={index === items.length - 1} onClick={() => moveToEdge(index, 'bottom')} title="לסוף הדף">⤓</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
