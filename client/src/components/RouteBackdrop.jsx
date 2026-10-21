import { useEffect, useState } from 'react';

// The app's backdrop: a faint navy-and-gold map of winding bus routes with their
// stops, and two small buses gliding along them. It sits behind everything,
// takes no clicks, and stands still for people who ask for reduced motion.

const ROUTES = [
  { id: 'r1', d: 'M-60 210 C 180 140, 300 330, 520 270 S 860 120, 1080 220 S 1380 330, 1520 250', tone: 'navy' },
  { id: 'r2', d: 'M-60 640 C 160 560, 340 720, 560 640 S 900 470, 1120 560 S 1360 700, 1520 610', tone: 'gold' },
  { id: 'r3', d: 'M260 -40 C 300 160, 180 330, 330 480 S 520 760, 430 960', tone: 'navy' },
  { id: 'r4', d: 'M1180 -40 C 1120 180, 1300 330, 1180 520 S 1020 760, 1120 960', tone: 'sky' },
];

const STOPS = [
  [130, 178], [520, 270], [880, 150], [1240, 286],
  [205, 600], [560, 640], [1010, 512], [1350, 662],
  [318, 300], [338, 488], [1222, 228], [1170, 540],
];

// A bus seen from above: body, windscreen and roof light, about 30 x 16 px.
function Bus({ route, dur, begin }) {
  return (
    <g className="route-bg-bus">
      <rect x="-15" y="-8" width="30" height="16" rx="5" fill="#f7bc31" />
      <rect x="6" y="-6" width="6" height="12" rx="2" fill="#1c315e" />
      <rect x="-11" y="-5" width="14" height="10" rx="2" fill="rgba(28,49,94,0.55)" />
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite" rotate="auto">
        <mpath href={`#route-bg-${route}`} />
      </animateMotion>
    </g>
  );
}

export default function RouteBackdrop() {
  const [still, setStill] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!q) return undefined;
    const on = () => setStill(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  return (
    <div className="route-bg" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="route-bg-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0H0V48" fill="none" stroke="rgba(28,49,94,0.045)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1440" height="900" fill="url(#route-bg-grid)" />
        {ROUTES.map((r) => (
          <g key={r.id} className={`route-bg-line ${r.tone}`}>
            <path id={`route-bg-${r.id}`} d={r.d} className="casing" />
            <path d={r.d} className="line" />
          </g>
        ))}
        {STOPS.map(([x, y]) => (
          <g key={`${x},${y}`} className="route-bg-stop">
            <circle cx={x} cy={y} r="9" className="halo" />
            <circle cx={x} cy={y} r="4.5" />
          </g>
        ))}
        {!still && <Bus route="r1" dur="46s" begin="0s" />}
        {!still && <Bus route="r2" dur="58s" begin="-20s" />}
      </svg>
    </div>
  );
}
