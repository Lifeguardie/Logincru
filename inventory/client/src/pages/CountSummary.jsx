import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, quantity, percent, date, baseUnitLabel } from '../lib/format';

/** סיכום ספירה: שווי, פילוחים, והשוואה לספירה הקודמת עם סימון חריגות */
export default function CountSummary() {
  const { countId } = useParams();
  const { can } = useAuth();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyVariances, setOnlyVariances] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.getSummary(countId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [countId]);

  useEffect(() => { load(); }, [load]);

  async function reopen() {
    if (!window.confirm('לפתוח מחדש את הספירה לעריכה?')) return;
    try {
      await api.reopenCount(countId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div className="spinner">טוען…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!summary) return null;

  const { count, comparison } = summary;
  const changes = comparison
    ? (onlyVariances ? comparison.changes.filter((c) => c.isVariance) : comparison.changes)
    : [];
  const varianceCount = comparison ? comparison.changes.filter((c) => c.isVariance).length : 0;

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <h2 style={{ margin: 0 }}>{count.name}</h2>
            <span className="muted">{date(count.countDate)}</span>
          </div>
          <span className={`badge ${count.status === 'open' ? 'open' : 'closed'}`}>
            {count.status === 'open' ? 'פתוחה' : 'סגורה'}
          </span>
        </div>

        <div className="stat-grid" style={{ marginTop: 12 }}>
          <div className="stat">
            <div className="label">שווי המלאי</div>
            <div className="value">{money(summary.totalValue)}</div>
          </div>
          <div className="stat">
            <div className="label">פריטים שנספרו</div>
            <div className="value">{summary.countedItems}</div>
          </div>
          {comparison && (
            <div className="stat">
              <div className="label">שינוי מהספירה הקודמת</div>
              <div className="value" style={{ color: comparison.valueDiff < 0 ? 'var(--danger)' : 'var(--success)' }}>
                {money(comparison.valueDiff)}
              </div>
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={() => api.exportCount(countId, count.name)}>
            ייצוא לאקסל
          </button>
          {can('manager') && count.status === 'closed' && (
            <button className="ghost" onClick={reopen}>פתיחה מחדש</button>
          )}
          <Link to="/"><button className="ghost">חזרה</button></Link>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="card grow" style={{ minWidth: 260 }}>
          <h3>לפי מחלקה</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>מחלקה</th><th className="num">פריטים</th><th className="num">שווי</th></tr></thead>
              <tbody>
                {summary.byCategory.map((group) => (
                  <tr key={group.id}>
                    <td>{group.name}</td>
                    <td className="num">{group.itemCount}</td>
                    <td className="num">{money(group.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card grow" style={{ minWidth: 260 }}>
          <h3>לפי אזור</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>אזור</th><th className="num">פריטים</th><th className="num">שווי</th></tr></thead>
              <tbody>
                {summary.byLocation.map((group) => (
                  <tr key={group.id}>
                    <td>{group.name}</td>
                    <td className="num">{group.itemCount}</td>
                    <td className="num">{money(group.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {comparison && (
        <div className="card">
          <div className="row">
            <h3 className="grow" style={{ margin: 0 }}>
              השוואה ל"{comparison.previousCount.name}"
            </h3>
            {varianceCount > 0 && (
              <span className="badge warn">{varianceCount} חריגות</span>
            )}
          </div>

          <p className="muted" style={{ marginTop: 6 }}>
            פריט מסומן כחריגה כשהכמות השתנתה ביותר מ-{comparison.varianceThresholdPercent}%.
          </p>

          {varianceCount > 0 && (
            <label className="row" style={{ marginBottom: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={onlyVariances}
                onChange={(e) => setOnlyVariances(e.target.checked)}
              />
              <span>הצג חריגות בלבד</span>
            </label>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>פריט</th>
                  <th>מחלקה</th>
                  <th className="num">קודם</th>
                  <th className="num">עכשיו</th>
                  <th className="num">שינוי</th>
                  <th className="num">בשקלים</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.itemId}>
                    <td>
                      {change.itemName}
                      {change.isVariance && <span className="badge warn" style={{ marginRight: 6 }}>חריגה</span>}
                    </td>
                    <td className="muted">{change.categoryName}</td>
                    <td className="num">{quantity(change.previousQuantity)}</td>
                    <td className="num">
                      {quantity(change.currentQuantity)} <span className="muted">{baseUnitLabel(change.baseUnit)}</span>
                    </td>
                    <td className="num">{percent(change.percentChange)}</td>
                    <td className="num" style={{ color: change.valueDiff < 0 ? 'var(--danger)' : 'inherit' }}>
                      {money(change.valueDiff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3>פירוט מלא</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>פריט</th>
                <th>אזור</th>
                <th>הזנות</th>
                <th className="num">כמות</th>
                <th className="num">שווי</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr key={`${row.itemId}-${row.locationId}`}>
                  <td>{row.itemName}</td>
                  <td className="muted">{row.locationName}</td>
                  <td className="muted">
                    {row.entries.map((entry) => `${quantity(entry.quantityEntered)} ${entry.unitName}`).join(' + ')}
                  </td>
                  <td className="num">
                    {quantity(row.quantityBase)} <span className="muted">{baseUnitLabel(row.baseUnit)}</span>
                  </td>
                  <td className="num">{money(row.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
