import { useMemo, useState } from 'react';
import { money, quantity as fmtQuantity, baseUnitLabel } from '../lib/format';

const CONFIDENCE_LABEL = { high: 'ברור', medium: 'לבדוק', low: 'ספק' };
const CONFIDENCE_CLASS = { high: 'open', medium: 'warn', low: 'danger' };

/**
 * מסך אישור של מה שזוהה מהצילום.
 *
 * זה המקום שבו אדם מאשר כל שורה לפני שהיא נכנסת לספירה. כל שדה ניתן
 * לתיקון - פריט, יחידה, כמות - כי כתב יד וכמויות זה בדיוק המקום שבו
 * טעות שקטה עולה כסף. שורה שלא זוהתה לא מסומנת לאישור עד שמשייכים אותה.
 */
export default function OcrReview({ result, imageUrl, items, onApply, onCancel }) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const [rows, setRows] = useState(() =>
    result.rows.map((row) => ({
      ...row,
      quantity: row.quantity === null ? '' : String(row.quantity),
      include: row.itemId !== null && row.quantity !== null,
    }))
  );

  function updateRow(index, patch) {
    setRows((previous) => previous.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };

      // שינוי פריט מאפס את היחידה לברירת המחדל של הפריט החדש
      if (patch.itemId !== undefined) {
        const item = itemsById.get(patch.itemId);
        const unit = item ? (item.units.find((u) => u.isDefault) || item.units[0]) : null;
        next.itemUnitId = unit ? unit.id : null;
        next.include = Boolean(item) && next.quantity !== '';
      }
      if (patch.quantity !== undefined) {
        next.include = next.itemId !== null && patch.quantity !== '';
      }
      return next;
    }));
  }

  /** תצוגה מקדימה חיה של כמות בסיס ושווי, לפי מה שהמשתמש תיקן */
  function preview(row) {
    const item = itemsById.get(row.itemId);
    if (!item) return null;
    const unit = item.units.find((u) => u.id === row.itemUnitId);
    const qty = Number(row.quantity);
    if (!unit || !Number.isFinite(qty)) return null;

    const tare = unit.tareWeight ? Number(unit.tareWeight) : 0;
    const base = Math.round(Math.max(0, qty - tare) * Number(unit.factorToBase) * 1000) / 1000;
    return { base, value: Math.round(base * Number(item.pricePerBaseUnit) * 100) / 100, baseUnit: item.baseUnit };
  }

  const included = rows.filter((row) => row.include && row.itemId !== null && row.quantity !== '');
  const totalValue = included.reduce((sum, row) => sum + (preview(row)?.value || 0), 0);

  function apply() {
    onApply(included.map((row) => ({
      itemId: row.itemId,
      itemUnitId: row.itemUnitId,
      quantity: Number(row.quantity),
    })));
  }

  return (
    <div className="ocr-overlay">
      <div className="ocr-panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 className="grow" style={{ margin: 0 }}>מה זוהה בדף</h2>
          <button className="ghost small" onClick={onCancel}>ביטול</button>
        </div>

        <div className="ocr-photo">
          <img src={imageUrl} alt="דף הספירה שצולם" />
        </div>

        <p className="muted">
          זוהו {result.rows.length} שורות
          {result.unmatched > 0 && `, ${result.unmatched} מהן בלי התאמה לפריט`}.
          בדוק, תקן מה שצריך, ואשר. שום דבר לא נכנס לספירה בלי האישור שלך.
        </p>

        {result.sheetNote && <div className="alert warn">{result.sheetNote}</div>}

        {rows.map((row, index) => {
          const item = itemsById.get(row.itemId);
          const pv = preview(row);

          return (
            <div key={index} className={`ocr-row ${row.include ? 'included' : ''}`}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', marginTop: 8 }}
                  checked={row.include}
                  disabled={row.itemId === null || row.quantity === ''}
                  onChange={(e) => updateRow(index, { include: e.target.checked })}
                />
                <div className="grow">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="muted" style={{ fontSize: 13 }}>נקרא: "{row.rawText}"</span>
                    <span className={`badge ${CONFIDENCE_CLASS[row.confidence]}`}>
                      {CONFIDENCE_LABEL[row.confidence]}
                    </span>
                  </div>

                  <div className="row">
                    <select
                      className="grow"
                      style={{ minWidth: 150 }}
                      value={row.itemId ?? ''}
                      onChange={(e) => updateRow(index, { itemId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— לא זוהה פריט —</option>
                      {items.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>

                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      style={{ width: 90, textAlign: 'center', fontWeight: 600 }}
                      value={row.quantity}
                      placeholder="כמות"
                      onChange={(e) => updateRow(index, { quantity: e.target.value })}
                    />

                    <select
                      style={{ width: 'auto', minWidth: 90 }}
                      value={row.itemUnitId ?? ''}
                      disabled={!item}
                      onChange={(e) => updateRow(index, { itemUnitId: Number(e.target.value) })}
                    >
                      {(item?.units || []).map((unit) => (
                        <option key={unit.id} value={unit.id}>{unit.unitName}</option>
                      ))}
                    </select>
                  </div>

                  {row.note && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{row.note}</div>}

                  {pv && (
                    <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                      = {fmtQuantity(pv.base)} {baseUnitLabel(pv.baseUnit)} · <strong>{money(pv.value)}</strong>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="ocr-footer">
          <div className="grow">
            <div className="muted">{included.length} שורות לאישור</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{money(totalValue)}</div>
          </div>
          <button onClick={apply} disabled={included.length === 0}>
            הזן {included.length} שורות לספירה
          </button>
        </div>
      </div>
    </div>
  );
}
