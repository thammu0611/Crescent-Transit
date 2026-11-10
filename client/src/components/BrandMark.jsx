import logo from '../assets/logo-mark.png';

// The Crescent Transit mark: a gold crescent over a navy bus, on a navy square.
// The phone app shows the same picture (mobile-app/assets/logo-mark.png).
export default function BrandMark({ size = 48 }) {
  return <img className="brand-icon" src={logo} width={size} height={size} alt="" />;
}
