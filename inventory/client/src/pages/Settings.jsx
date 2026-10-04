import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * הגדרות הקטלוג: אזורי ספירה ומחלקות.
 * אזור = דף ספירה אחד. מכאן גם נכנסים לסידור הפריטים בדף.
 */
function EditableList({ title, hint, items, onCreate, onUpdate, renderExtra }) {
  const [newName, setNewName] = useState('');
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');

  async function create(event) {
    event.preventDefault();
    if (!newName.trim()) return;
    setError('');
    try {
      await onCreate({ name: newName.trim(), sortOrder: items.length });
      setNewName('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function rename(row) {
    const name = (drafts[row.id] ?? row.name).trim();
    if (!name || name === row.name) { setDrafts((d) => ({ ...d, [row.id]: undefined })); return; }
    setError('');
    try {
      await onUpdate(row.id, { name, sortOrder: row.sortOrder, active: row.active });
    } catch (err) {
      setError(err.message);
    } finally {
      // גם בכישלון (שם כפול) השדה חוזר לשם השמור, לא נשאר עם טיוטה שנראית כאילו נשמרה
      setDrafts((d) => ({ ...d, [row.id]: undefined }));
    }
  }

  /** הזזה למעלה/למטה: כותבים מחדש את sortOrder לפי המיקום החדש */
  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setError('');
    try {
      for (const [position, row] of reordered.entries()) {
        if (row.sortOrder !== position) {
          await onUpdate(row.id, { name: row.name, sortOrder: position, active: row.active }, { silent: true });
        }
      }
      await onUpdate(null);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      {error && <div className="alert error">{error}</div>}

      <form className="row" style={{ marginBottom: 12 }} onSubmit={create}>
        <input className="grow" placeholder="שם חדש…" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ minWidth: 160 }} />
        <button type="submit" className="secondary" disabled={!newName.trim()}>הוספה</button>
      </form>

      <div className="table-wrap">
        <table>
          <tbody>
            {items.map((row, index) => (
              <tr key={row.id} style={{ opacity: row.active ? 1 : 0.5 }}>
                <td style={{ width: 70, whiteSpace: 'nowrap' }}>
                  <button className="ghost small" disabled={index === 0} onClick={() => move(index, -1)} title="למעלה">▲</button>
                  <button className="ghost small" disabled={index === items.length - 1} onClick={() => move(index, 1)} title="למטה">▼</button>
                </td>
                <td>
                  <input
                    value={drafts[row.id] ?? row.name}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                    onBlur={() => rename(row)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    style={{ minWidth: 140 }}
                  />
                </td>
                <td style={{ width: 80 }}>
                  <label className="row" style={{ gap: 4, cursor: 'pointer', margin: 0 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={row.active}
                      onChange={(e) => onUpdate(row.id, { name: row.name, sortOrder: row.sortOrder, active: e.target.checked })} />
                    <span style={{ color: 'var(--text)', fontSize: 13 }}>פעיל</span>
                  </label>
                </td>
                {renderExtra && <td style={{ width: 120 }}>{renderExtra(row)}</td>}
              </tr>
            ))}
            {items.length === 0 && <tr><td className="muted">אין עדיין</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Settings() {
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [locs, cats] = await Promise.all([
        api.listLocations({ includeInactive: 'true' }),
        api.listCategories({ includeInactive: 'true' }),
      ]);
      setLocations(locs);
      setCategories(cats);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** עטיפה: אחרי כל שינוי טוענים מחדש, אלא אם ביקשו שקט (סדרת עדכונים) */
  const updater = (fn) => async (id, body, options = {}) => {
    if (id !== null) await fn(id, body);
    if (!options.silent) await load();
  };

  if (loading) return <div className="spinner">טוען…</div>;

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <EditableList
        title="אזורי ספירה"
        hint="כל אזור הוא דף ספירה אחד: מטבח, בר, מחסן, מקרר. הסדר כאן הוא סדר האזורים בדשבורד."
        items={locations}
        onCreate={async (body) => { await api.createLocation(body); await load(); }}
        onUpdate={updater(api.updateLocation)}
        renderExtra={(row) => (
          <Link to={`/settings/locations/${row.id}/order`}>
            <button className="secondary small">סדר הדף</button>
          </Link>
        )}
      />

      <EditableList
        title="מחלקות"
        hint="לסיווג הפריטים בדוחות: ירקות, בשר, אלכוהול, יבשים."
        items={categories}
        onCreate={async (body) => { await api.createCategory(body); await load(); }}
        onUpdate={updater(api.updateCategory)}
      />
    </>
  );
}
