import { useMemo, useState } from 'react';
import { money, date } from '../lib/format';

/**
 * שני גרפים ב-SVG טהור, בלי ספרייה.
 *
 * צבעים: סדר קבוע של גוונים שעבר בדיקת עיוורון צבעים. אף פעם לא מחזוריים.
 * שלושה מהם נמוכים בניגודיות על רקע לבן, ולכן כל מקטע מלווה בתווית ערך
 * גלויה - הצבע מזהה, הטקסט נושא את המספר.
 */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER = '#8a9099';
const GRID = '#e6e8eb';
const INK = '#1a1f26';
const INK_DIM = '#6b7480';

/** עיגול לערך "נקי" לציר - 0 / 1,000 / 2,000 ולא 1,522.08 */
function niceStep(maxValue, ticks = 4) {
  const rough = maxValue / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * מגמת שווי המלאי לאורך ספירות סגורות.
 * סדרה אחת, אז אין מקרא - הכותרת אומרת מה זה.
 */
export function ValueTrend({ points }) {
  const [hover, setHover] = useState(null);

  const width = 600;
  const height = 220;
  const pad = { top: 16, right: 24, bottom: 34, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const maxValue = Math.max(...points.map((p) => p.value), 1);
    const step = niceStep(maxValue);
    const yMax = Math.ceil(maxValue / step) * step;
    const ticks = [];
    for (let v = 0; v <= yMax; v += step) ticks.push(v);

    const xFor = (i) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = (v) => pad.top + innerH - (v / yMax) * innerH;

    const coords = points.map((p, i) => ({ ...p, x: xFor(i), y: yFor(p.value) }));
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    return { coords, path, ticks, yFor };
  }, [points, innerW, innerH]);

  if (!geometry) return <div className="empty">אין עדיין ספירות סגורות</div>;

  function onMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    geometry.coords.forEach((c, i) => {
      const d = Math.abs(c.x - x);
      if (d < best) { best = d; nearest = i; }
    });
    setHover(nearest);
  }

  const active = hover !== null ? geometry.coords[hover] : null;

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="מגמת שווי המלאי"
      >
        {geometry.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={geometry.yFor(v)} y2={geometry.yFor(v)}
              stroke={GRID} strokeWidth="1" />
            <text x={pad.left - 8} y={geometry.yFor(v) + 4} fontSize="11" fill={INK_DIM} textAnchor="end">
              {v.toLocaleString('he-IL')}
            </text>
          </g>
        ))}

        {active && (
          <line x1={active.x} x2={active.x} y1={pad.top} y2={pad.top + innerH}
            stroke={INK_DIM} strokeWidth="1" strokeDasharray="none" opacity="0.5" />
        )}

        <path d={geometry.path} fill="none" stroke={SERIES[0]} strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />

        {geometry.coords.map((c, i) => (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r="6" fill="#fff" />
            <circle cx={c.x} cy={c.y} r="4" fill={SERIES[0]} />
            <text x={c.x} y={height - pad.bottom + 18} fontSize="11" fill={INK_DIM}
              textAnchor={i === 0 ? 'start' : i === geometry.coords.length - 1 ? 'end' : 'middle'}>
              {date(c.label)}
            </text>
          </g>
        ))}
      </svg>

      {active && (
        <div className="chart-tooltip" style={{ left: `${(active.x / width) * 100}%` }}>
          <strong>{money(active.value)}</strong>
          <span className="muted">{active.name} · {date(active.label)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * פילוח שווי לפי מחלקה - פס אחד מחולק למקטעים (חלק מתוך השלם).
 * עד 6 מחלקות בצבע, השאר מקופלות ל"אחר". לכל מקטע תווית ערך גלויה.
 */
export function CategoryBreakdown({ groups }) {
  const [hover, setHover] = useState(null);

  const slices = useMemo(() => {
    const sorted = [...groups].filter((g) => g.totalValue > 0).sort((a, b) => b.totalValue - a.totalValue);
    const head = sorted.slice(0, SERIES.length);
    const tail = sorted.slice(SERIES.length);
    const total = sorted.reduce((sum, g) => sum + g.totalValue, 0);

    const list = head.map((g, i) => ({ name: g.name, value: g.totalValue, color: SERIES[i] }));
    if (tail.length > 0) {
      list.push({ name: `אחר (${tail.length})`, value: tail.reduce((s, g) => s + g.totalValue, 0), color: OTHER });
    }
    return { list: list.map((s) => ({ ...s, share: total ? s.value / total : 0 })), total };
  }, [groups]);

  if (slices.list.length === 0) return <div className="empty">אין נתונים לפילוח</div>;

  const width = 600;
  const barH = 24;
  const gap = 2;
  let cursor = 0;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${barH}`} style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }}
        role="img" aria-label="פילוח שווי לפי מחלקה">
        {slices.list.map((s, i) => {
          const w = Math.max(0, s.share * width - gap);
          const x = cursor;
          cursor += s.share * width;
          const isFirst = i === 0;
          const isLast = i === slices.list.length - 1;
          return (
            <rect key={s.name} x={x} y="0" width={w} height={barH} fill={s.color}
              rx={isFirst || isLast ? 4 : 0}
              opacity={hover === null || hover === i ? 1 : 0.45}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
              style={{ transition: 'opacity .15s' }} />
          );
        })}
      </svg>

      <ul className="chart-legend">
        {slices.list.map((s, i) => (
          <li key={s.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
            style={{ opacity: hover === null || hover === i ? 1 : 0.5 }}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="grow">{s.name}</span>
            <span className="muted">{Math.round(s.share * 100)}%</span>
            <strong>{money(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
