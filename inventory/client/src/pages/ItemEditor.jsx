import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money, quantity, baseUnitLabel } from '../lib/format';

const BASE_UNITS = [
  { value: 'kg', label: 'קילוגרם' },
  { value: 'liter', label: 'ליטר' },
  { value: 'unit', label: 'יחידה' },
];

const EMPTY_ITEM = {
  sku: '', name: '', categoryId: '', baseUnit: 'kg',
  pricePerBaseUnit: '', supplierName: '', notes: '', active: true, locationIds: [],
};

/**
 * עריכת פריט ויחידות הספירה שלו.
 *
 * המסך הזה הוא המקום שבו נקבע איך פריט שמתומחר בקילו נספר ביחידות:
 * מגדירים מחיר לקילו, ואז יחידת ספירה "יחידה" עם מקדם = משקל היחידה.
 */
export default function ItemEditor() {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const isNew = !itemId;

  const [item, setItem] = useState(EMPTY_ITEM);
  const [units, setUnits] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [newUnit, setNewUnit] = useState({ unitName: '', factorToBase: '', tareWeight: '' });
  const [editingUnit, setEditingUnit] = useState(null);

  useEffect(() => {
    Promise.all([api.listCategories(), api.listLocations()])
      .then(([cats, locs]) => { setCategories(cats); setLocations(locs); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (isNew) return;

    api.getItem(itemId)
      .then((data) => {
        setItem({
          sku: data.sku || '',
          name: data.name,
          categoryId: data.categoryId || '',
          baseUnit: data.baseUnit,
          pricePerBaseUnit: String(data.pricePerBaseUnit),
          supplierName: data.supplierName || '',
          notes: data.notes || '',
          active: data.active,
          locationIds: data.locationIds,
        });
        setUnits(data.units);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [itemId, isNew]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');

    const payload = {
      ...item,
      sku: item.sku.trim() || null,
      categoryId: item.categoryId || null,
      pricePerBaseUnit: Number(item.pricePerBaseUnit) || 0,
      supplierName: item.supplierName.trim() || null,
      notes: item.notes.trim() || null,
    };

    try {
      if (isNew) {
        const created = await api.createItem(payload);
        navigate(`/items/${created.id}`, { replace: true });
      } else {
        await api.updateItem(itemId, payload);
        setMessage('נשמר');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function addUnit(event) {
    event.preventDefault();
    setError('');

    try {
      await api.addItemUnit(itemId, {
        unitName: newUnit.unitName.trim(),
        factorToBase: Number(newUnit.factorToBase),
        tareWeight: newUnit.tareWeight === '' ? null : Number(newUnit.tareWeight),
        sortOrder: units.length,
      });
      setNewUnit({ unitName: '', factorToBase: '', tareWeight: '' });
      setUnits((await api.getItem(itemId)).units);
    } catch (err) {
      setError(err.message);
    }
  }

  /** שמירת עריכה של יחידה קיימת, או סימון כברירת מחדל */
  async function saveUnit(unit, patch) {
    setError('');
    try {
      await api.updateItemUnit(itemId, unit.id, {
        unitName: unit.unitName,
        factorToBase: Number(unit.factorToBase),
        tareWeight: unit.tareWeight === '' || unit.tareWeight === null ? null : Number(unit.tareWeight),
        isDefault: unit.isDefault,
        sortOrder: unit.sortOrder,
        ...patch,
      });
      setEditingUnit(null);
      setUnits((await api.getItem(itemId)).units);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeUnit(unitId) {
    if (!window.confirm('למחוק את יחידת הספירה?')) return;

    try {
      await api.deleteItemUnit(itemId, unitId);
      setUnits((await api.getItem(itemId)).units);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleLocation(locationId) {
    setItem((previous) => ({
      ...previous,
      locationIds: previous.locationIds.includes(locationId)
        ? previous.locationIds.filter((id) => id !== locationId)
        : [...previous.locationIds, locationId],
    }));
  }

  if (loading) return <div className="spinner">טוען…</div>;

  const price = Number(item.pricePerBaseUnit) || 0;

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <form className="card" onSubmit={save}>
        <h2>{isNew ? 'פריט חדש' : item.name}</h2>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow" style={{ minWidth: 200 }}>
            <label htmlFor="name">שם הפריט</label>
            <input id="name" value={item.name} required
              onChange={(e) => setItem({ ...item, name: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 130 }}>
            <label htmlFor="sku">מק״ט</label>
            <input id="sku" value={item.sku}
              onChange={(e) => setItem({ ...item, sku: e.target.value })} />
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow" style={{ minWidth: 150 }}>
            <label htmlFor="category">מחלקה</label>
            <select id="category" value={item.categoryId}
              onChange={(e) => setItem({ ...item, categoryId: e.target.value })}>
              <option value="">ללא מחלקה</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="baseUnit">יחידת בסיס</label>
            <select id="baseUnit" value={item.baseUnit}
              onChange={(e) => setItem({ ...item, baseUnit: e.target.value })}>
              {BASE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="price">מחיר ל{baseUnitLabel(item.baseUnit)}</label>
            <input id="price" type="number" step="any" min="0" value={item.pricePerBaseUnit}
              onChange={(e) => setItem({ ...item, pricePerBaseUnit: e.target.value })} />
          </div>
        </div>

        <p className="muted" style={{ marginTop: -4 }}>
          יחידת הבסיס היא זו שהמחיר מתייחס אליה. פריט שנקנה לפי משקל אבל נספר
          ביחידות — בחר קילוגרם כאן, והגדר למטה יחידת ספירה "יחידה" עם המשקל שלה.
        </p>

        <div className="field">
          <label htmlFor="supplier">ספק</label>
          <input id="supplier" value={item.supplierName}
            onChange={(e) => setItem({ ...item, supplierName: e.target.value })} />
        </div>

        <div className="field">
          <label>אזורי ספירה</label>
          <div className="row">
            {locations.map((location) => (
              <label key={location.id} className="row" style={{ cursor: 'pointer', gap: 5, margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={item.locationIds.includes(location.id)}
                  onChange={() => toggleLocation(location.id)} />
                <span style={{ color: 'var(--text)' }}>{location.name}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="row" style={{ cursor: 'pointer', gap: 5, marginBottom: 14 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={item.active}
            onChange={(e) => setItem({ ...item, active: e.target.checked })} />
          <span style={{ color: 'var(--text)' }}>פריט פעיל</span>
        </label>

        <div className="row">
          <button type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="ghost" onClick={() => navigate('/items')}>חזרה</button>
        </div>
      </form>

      {!isNew && (
        <div className="card">
          <h3>יחידות ספירה</h3>
          <p className="muted">
            המקדם הוא כמה {baseUnitLabel(item.baseUnit)} יש ביחידת ספירה אחת.
            לדוגמה: ארגז ששוקל 5 ק״ג — מקדם 5. שניצל ששוקל 180 גרם — מקדם 0.18.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>יחידה</th>
                  <th className="num">מקדם</th>
                  <th className="num">שווה ל־</th>
                  <th className="num">טרה</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  const editing = editingUnit && editingUnit.id === unit.id;
                  if (editing) {
                    return (
                      <tr key={unit.id}>
                        <td><input value={editingUnit.unitName} style={{ minWidth: 90 }}
                          onChange={(e) => setEditingUnit({ ...editingUnit, unitName: e.target.value })} /></td>
                        <td className="num"><input type="number" step="any" min="0.0001" value={editingUnit.factorToBase} style={{ width: 90 }}
                          onChange={(e) => setEditingUnit({ ...editingUnit, factorToBase: e.target.value })} /></td>
                        <td className="num muted">{quantity(Number(editingUnit.factorToBase) || 0)} {baseUnitLabel(item.baseUnit)}</td>
                        <td className="num"><input type="number" step="any" min="0" value={editingUnit.tareWeight ?? ''} placeholder="—" style={{ width: 80 }}
                          onChange={(e) => setEditingUnit({ ...editingUnit, tareWeight: e.target.value })} /></td>
                        <td className="row" style={{ gap: 4 }}>
                          <button className="small" onClick={() => saveUnit(editingUnit)}>שמירה</button>
                          <button className="ghost small" onClick={() => setEditingUnit(null)}>ביטול</button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={unit.id}>
                      <td>
                        {unit.unitName}
                        {unit.isDefault && <span className="badge open" style={{ marginRight: 6 }}>ברירת מחדל</span>}
                      </td>
                      <td className="num">{quantity(unit.factorToBase)}</td>
                      <td className="num">
                        {quantity(unit.factorToBase)} {baseUnitLabel(item.baseUnit)}
                        <span className="muted"> = {money(unit.factorToBase * price)}</span>
                      </td>
                      <td className="num">{unit.tareWeight ? quantity(unit.tareWeight) : '—'}</td>
                      <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button className="ghost small" onClick={() => setEditingUnit({ ...unit, tareWeight: unit.tareWeight ?? '' })}>עריכה</button>
                        {!unit.isDefault && (
                          <button className="ghost small" onClick={() => saveUnit(unit, { isDefault: true })}>ברירת מחדל</button>
                        )}
                        <button className="ghost small" onClick={() => removeUnit(unit.id)}>מחיקה</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form className="row" style={{ marginTop: 12, alignItems: 'flex-end' }} onSubmit={addUnit}>
            <div className="field grow" style={{ minWidth: 130, margin: 0 }}>
              <label htmlFor="unit-name">שם יחידה</label>
              <input id="unit-name" value={newUnit.unitName} required placeholder="ארגז"
                onChange={(e) => setNewUnit({ ...newUnit, unitName: e.target.value })} />
            </div>
            <div className="field" style={{ minWidth: 110, margin: 0 }}>
              <label htmlFor="unit-factor">מקדם</label>
              <input id="unit-factor" type="number" step="any" min="0.0001" required
                value={newUnit.factorToBase} placeholder="5"
                onChange={(e) => setNewUnit({ ...newUnit, factorToBase: e.target.value })} />
            </div>
            <div className="field" style={{ minWidth: 110, margin: 0 }}>
              <label htmlFor="unit-tare">טרה (רשות)</label>
              <input id="unit-tare" type="number" step="any" min="0"
                value={newUnit.tareWeight} placeholder="0.25"
                onChange={(e) => setNewUnit({ ...newUnit, tareWeight: e.target.value })} />
            </div>
            <button type="submit" className="secondary">הוספה</button>
          </form>

          <p className="muted" style={{ marginTop: 8 }}>
            טרה = משקל האריזה הריקה, באותה יחידה שמזינים. מוגדר רק ליחידות ששוקלים
            בהן מיכל פתוח, והמערכת מנכה אותו אוטומטית.
          </p>
        </div>
      )}
    </>
  );
}
