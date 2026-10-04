import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { enqueue, enqueueMany, flush } from '../lib/queue';
import { shrinkImage } from '../lib/image';
import { money, quantity, baseUnitLabel } from '../lib/format';
import OcrReview from '../components/OcrReview';

/**
 * דף הספירה של אזור אחד - המקבילה לדף הנייר.
 *
 * לכל פריט מוצג שדה נפרד לכל יחידת ספירה, כדי שאפשר יהיה לרשום
 * "3 בקבוקים + 0.4 ליטר" בלי לחשב כלום בראש. הסכום בק"ג ובשקלים
 * מתעדכן חי מתחת לשורה.
 *
 * ההזנות לא נשלחות ישירות אלא נכנסות לתור שעמיד לניתוקי רשת.
 */

/** מחשב כמות בסיס ושווי לפריט אחד, לפי אותה נוסחה של השרת */
function computeItemTotal(item, values) {
  let quantityBase = 0;

  for (const unit of item.units) {
    const raw = values[unit.id];
    if (raw === undefined || raw === '' || raw === null) continue;

    const entered = Number(raw);
    if (!Number.isFinite(entered)) continue;

    const tare = unit.tareWeight ? Number(unit.tareWeight) : 0;
    const net = Math.max(0, entered - tare);
    quantityBase += net * Number(unit.factorToBase);
  }

  const rounded = Math.round(quantityBase * 1000) / 1000;
  return {
    quantityBase: rounded,
    value: Math.round(rounded * Number(item.pricePerBaseUnit) * 100) / 100,
  };
}

