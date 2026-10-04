import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { money, quantity, date, todayIso } from '../lib/format';

/**
 * ייבוא רכש מאקסל (חשבונית ספק, הזמנה) בשני שלבים.
 * שורה נכנסת רק אם הפריט זוהה בקטלוג ויש לה תאריך. תאריך חסר אפשר
 * להשלים לכל השורות בבת אחת - חשבונית אחת, תאריך אחד.
 */
export default function ImportPurchases() {
  const navigate = useNavigate();

  const [preview, setPreview] = useState(null);
  const [defaultDate, setDefaultDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(''); setResult(null);
    try {
      setPreview(await api.previewPurchasesImport(file));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  const importable = preview
    ? preview.rows.filter((row) => row.matched && (row.purchaseDate || defaultDate))
    : [];
  const totalCost = importable.reduce((sum, row) => sum + (row.totalCost || 0), 0);

  async function commit() {
    setBusy(true); setError('');
    try {
      setResult(await api.commitPurchasesImport(importable.map((row) => ({
        itemId: row.itemId,
        purchaseDate: row.purchaseDate || defaultDate,
        quantityBase: row.quantityBase,
        totalCost: row.totalCost,
        supplierName: row.supplierName,
        invoiceRef: row.invoiceRef,
      }))));
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
      {result && <div className="alert success">הייבוא הושלם: {result.inserted} שורות רכש נרשמו.</div>}

      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>ייבוא רכש מאקסל</h2>
          <button className="ghost small" onClick={() => navigate('/purchases')}>חזרה</button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          עמודות מזוהות: מק״ט או שם פריט (חובה), כמות (חובה, ביחידת הבסיס של הפריט),
          תאריך, עלות, ספק, מספר חשבונית.
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
              <div className="stat"><div className="label">שורות בקובץ</div><div className="value">{preview.totalRows}</div></div>
              <div className="stat"><div className="label">זוהו בקטלוג</div><div className="value" style={{ color: 'var(--success)' }}>{preview.matched}</div></div>
              {preview.unmatched > 0 && (
                <div className="stat"><div className="label">לא זוהו</div><div className="value" style={{ color: 'var(--danger)' }}>{preview.unmatched}</div></div>
              )}
              <div className="stat"><div className="label">סה״כ עלות לייבוא</div><div className="value">{money(totalCost)}</div></div>
            </div>

            {preview.errors.length > 0 && (
              <div className="alert warn" style={{ marginTop: 12 }}>
                <strong>שורות שלא ייובאו:</strong>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {preview.errors.map((rowError) => (
                    <li key={rowError.row}>שורה {rowError.row} ({rowError.name}): {rowError.messages.join(', ')}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.rows.some((row) => !row.purchaseDate) && (
              <div className="field" style={{ marginTop: 12, maxWidth: 260 }}>
                <label htmlFor="default-date">תאריך לשורות בלי תאריך</label>
                <input id="default-date" type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} />
              </div>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={commit} disabled={busy || importable.length === 0}>
                אישור וייבוא {importable.length} שורות
              </button>
              <button className="ghost" onClick={() => setPreview(null)}>ביטול</button>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>פריט בקובץ</th><th>זוהה כ־</th><th>תאריך</th><th className="num">כמות</th><th className="num">עלות</th><th>ספק</th></tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row} style={{ opacity: row.matched ? 1 : 0.55 }}>
                      <td>{row.name || row.sku}</td>
                      <td>
                        {row.matched
                          ? row.matchedItemName
                          : <span className="badge danger">לא נמצא בקטלוג</span>}
                      </td>
                      <td>
                        {row.purchaseDate
                          ? date(row.purchaseDate)
                          : <span className="badge warn">ברירת מחדל</span>}
                      </td>
                      <td className="num">{quantity(row.quantityBase)}</td>
                      <td className="num">
                        {money(row.totalCost)}
                        {row.costWasMissing && <span className="badge warn" style={{ marginRight: 5 }}>חסר</span>}
                      </td>
                      <td className="muted">{row.supplierName || '—'}</td>
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
