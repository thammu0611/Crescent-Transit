import { useEffect, useState } from 'react';
import BrandMark from './components/BrandMark.jsx';
import RouteBackdrop from './components/RouteBackdrop.jsx';
import AttendancePrompt from './components/AttendancePrompt.jsx';
import BoardingCheck from './components/BoardingCheck.jsx';
import MainNav from './components/MainNav.jsx';
import ProfileMenu from './components/ProfileMenu.jsx';
import SystemHealth from './components/SystemHealth.jsx';
import { Modal } from './components/ui.jsx';
import { api } from './lib/api.js';
import { useT } from './lib/i18n.js';
import BusAlternatives from './components/BusAlternatives.jsx';
import ChangePassword, { ChoosePassword } from './components/ChangePassword.jsx';
import Icon from './components/Icon.jsx';
import { SessionProvider, useSession } from './lib/session.jsx';
import { startSampler, stopSampler } from './lib/sampler.js';
import Login from './pages/Login.jsx';
import VerifyEmail from './pages/student/VerifyEmail.jsx';
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
import BusCare from './pages/admin/BusCare.jsx';
import ServiceDesk from './pages/admin/ServiceDesk.jsx';
import ParentHome from './pages/parent/ParentHome.jsx';
import BusPass from './pages/student/Pass.jsx';
import Services from './pages/student/Services.jsx';
// The finance office app is switched off for now. To bring it back, restore
// these imports and the finance NAV entry below.
// import Collections from './pages/finance/Collections.jsx';
// import Payments from './pages/finance/Payments.jsx';
// import FinanceStudents from './pages/finance/FinanceStudents.jsx';
// import Reconcile from './pages/finance/Reconcile.jsx';

// Five roles, five entirely different sets of screens (doc section 4).
// [path, label, screen, icon]
const NAV = {
  guest: [
    ['/', 'Home', PublicHome, 'home'],
    ['/login', 'Sign in', Login, 'arrow'],
  ],
  student: [
    ['/', 'Home', StudentHome, 'home'],
    ['/map', 'Live map', LiveMap, 'map'],
    ['/schedule', 'Schedule', Schedule, 'clock'],
    ['/attendance', 'Attendance', StudentAttendance, 'check'],
    ['/pass', 'Bus pass', BusPass, 'qr'],
    ['/services', 'Services', Services, 'sparkle'],
    ['/alerts', 'Alerts', Alerts, 'bell'],
    // Shown only when the university requires the subscription (entitlement.required).
    ['/pay', 'Subscription', Subscription, 'card'],
    ['/settings', 'Settings', Settings, 'settings'],
  ],
  driver: [['/', 'My trip', DriverApp, 'bus']],
  parent: [['/', 'My children', ParentHome, 'users']],
  admin: [
    ['/', 'Dashboard', Dashboard, 'chart'],
    ['/map', 'Fleet map', LiveMap, 'map'],
    ['/trips', 'Trips', Trips, 'clock'],
    ['/attendance', 'Attendance', AttendanceAdmin, 'check'],
    ['/routes', 'Routes', RoutesAdmin, 'route'],
    ['/fleet', 'Fleet', Fleet, 'bus'],
    ['/notices', 'Alerts', Notices, 'bell'],
    ['/service', 'Service desk', ServiceDesk, 'sparkle'],
    ['/care', 'Bus care', BusCare, 'shield'],
    ['/reports', 'Reports', Reports, 'list'],
  ],
  // finance: [
  //   ['/', 'Collections', Collections, 'wallet'],
  //   ['/payments', 'Payments', Payments, 'card'],
  //   ['/students', 'Students', FinanceStudents, 'users'],
  //   ['/reconcile', 'Reconciliation', Reconcile, 'shield'],
  // ],
  finance: [['/', 'Finance office', FinanceOff, 'wallet']],
};

/** What a finance account sees while the finance app is switched off. */
function FinanceOff() {
  return (
    <main className="center-page">
      <section className="panel finance-off">
        <span className="hero-badge"><Icon name="wallet" size={24} /></span>
        <h2>The finance office app is switched off</h2>
        <p className="muted">Collections, payments and reconciliation are not available right now. Sign out with the button at the top right, or contact the transport office.</p>
      </section>
    </main>
  );
}

const FALLBACK_CONTACTS = [{ label: 'Transport office', phone: '+91 44 2275 1347' }, { label: 'Campus security (24 h)', phone: '+91 44 2275 1350' }];

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

const ROLE_LABEL = { student: 'Student', driver: 'Driver', admin: 'Transport admin', finance: 'Finance officer', parent: 'Parent' };