export default function CountSheet() {
  const { countId, locationId } = useParams();

  const [sheet, setSheet] = useState(null);
  const [values, setValues] = useState({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // שומר איזה שדות כבר הוזנו בפועל, כדי להבחין בין "לא נספר" ל"נספר 0"
  const [touched, setTouched] = useState(() => new Set());
  const inputRefs = useRef([]);

  // זיהוי מצילום
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrResult, setOcrResult] = useState(null);
  const [ocrImageUrl, setOcrImageUrl] = useState(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    api.ocrStatus().then((status) => setOcrEnabled(Boolean(status.enabled))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const data = await api.getSheet(countId, locationId);
      setSheet(data);

      const initial = {};
      const initialTouched = new Set();

      for (const item of data.items) {
        for (const entry of item.entries) {
          const unit = item.units.find((u) => u.unitName === entry.unitName);
          if (unit) {
            initial[unit.id] = String(entry.quantityEntered);
            initialTouched.add(unit.id);
          }
        }
      }

      setValues(initial);
      setTouched(initialTouched);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [countId, locationId]);

  useEffect(() => { load(); }, [load]);

  const isClosed = sheet?.count?.status === 'closed';

  /** שינוי בשדה: מעדכן מיד את המסך, ומכניס לתור השמירה */
  function handleChange(item, unit, raw) {
    setValues((previous) => ({ ...previous, [unit.id]: raw }));
    setTouched((previous) => new Set(previous).add(unit.id));

    const trimmed = String(raw).trim();
    // שדה ריק = מחיקת ההזנה. אפס הוא ערך תקין ומשמעותי: "נספר, ואין".
    const parsed = trimmed === '' ? null : Number(trimmed);

    if (parsed !== null && !Number.isFinite(parsed)) return;
    if (parsed !== null && parsed < 0) return;

    enqueue({
      countId: Number(countId),
      itemId: item.id,
      locationId: Number(locationId),
      itemUnitId: unit.id,
      quantityEntered: parsed,
      tareUnits: unit.tareWeight ? 1 : 0,
    });
  }

  /** צילום הדף: מקטין, שולח לזיהוי, ופותח את מסך האישור */
  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setOcrBusy(true);
    setError('');

    try {
      const blob = await shrinkImage(file);
      const result = await api.ocrSheet(countId, locationId, blob);
      setOcrImageUrl(URL.createObjectURL(blob));
      setOcrResult(result);
    } catch (err) {
      setError(err.message || 'הזיהוי נכשל');
    } finally {
      setOcrBusy(false);
    }
  }

  /** המשתמש אישר שורות מהצילום - נכנסות לתור בדיוק כמו הקלדה ידנית */
  function applyOcrRows(entries) {
    const nextValues = {};
    const nextTouched = new Set();
    const lines = [];

    for (const entry of entries) {
      const item = sheet.items.find((i) => i.id === entry.itemId);
      const unit = item?.units.find((u) => u.id === entry.itemUnitId);
      if (!item || !unit) continue;

      nextValues[unit.id] = String(entry.quantity);
      nextTouched.add(unit.id);

      lines.push({
        countId: Number(countId),
        itemId: item.id,
        locationId: Number(locationId),
        itemUnitId: unit.id,
        quantityEntered: entry.quantity,
        tareUnits: unit.tareWeight ? 1 : 0,
        source: 'ocr',
      });
    }

    enqueueMany(lines);
    setValues((previous) => ({ ...previous, ...nextValues }));
    setTouched((previous) => new Set([...previous, ...nextTouched]));
    closeOcr();
  }

  function closeOcr() {
    if (ocrImageUrl) URL.revokeObjectURL(ocrImageUrl);
    setOcrImageUrl(null);
    setOcrResult(null);
  }

  /** Enter מקפיץ לשדה הבא - מאפשר לרוץ על הדף בלי להרים אצבע מהמקלדת */
  function handleKeyDown(event, flatIndex) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const next = inputRefs.current[flatIndex + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      event.target.blur();
    }
  }

  const filteredItems = useMemo(() => {
    if (!sheet) return [];
    const term = search.trim().toLowerCase();
    if (!term) return sheet.items;

    return sheet.items.filter((item) =>
      item.name.toLowerCase().includes(term) ||
      (item.sku || '').toLowerCase().includes(term)
    );
  }, [sheet, search]);

  if (loading) return <div className="spinner">טוען…</div>;
  if (error) return <div className="alert error">{error}</div>;
  if (!sheet) return null;

  const countedItems = sheet.items.filter((item) =>
    item.units.some((unit) => touched.has(unit.id) && values[unit.id] !== '')
  ).length;

  const sheetTotal = sheet.items.reduce(
    (sum, item) => sum + computeItemTotal(item, values).value,
    0
  );

  let inputIndex = -1;

  return (
    <>
      <div className="card">
        <div className="row">
          <div className="grow">
            <h2 style={{ margin: 0 }}>{sheet.location.name}</h2>
            <span className="muted">{sheet.count.name}</span>
          </div>
          <Link to="/"><button className="ghost small">חזרה</button></Link>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <div className="grow">
            <span className="muted">{countedItems} מתוך {sheet.items.length} פריטים</span>
            <div className="progress-bar">
              <div style={{ width: sheet.items.length ? `${(countedItems / sheet.items.length) * 100}%` : '0%' }} />
            </div>
          </div>
          <div style={{ textAlign: 'left' }}>
            <div className="muted">סה"כ באזור</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{money(sheetTotal)}</div>
          </div>
        </div>
      </div>

      {isClosed && (
        <div className="alert warn">הספירה סגורה. הנתונים מוצגים לקריאה בלבד.</div>
      )}

      {!isClosed && ocrEnabled && (
        <>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={handlePhoto}
          />
          <button
            className="camera-button"
            onClick={() => cameraRef.current?.click()}
            disabled={ocrBusy}
          >
            {ocrBusy ? 'קורא את הדף… זה לוקח כמה שניות' : '📷 צלם את דף הספירה'}
          </button>
        </>
      )}

      {ocrResult && (
        <OcrReview
          result={ocrResult}
          imageUrl={ocrImageUrl}
          items={sheet.items}
          onApply={applyOcrRows}
          onCancel={closeOcr}
        />
      )}

      <div className="field">
        <input
          type="search"
          placeholder="חיפוש פריט…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredItems.length === 0 && (
        <div className="empty">
          {search ? 'לא נמצאו פריטים שמתאימים לחיפוש' : 'אין פריטים משויכים לאזור הזה'}
        </div>
      )}

      {filteredItems.map((item) => {
        const total = computeItemTotal(item, values);
        const hasValue = item.units.some(
          (unit) => values[unit.id] !== undefined && values[unit.id] !== ''
        );

        return (
          <div key={item.id} className={`sheet-item ${hasValue ? 'counted' : 'uncounted'}`}>
            <div className="head">
              <span className="name">{item.name}</span>
              {hasValue && <span className="badge open">נספר</span>}
            </div>

            <div className="meta" style={{ marginBottom: 8 }}>
              {item.categoryName || 'ללא מחלקה'}
              {' · '}
              {money(item.pricePerBaseUnit)} ל{baseUnitLabel(item.baseUnit)}
              {item.sku ? ` · ${item.sku}` : ''}
            </div>

            <div className="unit-inputs">
              {item.units.map((unit) => {
                inputIndex += 1;
                const currentIndex = inputIndex;
                const value = values[unit.id] ?? '';

                return (
                  <div className="unit-input" key={unit.id}>
                    <label htmlFor={`unit-${unit.id}`}>
                      <span>{unit.unitName}</span>
                      <span className="factor">
                        {unit.tareWeight
                          ? `טרה ${unit.tareWeight}`
                          : (Number(unit.factorToBase) !== 1
                              ? `×${quantity(unit.factorToBase)}`
                              : '')}
                      </span>
                    </label>
                    <input
                      id={`unit-${unit.id}`}
                      ref={(element) => { inputRefs.current[currentIndex] = element; }}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      className={value !== '' ? 'has-value' : ''}
                      value={value}
                      disabled={isClosed}
                      onChange={(e) => handleChange(item, unit, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, currentIndex)}
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                );
              })}
            </div>

            {hasValue && (
              <div className="line-total">
                <span className="muted">
                  סה"כ {quantity(total.quantityBase)} {baseUnitLabel(item.baseUnit)}
                </span>
                <span className="value">{money(total.value)}</span>
              </div>
            )}
          </div>
        );
      })}

      {!isClosed && (
        <div className="row" style={{ marginTop: 16, marginBottom: 60 }}>
          <button className="secondary" onClick={() => flush()}>שמירה מיידית</button>
          <button className="ghost" onClick={load}>רענון מהשרת</button>
        </div>
      )}
    </>
  );
}
