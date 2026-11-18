import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/i18n.js';
import Icon from './Icon.jsx';

const MENU_MAX = 340;

/**
 * A choice from a list (a route, a stop), drawn in the app's own style instead of
 * the browser's plain list: a field-like button, then a rounded panel with a number
 * badge per item, a tick on the chosen one, and a search box when the list is long.
 * Arrow keys, Enter and Escape work; the panel opens upwards when there is no room.
 *
 * options: [{ value, label, lead?, hint? }]  (lead: a short badge such as a stop number)
 */
export default function Picker({ value, onChange, options, placeholder = 'Choose', disabled, label, required, searchAt = 9 }) {
  const t = useT();
  const id = useId();
  const root = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  const list = useRef(null);
  const search = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);

  const same = (a, b) => String(a ?? '') === String(b ?? '');
  const current = options.find((o) => same(o.value, value));
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.lead ?? ''} ${o.label} ${o.hint ?? ''}`.toLowerCase().includes(needle)) : options;

  // Placed on <body> (no card can clip it), under the button, or above it when the page ends.
  const measure = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    // On phones the list stops above the bottom tab bar.
    const tabs = document.querySelector('.bottom-tabs')?.getBoundingClientRect();
    const floor = tabs && tabs.height && tabs.top > r.bottom ? tabs.top : window.innerHeight;
    const below = floor - r.bottom - 12;
    const up = below < 240 && r.top > below;
    const room = Math.min(MENU_MAX, (up ? r.top : below) - 8);
    const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPlace(up ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: room } : { left, width, top: r.bottom + 6, maxHeight: room });
  };
  useLayoutEffect(() => { if (open) measure(); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setActive(Math.max(0, options.findIndex((o) => same(o.value, value))));
    const outside = (e) => { if (!root.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const move = (e) => { if (!menu.current?.contains(e.target)) measure(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', move, true);
    requestAnimationFrame(() => {
      (search.current ?? list.current)?.focus({ preventScroll: true });
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', move, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const close = () => { setOpen(false); button.current?.focus(); };
  const pick = (o) => { onChange(o.value); close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className={`picker${open ? ' is-open' : ''}`}>
      <button
        ref={button}
        type="button"
        className="picker-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label ? `${t(label)}: ${current ? current.label : t(placeholder)}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } }}
      >
        {current?.lead != null && <span className="picker-lead">{current.lead}</span>}
        <span className={`picker-value${current ? '' : ' placeholder'}`}>{current ? current.label : t(placeholder)}</span>
        <Icon name="down" size={16} className="picker-chevron" />
      </button>
      {/* Lets the form's own "please choose" check work, as it did on the plain list. */}
      {required && <input className="picker-required" tabIndex={-1} aria-hidden="true" value={value ?? ''} onChange={() => {}} required />}
      {open && place && createPortal(
        <div ref={menu} className="picker-menu" style={place} onKeyDown={onKey}>
          {options.length >= searchAt && (
            <label className="picker-search">
              <Icon name="search" size={15} />
              <input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} placeholder={t('Search')} aria-label={t('Search')} />
            </label>
          )}
          <ul ref={list} id={id} role="listbox" tabIndex={-1} aria-label={label ? t(label) : undefined}>
            {shown.length === 0 && <li className="picker-empty">{t('No matches')}</li>}
            {shown.map((o, i) => {
              const on = same(o.value, value);
              return (
                <li key={o.value} data-i={i} role="option" aria-selected={on} className={i === active ? 'active' : undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                  {o.lead != null && <span className="picker-lead">{o.lead}</span>}
                  <span className="picker-text"><b>{o.label}</b>{o.hint && <small>{o.hint}</small>}</span>
                  {on && <Icon name="check" size={16} className="picker-tick" />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
