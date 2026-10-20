// Building blocks shared by the transport office pages (dashboard, trips,
// attendance, reports): simple charts, filter chips, key figures and a
// large detail view. Same pieces as the mobile app's components/adminkit.js.
import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { Empty } from './ui.jsx';

/** Series colours: navy, gold, emerald, crimson, slate, sky. */
export const SERIES = ['#1c315e', '#f7bc31', '#2a7d63', '#a02022', '#3e4c57', '#6b8fc7'];

const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Vertical bars with the value on top and the label underneath. */
export function ColumnChart({ data, height = 160, color = '#1c315e', highlightLast = true }) {
  if (data == null) return <div className="skeleton-block" />;
  if (!data.length) return <Empty>No data in this period.</Empty>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="kit-columns" role="img" aria-label={data.map((d) => `${d.label} ${d.value}`).join(', ')}>
      {data.map((d, i) => {
        const on = highlightLast && i === data.length - 1;
        return (
          <div key={`${d.label}-${i}`} className={`kit-column${on ? ' on' : ''}`}>
            <b className="tabular" style={on ? { color } : undefined}>{compact(d.value)}</b>
            <span className="kit-column-track" style={{ height }}>
              <i style={{ height: `${Math.max(2, (d.value / max) * 100)}%`, background: on ? color : `${color}55` }} />
            </span>
            <small>{d.label}</small>
          </div>
        );
      })}
    </div>
  );
}

/** A ring split into segments, with a figure in the middle and the legend beside it. */
export function Donut({ segments, size = 136, thickness = 16, center, caption }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="kit-donut">
      <div className="kit-donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="#ebebeb" strokeWidth={thickness} fill="none" />
          {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * circ;
            const el = <circle key={s.label} cx={size / 2} cy={size / 2} r={r} stroke={s.color} strokeWidth={thickness} fill="none" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        </svg>
        <span className="kit-donut-center"><b>{center ?? total}</b>{caption && <small>{caption}</small>}</span>
      </div>
      <ul className="kit-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b className="tabular">{s.value}</b>
            {total > 0 && <small className="tabular">{Math.round((s.value / total) * 100)}%</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars: label and value on one line, the bar underneath. */
export function HBars({ rows, label, value, unit = '', color = '#1c315e', max }) {
  if (rows == null) return <div className="skeleton-block" />;
  if (!rows.length) return <Empty>No data in this period.</Empty>;
  const top = max ?? Math.max(1, ...rows.map(value));
  return (
    <ul className="kit-hbars">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="kit-hbars-line"><span>{label(r)}</span><b className="tabular">{value(r)}{unit}</b></span>
          <span className="kit-hbars-track"><i style={{ width: `${Math.max(2, (value(r) / top) * 100)}%`, background: i === 0 ? color : `${color}aa` }} /></span>
        </li>
      ))}
    </ul>
  );
}

/** Small pill filters. */
export function Chips({ value, onChange, options }) {
  return (
    <div className="kit-chips" role="tablist">
      {options.map((o) => (
        <button type="button" key={String(o.value)} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="kit-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A white card with a heading, caption and optional actions. */
export function Block({ title, caption, actions, children, className = '' }) {
  return (
    <section className={`kit-block ${className}`}>
      {(title || actions) && (
        <header className="kit-block-head">
          <div>{title && <h3>{title}</h3>}{caption && <p>{caption}</p>}</div>
          {actions && <div className="btn-row">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A key figure: value over label. */
export function Figure({ value, label }) {
  return <div className="kit-figure"><b className="tabular">{value ?? '—'}</b><span>{label}</span></div>;
}

/** Initials in a circle. */
export function Avatar({ name = '', size = 44 }) {
  const initials = name.replace(/^(Mr|Mrs|Ms|Dr)\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span className="kit-avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials}</span>;
}

/** A large panel over the page, for drill-downs (driver history, a bus, a student). */
export function DetailView({ title, subtitle, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop kit-detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="kit-detail" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="kit-detail-head">
          <button type="button" className="kit-back" onClick={onClose} aria-label="Back"><Icon name="back" size={18} /></button>
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        </header>
        <div className="kit-detail-body">{children}</div>
      </div>
    </div>
  );
}

/** Minutes between two moments as "1h 05m" / "42m". */
export function duration(from, to) {
  if (from == null || to == null) return '—';
  const m = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "Mon 19" for a YYYY-MM-DD day. */
export function dayLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** The campus-time calendar day (YYYY-MM-DD) of a moment. */
export const isoDay = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
