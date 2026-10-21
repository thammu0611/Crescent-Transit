import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export function Page({ title, subtitle, actions, children, wide, eyebrow }) {
  return (
    <main className={`page${wide ? ' wide' : ''}`}>
      <header className="page-head">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="btn-row">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function Panel({ title, actions, children, className = '', icon }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-row panel-head">
          {title && <h3>{icon && <Icon name={icon} size={17} className="panel-icon" />}{title}</h3>}
          {actions && <div className="btn-row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone, hint, icon }) {
  return (
    <div className={`stat ${tone ?? ''}${icon ? ' with-icon' : ''}`} title={hint}>
      {icon && <span className="stat-icon"><Icon name={icon} size={18} /></span>}
      <b>{value ?? '—'}</b>
      <span>{label}</span>
    </div>
  );
}

export const Badge = ({ tone = 'offline', children }) => <span className={`badge ${tone}`}>{children}</span>;

export const ErrorText = ({ children }) => (children ? <p className="error" role="alert">{children}</p> : null);
export const Notice = ({ children }) => (children ? <p className="notice" role="status">{children}</p> : null);

export function Empty({ children }) {
  return <p className="empty-state">{children}</p>;
}

/** Placeholder rows shaped like the table, while data loads (doc B.9: skeletons, not spinners). */
function SkeletonRows({ columns, count = 4 }) {
  return Array.from({ length: count }, (_, i) => (
    <tr key={i} className="skeleton-row" aria-hidden="true">
      {columns.map((c) => <td key={c.key}><span className="skeleton" /></td>)}
    </tr>
  ));
}

/**
 * A data table. `columns`: [{ key, label, render?(row), align?, wrap? }].
 * `rows` null/undefined = still loading (skeleton); [] = empty.
 * Cells do not wrap unless the column says `wrap`; a column keyed 'x' holds row actions.
 */
export function Table({ columns, rows, empty = 'Nothing to show.', rowKey = (r, i) => r.id ?? i }) {
  const loading = rows == null;
  if (!loading && !rows.length) return <Empty>{empty}</Empty>;
  const cls = (c) => [c.wrap ? 'wrap' : '', c.key === 'x' ? 'actions' : '', c.align === 'right' ? 'num' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="table-wrap">
      <table className="table" aria-busy={loading || undefined}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cls(c)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? <SkeletonRows columns={columns} /> : rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} className={cls(c)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Yes / No as a small badge rather than bare text. */
export const YesNo = ({ value, yes = 'Yes', no = 'No', noTone = 'offline' }) => (
  <Badge tone={value ? 'live' : noTone}>{value ? yes : no}</Badge>
);

/** A row of small action buttons for a table row. */
export function RowActions({ children }) {
  return <span className="row-actions">{children}</span>;
}

/** Compact search box with an icon. */
export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <label className="search-box">
      <Icon name="search" size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Modal({ title, onClose, children, width = 440 }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 32px))` }} tabIndex={-1} ref={ref}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, icon }) {
  return (
    <label className="field">
      <span>{label}</span>
      {icon ? <span className="control-wrap"><Icon name={icon} size={17} />{children}</span> : children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button type="button" key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A panel that folds away: icon, title and a one-line summary always show;
 * the body opens on click. Keeps secondary sections compact.
 */
export function FoldPanel({ title, icon, summary, badge, children, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className={`panel fold kit-fold${open ? ' open' : ''}`}>
      <button type="button" className="fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon && <span className="kit-fold-icon"><Icon name={icon} size={17} /></span>}
        <span className="kit-fold-text"><b>{title}</b>{summary && <small>{summary}</small>}</span>
        {badge}
        <Icon name="down" size={18} className="fold-chevron" />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
