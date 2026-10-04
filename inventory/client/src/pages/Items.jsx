import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, quantity, baseUnitLabel } from '../lib/format';

/** קטלוג הפריטים: חיפוש, סינון, ומעבר לעריכה */
export default function Items() {
  const { can } = useAuth();

  const [data, setData] = useState({ items: [], total: 0 });
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ q: '', categoryId: '', locationId: '', includeInactive: false });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.listCategories(), api.listLocations()])
      .then(([cats, locs]) => { setCategories(cats); setLocations(locs); })
      .catch((err) => setError(err.message));
  }, []);

  const PAGE_SIZE = 100;

  /** טוען עמוד. offset 0 מחליף את הרשימה, אחרת מוסיף בסופה */
  const load = useCallback(async (activeFilters, nextOffset = 0) => {
    if (nextOffset === 0) setLoading(true); else setLoadingMore(true);

    try {
      const page = await api.listItems({
        q: activeFilters.q,
        categoryId: activeFilters.categoryId,
        locationId: activeFilters.locationId,
        includeInactive: activeFilters.includeInactive ? 'true' : undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });

      setData((previous) => nextOffset === 0
        ? page
        : { total: page.total, items: [...previous.items, ...page.items] });
      setOffset(nextOffset + page.items.length);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // דיבאונס על החיפוש - בלי זה כל הקלדה שולחת בקשה
  useEffect(() => {
    const timer = setTimeout(() => load(filters, 0), 250);
    return () => clearTimeout(timer);
  }, [filters, load]);

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 className="grow" style={{ margin: 0 }}>פריטים <span className="muted">({data.total})</span></h2>
          {can('manager') && (
            <>
              <Link to="/items/import"><button className="secondary small">ייבוא מאקסל</button></Link>
              <Link to="/items/new"><button className="small">פריט חדש</button></Link>
            </>
          )}
        </div>

        <div className="row">
          <input
            className="grow"
            type="search"
            placeholder="חיפוש לפי שם או מק״ט…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            style={{ minWidth: 170 }}
          />
          <select
            value={filters.categoryId}
            onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="">כל המחלקות</option>
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <select
            value={filters.locationId}
            onChange={(e) => setFilters({ ...filters, locationId: e.target.value })}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="">כל האזורים</option>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
          <label className="row" style={{ cursor: 'pointer', gap: 5, margin: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }}
              checked={filters.includeInactive}
              onChange={(e) => setFilters({ ...filters, includeInactive: e.target.checked })} />
            <span style={{ color: 'var(--text)' }}>הצג מושבתים</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="spinner">טוען…</div>
      ) : data.items.length === 0 ? (
        <div className="empty">לא נמצאו פריטים</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מחלקה</th>
                  <th>יחידת בסיס</th>
                  <th className="num">מחיר</th>
                  <th>יחידות ספירה</th>
                  {can('manager') && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>
                        {item.name}
                        {!item.active && <span className="badge closed" style={{ marginRight: 6 }}>מושבת</span>}
                      </div>
                      {item.sku && <span className="muted">{item.sku}</span>}
                    </td>
                    <td className="muted">{item.categoryName || '—'}</td>
                    <td>{baseUnitLabel(item.baseUnit)}</td>
                    <td className="num">
                      {money(item.pricePerBaseUnit)}
                      <span className="muted"> / {baseUnitLabel(item.baseUnit)}</span>
                    </td>
                    <td className="muted" style={{ whiteSpace: 'normal' }}>
                      {item.units
                        .map((unit) => `${unit.unitName}${Number(unit.factorToBase) !== 1 ? ` ×${quantity(unit.factorToBase)}` : ''}`)
                        .join(' · ')}
                    </td>
                    {can('manager') && (
                      <td>
                        <Link to={`/items/${item.id}`}>
                          <button className="secondary small">עריכה</button>
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.items.length < data.total && (
            <div className="center" style={{ marginTop: 12 }}>
              <button className="secondary" disabled={loadingMore} onClick={() => load(filters, offset)}>
                {loadingMore ? 'טוען…' : `טען עוד (${data.total - data.items.length} נוספים)`}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