const currentPath = () => {
  const h = window.location.hash.replace(/^#/, '') || '/';
  return h === '/driver' ? '/' : h.split('?')[0]; // old Module 1 link
};

function Shell() {
  const { user, token, entitlement, emailCheck } = useSession();
  const t = useT();
  const [path, setPath] = useState(currentPath);
  const [menuOpen, setMenuOpen] = useState(false);
  // The bar condenses once the page scrolls.
  const [scrolled, setScrolled] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [contacts, setContacts] = useState(FALLBACK_CONTACTS);
  useEffect(() => {
    api('/api/contacts').then(setContacts).catch(() => {});
  }, []);

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
    if (user?.role === 'student' && token && !emailCheck?.required) startSampler(token);
    else stopSampler();
    return () => stopSampler();
  }, [user?.role, token, emailCheck?.required]);

  const role = user?.role ?? 'guest';
  // A student whose university email is not confirmed sees only that step.
  const verifying = role === 'student' && Boolean(emailCheck?.required);
  // A temporary password from the transport office is replaced first.
  const choosing = Boolean(user?.mustChangePassword);
  // Students use everything free unless the server says a subscription is required.
  const nav = (NAV[role] ?? NAV.guest).filter(([p]) => p !== '/pay' || entitlement?.required);
  const wantsDriver = window.location.hash.startsWith('#/driver');
  const entry = nav.find(([p]) => p === path) ?? (role === 'guest' && wantsDriver ? NAV.guest[1] : nav[0]);
  const Screen = entry[2];

  useEffect(() => {
    const onScroll = (e) => setScrolled((e.target.scrollTop ?? 0) > 8);
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
  useEffect(() => setScrolled(false), [entry[0]]);

  return (
    <div className={`app${scrolled ? ' scrolled' : ''}`}>
      <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
      <RouteBackdrop />
      {/* Contact strip and the floating navigation pill. */}
      <div className="masthead">
        <div className="utility-bar">
          <div className="utility-inner">
            {contacts.slice(0, 2).map((c, i) => (
              <span key={c.label} className={`util-item${i ? ' hide-sm' : ''}`}>
                <Icon name={i ? 'shield' : 'phone'} size={14} /> {c.label.replace(' (24 h)', '')} <a href={`tel:${c.phone.replaceAll(' ', '')}`}>{c.phone}</a>
              </span>
            ))}
            <span className="util-spacer" />
            <Clock />
          </div>
        </div>
        <header className="topbar">
          <a className="brand" href="#/" aria-label="Crescent Transit - home">
            <BrandMark size={50} />
            <span className="brand-text">
              <strong>Crescent</strong>
              <span className="brand-sub">Transit</span>
              <small>B.S. Abdur Rahman Crescent Institute · Bus Tracker</small>
            </span>
          </a>
          <button className="menu-toggle" aria-expanded={menuOpen} aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            <Icon name="menu" size={22} />
          </button>
          <MainNav links={nav} activePath={entry[0]} role={role} open={menuOpen}>
            {user && (
              <span className="user-chip">
                <ProfileMenu roleLabel={ROLE_LABEL[role]} onChangePassword={() => setChangingPassword(true)} onSystemHealth={role === 'admin' ? () => setCheckingHealth(true) : null} />
              </span>
            )}
          </MainNav>
        </header>
      </div>
      <div id="main-content" tabIndex={-1} className={`screen${role === 'student' ? ' with-tabs' : ''}`} key={`${role}:${entry[0]}`}>
        {choosing ? <ChoosePassword /> : verifying ? <VerifyEmail /> : <Screen />}
      </div>
      {role === 'student' && !verifying && !choosing && (
        <nav className="bottom-tabs" aria-label="Student">
          {STUDENT_TABS.map(([p, label, icon]) => (
            <a key={p} href={`#${p}`} className={entry[0] === p ? 'active' : ''} aria-current={entry[0] === p ? 'page' : undefined}>
              <Icon name={icon} size={21} />
              <span>{t(label)}</span>
            </a>
          ))}
        </nav>
      )}
      {role === 'student' && !verifying && !choosing && <AttendancePrompt />}
      {role === 'student' && !verifying && !choosing && <BoardingCheck />}
      {role === 'student' && !verifying && !choosing && <BusAlternatives />}
      {user && changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
      {role === 'admin' && checkingHealth && <Modal title="System health" width={760} onClose={() => setCheckingHealth(false)}><SystemHealth heading={null} /></Modal>}
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
