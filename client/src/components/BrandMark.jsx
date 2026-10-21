// The app's mark, drawn as the phone app's launcher icon: a gold bus on a navy
// rounded square with a fine gold edge. The phone app draws the same shapes
// (mobile-app/src/components/ui.js: BrandMark).
export default function BrandMark({ size = 42 }) {
  return (
    <svg className="brand-icon" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a4787" />
          <stop offset="1" stopColor="#162a52" />
        </linearGradient>
        <linearGradient id="brand-bus" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbcd5a" />
          <stop offset="1" stopColor="#f2b12a" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="13" fill="url(#brand-bg)" stroke="rgba(247,188,49,0.65)" strokeWidth="1.5" />
      <g transform="translate(12 10)">
        <rect x="-1.6" y="6" width="2.4" height="4.4" rx="1" fill="#c4860b" />
        <rect x="23.2" y="6" width="2.4" height="4.4" rx="1" fill="#c4860b" />
        <rect x="2" y="23" width="4.4" height="3.6" rx="1.2" fill="#c4860b" />
        <rect x="17.6" y="23" width="4.4" height="3.6" rx="1.2" fill="#c4860b" />
        <rect x="0.6" y="0" width="22.8" height="24.4" rx="5.4" fill="url(#brand-bus)" />
        <rect x="5.6" y="2.2" width="12.8" height="2.6" rx="1.3" fill="#1e3360" />
        <rect x="3" y="6.8" width="18" height="8.4" rx="2.4" fill="#1e3360" />
        <circle cx="6.4" cy="19.2" r="1.9" fill="#13213f" />
        <circle cx="17.6" cy="19.2" r="1.9" fill="#13213f" />
        <rect x="9.6" y="18.3" width="4.8" height="1.8" rx="0.9" fill="#13213f" />
      </g>
    </svg>
  );
}
