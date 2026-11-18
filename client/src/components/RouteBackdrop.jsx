import { useEffect, useRef, useState } from 'react';

// The app's backdrop: a quiet transit map in the app's own colours: a few
// winding bus routes with their stops (one amber "your
// stop", one green campus), and two small buses gliding along them. It sits
// behind everything, takes no clicks, follows the light or dark theme through
// the --bgx-* variables (redesign.css), and stands still for people who ask
// for reduced motion.

const ROUTES = [
  { id: 'r1', d: 'M-60 210 C 180 140, 300 330, 520 270 S 860 120, 1080 220 S 1380 330, 1520 250', tone: 'main' },
  { id: 'r2', d: 'M-60 640 C 160 560, 340 720, 560 640 S 900 470, 1120 560 S 1360 700, 1520 610', tone: 'dashed' },
  { id: 'r3', d: 'M260 -40 C 300 160, 180 330, 330 480 S 520 760, 430 960', tone: 'soft' },
  { id: 'r4', d: 'M1180 -40 C 1120 180, 1300 330, 1180 520 S 1020 760, 1120 960', tone: 'soft' },
];

// [x, y, kind]: plain stops, the amber "your stop" and the green campus.
const STOPS = [
  [36, 192], [520, 270, 'mine'], [880, 150], [1240, 286, 'campus'],
  [205, 600], [560, 640], [1010, 512], [1350, 662],
  [318, 300], [338, 488], [1222, 228], [1170, 540],
];

// A bus seen from above: body, windscreen and roof, about 30 x 16 px. Moving, it glides along
// its route; still, it is parked at a point part-way along it (`at`, 0 to 1).
function Bus({ route, dur, begin, moving, at }) {
  const [place, setPlace] = useState(null);
  useEffect(() => {
    if (moving) return;
    const path = document.getElementById(`route-bg-${route}`);
    if (!path?.getTotalLength) return;
    const len = path.getTotalLength();
    const a = path.getPointAtLength(len * at);
    const b = path.getPointAtLength(Math.min(len, len * at + 4));
    setPlace({ x: a.x, y: a.y, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
  }, [moving, route, at]);
  if (!moving && !place) return null;
  return (
    <g className="route-bg-bus" transform={moving ? undefined : `translate(${place.x} ${place.y}) rotate(${place.deg})`}>
      <rect x="-15" y="-8" width="30" height="16" rx="5" className="body" />
      <rect x="6" y="-6" width="6" height="12" rx="2" className="glass" />
      <rect x="-11" y="-5" width="14" height="10" rx="2" className="roof" />
      {moving && (
        <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto">
          <mpath href={`#route-bg-${route}`} />
        </animateMotion>
      )}
    </g>
  );
}

// The buses only move on a computer with power to spare: every frame of their motion repaints the
// whole backdrop under the glass panels, which makes phones and modest laptops stutter.
const canAnimate = () => {
  const m = window.matchMedia;
  if (!m || m('(prefers-reduced-motion: reduce)').matches) return false;
  return m('(pointer: fine) and (min-width: 1100px)').matches && (navigator.hardwareConcurrency ?? 4) >= 8;
};

export default function RouteBackdrop() {
  const [moving, setMoving] = useState(canAnimate);
  const svg = useRef(null);
  useEffect(() => {
    const m = window.matchMedia;
    if (!m) return undefined;
    const queries = [m('(prefers-reduced-motion: reduce)'), m('(pointer: fine) and (min-width: 1100px)')];
    const on = () => setMoving(canAnimate());
    queries.forEach((q) => q.addEventListener('change', on));
    return () => queries.forEach((q) => q.removeEventListener('change', on));
  }, []);
  // A hidden tab stops the motion altogether.
  useEffect(() => {
    const on = () => { const el = svg.current; if (!el?.pauseAnimations) return; if (document.hidden) el.pauseAnimations(); else el.unpauseAnimations(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  return (
    <div className="route-bg" aria-hidden="true">
      <svg ref={svg} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        {ROUTES.map((r) => (
          <g key={r.id} className={`route-bg-line ${r.tone}`}>
            <path id={`route-bg-${r.id}`} d={r.d} className="casing" />
            <path d={r.d} className="line" />
          </g>
        ))}
        {STOPS.map(([x, y, kind]) => (
          <g key={`${x},${y}`} className={`route-bg-stop${kind ? ` ${kind}` : ''}`}>
            <circle cx={x} cy={y} r={kind ? 12 : 9} className="halo" />
            <circle cx={x} cy={y} r={kind ? 5.5 : 4.5} className="dot" />
          </g>
        ))}
        <Bus route="r1" dur="46s" begin="0s" moving={moving} at={0.38} />
        <Bus route="r2" dur="58s" begin="-20s" moving={moving} at={0.62} />
      </svg>
    </div>
  );
}
