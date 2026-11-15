import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { DIRECTION_TEXT } from '../../../shared/direction.js';
import { useT } from '../lib/i18n.js';

export function Page({ title, subtitle, actions, children, wide, eyebrow }) {
  const t = useT();
  return (
    <main className={`page${wide ? ' wide' : ''}`}>
      <header className="page-head">
        <div>
          {eyebrow && <span className="eyebrow">{t(eyebrow)}</span>}
          <h1>{t(title)}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="btn-row">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function Panel({ title, actions, children, className = '', icon, summary, badge }) {
  const t = useT();
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-row panel-head">
          {title && (
            <h3>
              {icon && <Icon name={icon} size={17} className="panel-icon" />}
              <span className="panel-title-text">{t(title)}{summary && <small>{summary}</small>}</span>
            </h3>
          )}
          {(badge || actions) && <div className="btn-row">{badge}{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One record in a list of cards: a lead (avatar, route code or icon), title and lines,
 * an optional count pill, and an arrow when it opens something.
 */
export function ListCard({ lead, title, lines = [], count, countLabel, side, tone, onClick, href }) {
  const Tag = href ? 'a' : onClick ? 'button' : 'div';
  const props = href ? { href } : onClick ? { type: 'button', onClick } : {};
  return (
    <Tag {...props} className={`kit-row${tone ? ` is-${tone}` : ''}`}>
      {lead}
      <span className="kit-row-main">
        <b>{title}</b>
        {lines.filter(Boolean).map((l, i) => <small key={i}>{l}</small>)}
      </span>
      {side && <span className="kit-row-side">{side}</span>}
      {count != null && <span className="kit-count"><b className="tabular">{count}</b><small>{countLabel}</small></span>}
      {(href || onClick) && <Icon name="arrow" size={16} className="kit-chevron" />}
    </Tag>
  );
}

// Each stat card has its own colour: its state when it has one (live, late, danger),
// otherwise the colour of what it counts, so a row of cards reads at a look.
const STATE_COLOUR = { live: 'green', delayed: 'amber', danger: 'red', info: 'sky' };
const ICON_COLOUR = {
  bus: 'navy', route: 'navy', pin: 'navy', shield: 'navy', map: 'navy',
  signal: 'teal', chart: 'teal', users: 'sky', user: 'sky',
  card: 'gold', sparkle: 'gold', clock: 'gold', wallet: 'gold',
  check: 'green', list: 'teal', edit: 'slate', alert: 'rose', bell: 'violet',
};
export const statColour = (tone, icon) => STATE_COLOUR[tone] ?? ICON_COLOUR[icon] ?? 'navy';

// Colours a card may switch to when its neighbour already has its colour.
const SPARE_COLOURS = ['navy', 'teal', 'gold', 'sky', 'violet', 'indigo', 'rose', 'slate'];

export function Stat({ label, value, tone, hint, icon, color }) {
  const t = useT();
  const own = color ?? statColour(tone, icon);
  const ref = useRef(null);
  // No two cards in a row share a colour: a card without a state of its own (live, late,
  // danger) moves to the first colour no earlier card in the row is using.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || color || STATE_COLOUR[tone]) { if (el) el.dataset.c = own; return; }
    const before = [];
    for (let n = el.parentElement?.firstElementChild; n && n !== el; n = n.nextElementSibling) if (n.dataset?.c) before.push(n.dataset.c);
    el.dataset.c = before.includes(own) ? SPARE_COLOURS.find((c) => !before.includes(c)) ?? own : own;
  });
  return (
    <div ref={ref} className={`stat ${tone ?? ''}${icon ? ' with-icon' : ''}`} data-c={own} title={hint}>
      {icon && <span className="stat-icon"><Icon name={icon} size={18} /></span>}
      <b>{value ?? '—'}</b>
      <span>{t(label)}</span>
    </div>
  );
}

export const Badge = ({ tone = 'offline', children }) => <span className={`badge ${tone}`}>{children}</span>;

/** Which run of the route: UP (to college) or DOWN (from college). */
export function DirectionBadge({ direction }) {
  const t = useT();
  return direction ? <Badge tone={direction === 'DOWN' ? 'offline' : 'info'}>{t(DIRECTION_TEXT[direction])}</Badge> : null;
}

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
  const t = useT();
  const loading = rows == null;
  if (!loading && !rows.length) return <Empty>{empty}</Empty>;
  const cls = (c) => [c.wrap ? 'wrap' : '', c.key === 'x' ? 'actions' : '', c.align === 'right' ? 'num' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="table-wrap">
      <table className="table" aria-busy={loading || undefined}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cls(c)}>{t(c.label)}</th>)}</tr>
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
  // Drawn on <body>: inside a glass card (backdrop-filter) a fixed overlay would be
  // trapped in that card instead of covering the screen.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 32px))` }} tabIndex={-1} ref={ref}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children, hint, icon }) {
  const t = useT();
  return (
    <label className="field">
      <span>{t(label)}</span>
      {icon ? <span className="control-wrap"><Icon name={icon} size={17} />{children}</span> : children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

/**
 * A filter: shows its label and current choice, and opens a list of options
 * ({ value, label, count }). `resting` is the unfiltered choice; any other
 * marks the control as set.
 */
export function Dropdown({ label, icon, value, onChange, options, resting = options[0].value }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div ref={root} className={`dropdown${open ? ' is-open' : ''}${current.value !== resting ? ' is-set' : ''}`}>
      <button type="button" className="dropdown-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon && <span className="dropdown-icon"><Icon name={icon} size={16} /></span>}
        <span className="dropdown-text"><small>{t(label)}</small><b>{t(current.label)}</b></span>
        <Icon name="down" size={15} className="dropdown-chevron" />
      </button>
      {open && (
        <ul className="dropdown-menu" role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}>
                <span>{t(o.label)}</span>
                {o.count != null && <span className="dropdown-count">{o.count}</span>}
                {o.value === value && <Icon name="check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  const t = useT();
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button type="button" key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
