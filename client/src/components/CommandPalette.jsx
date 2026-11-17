import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import Icon from './Icon.jsx';

// Things to do from anywhere, beyond going to a page, by role.
const ACTIONS = {
  admin: [
    ['Send an announcement', '/notices', 'bell'],
    ['Acknowledge an SOS', '/notices', 'alert'],
    ['Approve suggestions', '/suggestions', 'sparkle'],
    ['Weekly report: preview or send', '/suggestions', 'mail'],
    ['Bus documents and service', '/care', 'shield'],
    ['Schedule a trip', '/trips', 'clock'],
  ],
  student: [
    ['Show my bus pass', '/pass', 'qr'],
    ['Where is my bus?', '/map', 'map'],
    ['Add a parent on WhatsApp', '/services', 'phone'],
    ['Report a problem', '/services', 'alert'],
  ],
  driver: [['Start or end my trip', '/', 'bus']],
  parent: [['Where is my child\'s bus?', '/', 'map']],
};

/** Words of the query all found in the text, in any order. */
const matches = (text, q) => q.split(/\s+/).filter(Boolean).every((w) => text.includes(w));

/**
 * Quick search (Ctrl+K or the search button): jump to any page, a route or a
 * bus, or a common task, from anywhere, with the keyboard or the mouse.
 */
export default function CommandPalette({ links, role, open, onClose }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [routes, setRoutes] = useState([]);
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setTimeout(() => input.current?.focus(), 0);
    if (!routes.length) api('/api/routes').then(setRoutes).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const out = [];
    for (const [path, label, , icon] of links) out.push({ group: 'Pages', label: t(label), hint: t('Open'), icon, href: `#${path}` });
    for (const [label, path, icon] of ACTIONS[role] ?? []) out.push({ group: 'Do', label: t(label), hint: t('Go'), icon, href: `#${path}` });
    // Routes and buses: the map for the office and students, the timetable otherwise.
    const routeHref = role === 'admin' ? '#/routes' : role === 'student' ? '#/schedule' : null;
    if (routeHref) {
      for (const r of routes) {
        out.push({ group: 'Routes', label: `Route ${r.code} · ${r.name}`, hint: r.departure_time ?? '', icon: 'route', href: routeHref, words: `${r.start_point ?? ''} ${r.end_point ?? ''}` });
        if (role === 'admin' && r.fleet_code) out.push({ group: 'Buses', label: r.fleet_code, hint: `Route ${r.code}`, icon: 'bus', href: '#/map', words: r.name });
      }
    }
    return out;
  }, [links, role, routes, t]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const found = needle ? items.filter((i) => matches(`${i.label} ${i.words ?? ''} ${i.group}`.toLowerCase(), needle)) : items.filter((i) => i.group === 'Pages' || i.group === 'Do');
    return found.slice(0, 40);
  }, [items, needle]);

  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const go = (item) => {
    if (!item) return;
    onClose();
    if (window.location.hash === item.href) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else window.location.hash = item.href.slice(1);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = null;
  return createPortal(
    <div className="cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('Quick search')}>
        <div className="cmdk-search">
          <Icon name="search" size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t(role === 'admin' ? 'Search pages, routes, buses and tasks…' : 'Search pages and tasks…')}
            aria-label={t('Quick search')}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={shown[active] ? `cmdk-${active}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk-list" id="cmdk-list" role="listbox" ref={list}>
          {shown.length === 0 && <li className="cmdk-empty">{t('Nothing matches.')}</li>}
          {shown.map((item, i) => {
            const head = item.group !== lastGroup ? <li key={`g-${item.group}`} className="cmdk-group" role="presentation">{t(item.group)}</li> : null;
            lastGroup = item.group;
            return [
              head,
              <li
                key={`${item.group}-${item.label}`}
                id={`cmdk-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === active}
                className={`cmdk-item${i === active ? ' on' : ''}`}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); go(item); }}
              >
                <span className="cmdk-icon"><Icon name={item.icon} size={16} /></span>
                <span className="cmdk-label">{item.label}</span>
                <small>{item.hint}</small>
              </li>,
            ];
          })}
        </ul>
        <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t('to move')}</span><span><kbd>Enter</kbd> {t('to open')}</span><span><kbd>Ctrl</kbd><kbd>K</kbd> {t('anywhere')}</span></div>
      </div>
    </div>,
    document.body,
  );
}
