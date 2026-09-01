import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { money, baseUnitLabel } from '../lib/format';

/**
 * ייבוא קטלוג מאקסל, בשני שלבים.
 * הכתיבה קורית רק אחרי שהמשתמש ראה בדיוק מה עומד להשתנות -
 * ייבוא עיוול לקטלוג יכול לשבור מחירים של מאות פריטים בבת אחת.
 */
export default function ImportItems() {
  const navigate = useNavigate();

  const [preview, setPreview] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError('');
    setResult(null);

    try {
      setPreview(await api.previewItemsImport(file));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  async function commit() {
    setBusy(true);
    setError('');

    const rows = preview.rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      categoryName: row.categoryName,
      locationName: row.locationName,
      baseUnit: row.baseUnit,
      pricePerBaseUnit: row.pricePerBaseUnit,
      supplierName: row.supplierName,
    }));

    try {
      setResult(await api.commitItemsImport(rows, updateExisting));
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      {result && (
        <div className="alert success">
          הייבוא הושלם: {result.created} פריטים חדשים, {result.updated} עודכנו
          {result.skipped > 0 && `, ${result.skipped} דולגו`}.
        </div>
      )}

      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>ייבוא קטלוג מאקסל</h2>
          <button className="ghost small" onClick={() => navigate('/items')}>חזרה</button>
        </div>

        <p className="muted" style={{ marginTop: 8 }}>
          הקובץ צריך לכלול שורת כותרות. המערכת מזהה בעצמה את העמודות:
          שם פריט (חובה), מק״ט, מחלקה, יחידת מידה, מחיר, ספק, אזור.
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={handleFile} disabled={busy} />
        </div>

        {busy && <div className="spinner">מעבד…</div>}
      </div>

      {preview && (
        <>
          <div className="card">
            <h3>תצוגה מקדימה</h3>

            <div className="stat-grid">
              <div className="stat">
                <div className="label">שורות בקובץ</div>
                <div className="value">{preview.totalRows}</div>
              </div>
              <div className="stat">
                <div className="label">ייווצרו</div>
                <div className="value" style={{ color: 'var(--success)' }}>{preview.willCreate}</div>
              </div>
              <div className="stat">
                <div className="label">יעודכנו</div>
                <div className="value" style={{ color: 'var(--warn)' }}>{preview.willUpdate}</div>
              </div>
              {preview.errors.length > 0 && (
                <div className="stat">
                  <div className="label">שורות עם שגיאה</div>
                  <div className="value" style={{ color: 'var(--danger)' }}>{preview.errors.length}</div>
                </div>
              )}
            </div>

            {preview.errors.length > 0 && (
              <div className="alert warn" style={{ marginTop: 12 }}>
                <strong>שורות שלא ייובאו:</strong>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {preview.errors.map((rowError) => (
                    <li key={rowError.row}>
                      שורה {rowError.row} ({rowError.name}): {rowError.messages.join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="row" style={{ marginTop: 12, cursor: 'pointer', gap: 5 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)} />
              <span style={{ color: 'var(--text)' }}>
                לעדכן פריטים קיימים (אם לא מסומן — רק פריטים חדשים ייווצרו)
              </span>
            </label>

            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={commit} disabled={busy || preview.rows.length === 0}>
                אישור וייבוא {preview.rows.length} שורות
              </button>
              <button className="ghost" onClick={() => setPreview(null)}>ביטול</button>
            </div>
          </div>

          <div className="card">
            <h3>השורות שייובאו</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>פעולה</th>
                    <th>שם</th>
                    <th>מק״ט</th>
                    <th>מחלקה</th>
                    <th>אזור</th>
                    <th>יחידה</th>
                    <th className="num">מחיר</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row}>
                      <td>
                        <span className={`badge ${row.action === 'create' ? 'open' : 'warn'}`}>
                          {row.action === 'create' ? 'חדש' : 'עדכון'}
                        </span>
                      </td>
                      <td>{row.name}</td>
                      <td className="muted">{row.sku || '—'}</td>
                      <td className="muted">{row.categoryName || '—'}</td>
                      <td className="muted">{row.locationName || '—'}</td>
                      <td>
                        {baseUnitLabel(row.baseUnit)}
                        {row.baseUnitWasGuessed && (
                          <span className="badge warn" style={{ marginRight: 5 }}>שוער</span>
                        )}
                      </td>
                      <td className="num">
                        {money(row.pricePerBaseUnit)}
                        {row.priceWasMissing && (
                          <span className="badge warn" style={{ marginRight: 5 }}>חסר</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
