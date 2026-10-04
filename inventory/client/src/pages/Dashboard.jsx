import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, date, todayIso, monthKey, monthLabel } from '../lib/format';
import { ValueTrend, CategoryBreakdown } from '../components/Charts';

/** מסך הבית: הספירה הפעילה, ההתקדמות לפי אזור, וספירות קודמות */
export default function Dashboard() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [counts, setCounts] = useState([]);
  const [progress, setProgress] = useState([]);
  const [latestSummary, setLatestSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCount, setNewCount] = useState({ name: '', countDate: todayIso() });

  const activeCount = counts.find((count) => count.status === 'open') || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const list = await api.listCounts();
      setCounts(list);

      const open = list.find((count) => count.status === 'open');
      setProgress(open ? await api.getProgress(open.id) : []);

      // פילוח המחלקות של הספירה הסגורה האחרונה, לגרף
      const latestClosed = list.find((count) => count.status === 'closed');
      setLatestSummary(latestClosed ? await api.getSummary(latestClosed.id) : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createCount(event) {
    event.preventDefault();
    setError('');

    try {
      const created = await api.createCount({
        name: newCount.name.trim(),
        countDate: newCount.countDate,
      });
      setCreating(false);
      setNewCount({ name: '', countDate: todayIso() });
      await load();
      return created;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function closeCount() {
    const counted = progress.reduce((sum, row) => sum + row.countedItems, 0);
    const total = progress.reduce((sum, row) => sum + row.totalItems, 0);
    const missing = total - counted;

    const warning = missing > 0
      ? `נספרו ${counted} מתוך ${total} פריטים - ${missing} פריטים עדיין לא נספרו.\n\n`
      : `נספרו כל ${total} הפריטים.\n\n`;

    if (!window.confirm(`${warning}לסגור את הספירה? אחרי הסגירה לא ניתן להזין עוד כמויות.`)) return;

    try {
      await api.closeCount(activeCount.id);
      await load();
      navigate(`/counts/${activeCount.id}/summary`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCount() {
    if (!window.confirm(`למחוק את הספירה "${activeCount.name}"? כל הכמויות שהוזנו בה יימחקו. אי אפשר לבטל.`)) return;

    try {
      await api.deleteCount(activeCount.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="spinner">טוען…</div>;

  const closedCounts = counts.filter((count) => count.status === 'closed');
  const totalCounted = progress.reduce((sum, row) => sum + row.countedItems, 0);
  const totalItems = progress.reduce((sum, row) => sum + row.totalItems, 0);
  const totalValue = progress.reduce((sum, row) => sum + row.totalValue, 0);

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      {activeCount ? (
        <>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="grow">
                <h2 style={{ margin: 0 }}>{activeCount.name}</h2>
                <span className="muted">{date(activeCount.countDate)}</span>
              </div>
              <span className="badge open">פתוחה</span>
            </div>

            <div className="stat-grid">
              <div className="stat">
                <div className="label">פריטים שנספרו</div>
                <div className="value">{totalCounted}<span className="muted" style={{ fontSize: 15 }}> / {totalItems}</span></div>
              </div>
              <div className="stat">
                <div className="label">שווי מצטבר</div>
                <div className="value">{money(totalValue)}</div>
              </div>
            </div>

            {can('manager') && (
              <div className="row" style={{ marginTop: 12 }}>
                <Link to={`/counts/${activeCount.id}/summary`}><button className="secondary">סיכום</button></Link>
                <button className="danger" onClick={closeCount}>סגירת ספירה</button>
                <button className="ghost" onClick={deleteCount} title="מחיקת ספירה שנפתחה בטעות">מחיקה</button>
              </div>
            )}
          </div>

          <h2 style={{ fontSize: 16, margin: '18px 0 10px' }}>בחר אזור לספירה</h2>

          {progress.map((row) => {
            const percentDone = row.totalItems > 0
              ? Math.round((row.countedItems / row.totalItems) * 100)
              : 0;

            return (
              <Link
                key={row.locationId}
                to={`/counts/${activeCount.id}/sheet/${row.locationId}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card" style={{ marginBottom: 10 }}>
                  <div className="row">
                    <div className="grow">
                      <strong style={{ fontSize: 16 }}>{row.locationName}</strong>
                      <div className="muted">{row.countedItems} מתוך {row.totalItems} פריטים</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{money(row.totalValue)}</div>
                      <div className="muted">{percentDone}%</div>
                    </div>
                  </div>
                  <div className="progress-bar"><div style={{ width: `${percentDone}%` }} /></div>
                </div>
              </Link>
            );
          })}

          {progress.length === 0 && (
            <div className="empty">
              אין אזורי ספירה מוגדרים. יש להוסיף פריטים ולשייך אותם לאזורים.
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <h2>אין ספירה פתוחה</h2>

          {!can('manager') ? (
            <p className="muted">רק מנהל יכול לפתוח ספירה חדשה.</p>
          ) : creating ? (
            <form onSubmit={createCount}>
              <div className="field">
                <label htmlFor="count-name">שם הספירה</label>
                <input
                  id="count-name"
                  value={newCount.name}
                  onChange={(e) => setNewCount({ ...newCount, name: e.target.value })}
                  placeholder="לדוגמה: ספירת סוף חודש"
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="count-date">תאריך</label>
                <input
                  id="count-date"
                  type="date"
                  value={newCount.countDate}
                  onChange={(e) => setNewCount({ ...newCount, countDate: e.target.value })}
                  required
                />
              </div>
              <div className="row">
                <button type="submit">פתיחה</button>
                <button type="button" className="ghost" onClick={() => setCreating(false)}>ביטול</button>
              </div>
            </form>
          ) : (
            <button onClick={() => {
              setNewCount({ name: `ספירת ${monthLabel(todayIso())}`, countDate: todayIso() });
              setCreating(true);
            }}>פתיחת ספירה חדשה</button>
          )}
        </div>
      )}

      {closedCounts.length >= 2 && (
        <div className="card">
          <h2>שווי המלאי לאורך זמן</h2>
          <ValueTrend
            points={[...closedCounts].reverse().map((count) => ({
              label: count.countDate, name: count.name, value: count.totalValue,
            }))}
          />
        </div>
      )}

      {latestSummary && latestSummary.byCategory.length > 0 && (
        <div className="card">
          <h2>
            פילוח לפי מחלקה
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}> · {latestSummary.count.name}</span>
          </h2>
          <CategoryBreakdown groups={latestSummary.byCategory} />
        </div>
      )}

      {closedCounts.length > 0 && (
        <div className="card">
          <h2>ספירות קודמות</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>תאריך</th>
                  <th className="num">פריטים</th>
                  <th className="num">שווי</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {closedCounts.map((count, index) => {
                  const key = monthKey(count.countDate);
                  const newMonth = index === 0 || monthKey(closedCounts[index - 1].countDate) !== key;
                  return [
                    newMonth && (
                      <tr key={`m-${key}`} className="month-row">
                        <td colSpan={5}>{monthLabel(count.countDate)}</td>
                      </tr>
                    ),
                  <tr key={count.id}>
                    <td>{count.name}</td>
                    <td>{date(count.countDate)}</td>
                    <td className="num">{count.countedItems}</td>
                    <td className="num">{money(count.totalValue)}</td>
                    <td>
                      <Link to={`/counts/${count.id}/summary`}>
                        <button className="secondary small">סיכום</button>
                      </Link>
                    </td>
                  </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
