import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';
import { fitNav } from '../lib/navfit.js';
import Icon from './Icon.jsx';

const NARROW = '(max-width: 1060px)';
const TRACK_PADDING = 10;
const LINK_GAP = 2;

const sameFit = (a, b) => a?.compact === b?.compact && a?.shown.join() === b?.shown.join();
const outerWidth = (el) => {
  if (!el) return 0;
  const style = getComputedStyle(el);
  return el.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
};

/**
 * The page links. Whatever does not fit in the bar, in any language and for any
 * role, moves into a "More" menu; narrow screens use the stacked menu instead.
 */
export default function MainNav({ links, activePath, role, open, children }) {
  const t = useT();
  const root = useRef(null);
  const track = useRef(null);
  const wideRow = useRef(null);
  const tightRow = useRef(null);
  const moreRoot = useRef(null);
  const [fit, setFit] = useState(null);
  const [glider, setGlider] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const active = links.findIndex(([p]) => p === activePath);
  const labels = links.map(([, label]) => t(label)).join('|');

  const linkClass = (p) => [activePath === p && 'active', role === 'guest' && p === '/login' && 'nav-cta'].filter(Boolean).join(' ');

  useLayoutEffect(() => {
    const bar = root.current?.closest('.topbar');
    const brand = bar?.querySelector('.brand');
    const chip = root.current?.querySelector('.user-chip');
    const search = root.current?.querySelector('.cmdk-trigger'); // the quick-search button beside the chip
    const measure = () => {
      if (!bar || window.matchMedia(NARROW).matches) {
        setFit(null);
        return;
      }
      const widths = (row) => [...row.children].map((el) => el.getBoundingClientRect().width);
      const wide = widths(wideRow.current);
      const tight = widths(tightRow.current);
      const more = wide.pop();
      tight.pop();
      const style = getComputedStyle(bar);
      const room = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - parseFloat(style.columnGap) - outerWidth(brand) - outerWidth(chip) - (search ? outerWidth(search) : 0) - TRACK_PADDING;
      const next = fitNav({ wide, tight, more, room, gap: LINK_GAP, active });
      setFit((prev) => (sameFit(prev, next) ? prev : next));
    };
    measure();
    document.fonts?.ready.then(measure);
    const watch = new ResizeObserver(measure);
    [bar, chip, search].forEach((el) => el && watch.observe(el));
    return () => watch.disconnect();
  }, [labels, active, role]);

  // The current page's pill glides to whichever link is active.
  useLayoutEffect(() => {
    const place = () => {
      const a = track.current?.querySelector(':scope > a.active');
      setGlider(a && a.offsetWidth ? { left: a.offsetLeft, width: a.offsetWidth } : null);
    };
    place();
    document.fonts?.ready.then(place);
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [activePath, labels, fit]);

  useEffect(() => setMoreOpen(false), [activePath, fit]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const outside = (e) => { if (!moreRoot.current?.contains(e.target)) setMoreOpen(false); };
    const escape = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);

  const inBar = fit ? links.filter((_, i) => fit.shown.includes(i)) : links;
  const inMore = fit ? links.filter((_, i) => !fit.shown.includes(i)) : [];
  const moreLabel = t('More');

  return (
    <nav className={`tabs${open ? ' open' : ''}`} aria-label="Main" ref={root}>
      {/* Hidden copies, measured to decide what fits. */}
      {[[wideRow, ''], [tightRow, ' nav-compact']].map(([row, extra]) => (
        <span key={extra} className={`nav-measure${extra}`} ref={row} aria-hidden="true">
          {links.map(([p, label, , icon]) => (
            <a key={p} className={linkClass(p)}><Icon name={icon} size={16} />{t(label)}</a>
          ))}
          <span className="nav-more-btn"><Icon name="menu" size={16} />{moreLabel}<Icon name="down" size={14} /></span>
        </span>
      ))}
      <span className={`nav-track${fit?.compact ? ' nav-compact' : ''}`} ref={track}>
        {glider && <span className="nav-glider" aria-hidden="true" style={{ transform: `translateX(${glider.left}px)`, width: glider.width }} />}
        {inBar.map(([p, label, , icon]) => (
          // A guest's "Sign in" is the bar's call to action.
          <a key={p} href={`#${p}`} className={linkClass(p)} aria-current={activePath === p ? 'page' : undefined}>
            <Icon name={icon} size={16} />
            {t(label)}
          </a>
        ))}
        {inMore.length > 0 && (
          <span className={`nav-more${moreOpen ? ' is-open' : ''}`} ref={moreRoot}>
            <button type="button" className="nav-more-btn" aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen((o) => !o)}>
              <Icon name="menu" size={16} />{moreLabel}<Icon name="down" size={14} />
            </button>
            {moreOpen && (
              <span className="nav-more-menu">
                {inMore.map(([p, label, , icon]) => (
                  <a key={p} href={`#${p}`} onClick={() => setMoreOpen(false)}>
                    <Icon name={icon} size={17} />
                    {t(label)}
                  </a>
                ))}
              </span>
            )}
          </span>
        )}
      </span>
      {children}
    </nav>
  );
}
