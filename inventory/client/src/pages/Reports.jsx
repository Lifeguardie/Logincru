import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { money, quantity, date, baseUnitLabel } from '../lib/format';

/**
 * דוח צריכה בין שתי ספירות:
 *   נצרך = מלאי פתיחה + רכש שבתווך - מלאי סגירה
 */
export default function Reports() {
  const [counts, setCounts] = useState([]);
  const [openingId, setOpeningId] = useState('');
  const [closingId, setClosingId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listCounts()
      .then((list) => {
        const closed = list.filter((count) => count.status === 'closed');
        setCounts(closed);

        // ברירת מחדל: שתי הספירות הסגורות האחרונות
        if (closed.length >= 2) {
          setClosingId(String(closed[0].id));
          setOpeningId(String(closed[1].id));
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  async function run(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setReport(null);

    try {
      setReport(await api.getConsumption(openingId, closingId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <form className="card" onSubmit={run}>
        <h2>דוח צריכה</h2>
        <p className="muted">
          מחושב לפי: מלאי פתיחה + רכש שנרשם בתווך − מלאי סגירה.
        </p>

        <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
          <div className="field grow" style={{ minWidth: 180, margin: 0 }}>
            <label htmlFor="opening">ספירת פתיחה</label>
            <select id="opening" value={openingId} required
              onChange={(e) => setOpeningId(e.target.value)}>
              <option value="">בחר…</option>
              {counts.map((count) => (
                <option key={count.id} value={count.id}>
                  {count.name} ({date(count.countDate)})
                </option>
              ))}
            </select>
          </div>

          <div className="field grow" style={{ minWidth: 180, margin: 0 }}>
            <label htmlFor="closing">ספירת סגירה</label>
            <select id="closing" value={closingId} required
              onChange={(e) => setClosingId(e.target.value)}>
              <option value="">בחר…</option>
              {counts.map((count) => (
                <option key={count.id} value={count.id}>
                  {count.name} ({date(count.countDate)})
                </option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={loading || !openingId || !closingId}>
            {loading ? 'מחשב…' : 'הפקה'}
          </button>
        </div>

        {counts.length < 2 && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            צריך לפחות שתי ספירות סגורות כדי להפיק דוח צריכה.
          </div>
        )}
      </form>

      {report && (
        <>
          <div className="card">
            <div className="row">
              <div className="grow">
                <h3 style={{ margin: 0 }}>
                  {date(report.opening.countDate)} → {date(report.closing.countDate)}
                </h3>
                <span className="muted">{report.opening.name} עד {report.closing.name}</span>
              </div>
              <button className="secondary small"
                onClick={() => api.exportConsumption(openingId, closingId)}>
                ייצוא לאקסל
              </button>
            </div>

            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat">
                <div className="label">עלות צריכה כוללת</div>
                <div className="value">{money(report.totalConsumptionCost)}</div>
              </div>
              <div className="stat">
                <div className="label">פריטים בדוח</div>
                <div className="value">{report.items.length}</div>
              </div>
            </div>

            {report.itemsWithoutPurchaseData > 0 && (
              <div className="alert warn" style={{ marginTop: 12 }}>
                ב-{report.itemsWithoutPurchaseData} פריטים יצאה צריכה שלילית — כלומר
                המלאי גדל בלי שנרשם רכש. כנראה חסר דיווח רכש לתקופה הזו.
              </div>
            )}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>פריט</th>
                    <th>מחלקה</th>
                    <th className="num">פתיחה</th>
                    <th className="num">רכש</th>
                    <th className="num">סגירה</th>
                    <th className="num">נצרך</th>
                    <th className="num">עלות צריכה</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.itemId}>
                      <td>
                        {item.itemName}
                        {item.hasNegativeConsumption && (
                          <span className="badge danger" style={{ marginRight: 6 }}>שלילי</span>
                        )}
                      </td>
                      <td className="muted">{item.categoryName}</td>
                      <td className="num">{quantity(item.openingQuantity)}</td>
                      <td className="num">{quantity(item.purchasedQuantity)}</td>
                      <td className="num">{quantity(item.closingQuantity)}</td>
                      <td className="num">
                        {quantity(item.consumedQuantity)}{' '}
                        <span className="muted">{baseUnitLabel(item.baseUnit)}</span>
                      </td>
                      <td className="num">{money(item.consumedCost)}</td>
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
