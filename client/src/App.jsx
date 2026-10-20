import { useEffect, useState } from 'react';
import AttendancePrompt from './components/AttendancePrompt.jsx';
import BoardingCheck from './components/BoardingCheck.jsx';
import ChangePassword from './components/ChangePassword.jsx';
import Icon from './components/Icon.jsx';
import { SessionProvider, useSession } from './lib/session.jsx';
import { startSampler, stopSampler } from './lib/sampler.js';
import Login from './pages/Login.jsx';
import PublicHome from './pages/PublicHome.jsx';
import LiveMap from './pages/LiveMap.jsx';
import DriverApp from './pages/DriverApp.jsx';
import StudentHome from './pages/student/StudentHome.jsx';
import Subscription from './pages/student/Subscription.jsx';
import StudentAttendance from './pages/student/Attendance.jsx';
import Settings from './pages/student/Settings.jsx';
import Schedule from './pages/student/Schedule.jsx';
import Alerts from './pages/student/Alerts.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Fleet from './pages/admin/Fleet.jsx';
import RoutesAdmin from './pages/admin/RoutesAdmin.jsx';
import Trips from './pages/admin/Trips.jsx';
import AttendanceAdmin from './pages/admin/AttendanceAdmin.jsx';
import Reports from './pages/admin/Reports.jsx';
import Notices from './pages/admin/Notices.jsx';
import Collections from './pages/finance/Collections.jsx';
import Payments from './pages/finance/Payments.jsx';
import FinanceStudents from './pages/finance/FinanceStudents.jsx';
import Reconcile from './pages/finance/Reconcile.jsx';

// Four roles, four entirely different sets of screens (doc section 4).
// [path, label, screen, icon]
const NAV = {
  guest: [
    ['/', 'Routes & notices', PublicHome, 'route'],
    ['/login', 'Sign in', Login, 'arrow'],
  ],
  student: [
    ['/', 'Home', StudentHome, 'home'],
    ['/map', 'Live map', LiveMap, 'map'],
    ['/schedule', 'Schedule', Schedule, 'clock'],
    ['/attendance', 'Attendance', StudentAttendance, 'check'],
    ['/alerts', 'Alerts', Alerts, 'bell'],
    // Shown only when the university requires the subscription (entitlement.required).
    ['/pay', 'Subscription', Subscription, 'card'],
    ['/settings', 'Settings', Settings, 'settings'],
  ],
  driver: [['/', 'My trip', DriverApp, 'bus']],
  admin: [
    ['/', 'Dashboard', Dashboard, 'chart'],
    ['/map', 'Fleet map', LiveMap, 'map'],
    ['/trips', 'Trips', Trips, 'clock'],
    ['/attendance', 'Attendance', AttendanceAdmin, 'check'],
    ['/routes', 'Routes', RoutesAdmin, 'route'],
    ['/fleet', 'Fleet', Fleet, 'bus'],
    ['/notices', 'Alerts', Notices, 'bell'],
    ['/reports', 'Reports', Reports, 'list'],
  ],
  finance: [
    ['/', 'Collections', Collections, 'wallet'],
    ['/payments', 'Payments', Payments, 'card'],
    ['/students', 'Students', FinanceStudents, 'users'],
    ['/reconcile', 'Reconciliation', Reconcile, 'shield'],
  ],
};

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="util-item">
      <Icon name="clock" size={14} />
      {now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

// The student's phone gets an app-style tab bar for the five things used daily.
const STUDENT_TABS = [['/', 'Home', 'home'], ['/map', 'Track', 'map'], ['/schedule', 'Schedule', 'clock'], ['/attendance', 'Attendance', 'check'], ['/settings', 'Profile', 'users']];

const ROLE_LABEL = { student: 'Student', driver: 'Driver', admin: 'Transport admin', finance: 'Finance officer' };

const currentPath = () => {
  const h = window.location.hash.replace(/^#/, '') || '/';
  return h === '/driver' ? '/' : h.split('?')[0]; // old Module 1 link
};

function Shell() {
  const { user, token, signOut, entitlement } = useSession();
  const [path, setPath] = useState(currentPath);
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    const onHash = () => {
      setPath(currentPath());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The attendance sampler runs for students, whichever screen is open.
  useEffect(() => {
    if (user?.role === 'student' && token) startSampler(token);
    else stopSampler();
    return () => stopSampler();
  }, [user?.role, token]);

  const role = user?.role ?? 'guest';
  // Students use everything free unless the server says a subscription is required.
  const nav = (NAV[role] ?? NAV.guest).filter(([p]) => p !== '/pay' || entitlement?.required);
  const wantsDriver = window.location.hash.startsWith('#/driver');
  const entry = nav.find(([p]) => p === path) ?? (role === 'guest' && wantsDriver ? NAV.guest[1] : nav[0]);
  const Screen = entry[2];

  return (
    <div className="app">
      {/* Contact strip and the floating navigation pill. */}
      <div className="masthead">
        <div className="utility-bar">
          <div className="utility-inner">
            <span className="util-item"><Icon name="phone" size={14} /> Transport office <a href="tel:+914422751347">+91 44 2275 1347</a></span>
            <span className="util-item hide-sm"><Icon name="shield" size={14} /> Campus security <a href="tel:+914422751350">+91 44 2275 1350</a></span>
            <span className="util-spacer" />
            <Clock />
          </div>
        </div>
        <header className="topbar">
          <a className="brand" href="#/" aria-label="Crescent Transit - home">
            <span className="brand-mark" aria-hidden="true"><span className="brand-crest"><Icon name="bus" size={19} /></span></span>
            <span className="brand-text">
              <strong>Crescent</strong>
              <span className="brand-sub">Transit</span>
              <small>B.S. Abdur Rahman Crescent Institute · Bus Tracker</small>
            </span>
          </a>
          <button className="menu-toggle" aria-expanded={menuOpen} aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name="menu" size={22} />
          </button>
          <nav className={`tabs${menuOpen ? ' open' : ''}`} aria-label="Main">
            {nav.map(([p, label, , icon]) => (
              <a
                key={p}
                href={`#${p}`}
                // A guest's "Sign in" is the bar's call to action.
                className={[entry[0] === p && 'active', role === 'guest' && p === '/login' && 'nav-cta'].filter(Boolean).join(' ')}
                aria-current={entry[0] === p ? 'page' : undefined}
              >
                <Icon name={icon} size={16} />
                {label}
              </a>
            ))}
            {user && (
              <span className="user-chip">
                <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
                <span className="user-meta"><b>{user.name}</b><small>{ROLE_LABEL[role]}</small></span>
                <button className="icon-btn" title="Change password" aria-label="Change password" onClick={() => setChangingPassword(true)}>
                  <Icon name="lock" size={17} />
                </button>
                <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => { signOut(); window.location.hash = '#/'; }}>
                  <Icon name="logout" size={17} />
                </button>
              </span>
            )}
          </nav>
        </header>
      </div>
      <div className={`screen${role === 'student' ? ' with-tabs' : ''}`} key={`${role}:${entry[0]}`}>
        <Screen />
      </div>
      {role === 'student' && (
        <nav className="bottom-tabs" aria-label="Student">
          {STUDENT_TABS.map(([p, label, icon]) => (
            <a key={p} href={`#${p}`} className={entry[0] === p ? 'active' : ''} aria-current={entry[0] === p ? 'page' : undefined}>
              <Icon name={icon} size={21} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      )}
      {role === 'student' && <AttendancePrompt />}
      {role === 'student' && <BoardingCheck />}
      {user && changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
