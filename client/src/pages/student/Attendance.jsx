import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { METHOD_TEXT, STATUS_TEXT, dateTime, thisMonth, time } from '../../lib/format.js';
import { refreshPlan, setSource, requestNewOtp, submitOtp, useSampler } from '../../lib/sampler.js';
import { useServerInfo } from '../../lib/serverInfo.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, DirectionBadge, Empty, ErrorText, Field, Modal, Notice } from '../../components/ui.jsx';
import { Chips, DetailView } from '../../components/adminkit.jsx';
import RateTrip from '../../components/RateTrip.jsx';
import { useT } from '../../lib/i18n.js';
import { Select } from '../../components/Picker.jsx';

const QUEUE_KEY = 'ubts.qrQueue';
const readQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) ?? [];
  } catch {
    return [];
  }
};
const writeQueue = (q) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // Without storage the scan is only kept while this page is open.
  }
};

const TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'offline', REJECTED: 'offline', VOID: 'offline' };

function SamplingStatus({ token, user }) {
  const s = useSampler();
  // "Ride along with a bus" stands in for a real ride in demonstrations only.
  const demo = Boolean(useServerInfo()?.demoMode);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null);
  const buses = useAsync(
    () => (s.plan?.subscribed && user.homeRouteCode ? api(`/api/live?route=${encodeURIComponent(user.homeRouteCode)}`, { token }) : Promise.resolve([])),
    [s.plan?.subscribed, user.homeRouteCode, token],
  );
  const p = s.plan;
  if (!p) return <section className="att-panel"><p className="muted">Checking…</p></section>;
  const checks = [
    ...(p.subscribed ? [] : [['Subscription', false, <a key="a" href="#/pay">Subscribe</a>]]),
    ['Location consent', p.consent, <a key="b" href="#/settings">Give consent in Settings</a>],
    ['This phone bound to your account', p.deviceBound && !s.otp, null],
    ['Inside your travel window', p.inTravelWindow, <span key="c">Window: {p.travelWindows}</span>],
  ];
  const allOk = checks.every((c) => c[1]);
  return (
    <section className="att-panel">
      <div className="att-panel-head">
        <span><b>Automatic attendance</b><small>{allOk ? 'Your phone confirms trips by itself' : `Paused · ${checks.find((c) => !c[1])?.[0] ?? 'check the steps'}`}</small></span>
        <Badge tone={allOk ? 'live' : 'offline'}>{allOk ? 'Active' : 'Paused'}</Badge>
      </div>
      <ul className="checklist">
        {checks.map(([label, ok, fix]) => (
          <li key={label} className={ok ? 'ok' : 'no'}>
            <span><Icon name={ok ? 'check' : 'x'} size={15} /> {label}</span>
            {!ok && fix}
          </li>
        ))}
      </ul>
      {s.otp && (
        <form className="otp" onSubmit={async (e) => { e.preventDefault(); setOtpError(null); try { await submitOtp(otp); } catch (err) { setOtpError(err.message); } }}>
          <p className="muted">
            {s.otp.emailedTo ? `Your account is bound to another phone. We emailed a code to ${s.otp.emailedTo}. Enter it to move your account here.` : 'Your account is bound to another phone. If you have no code, ask the transport office to reset your phone.'}
            {s.otp.devOtp ? ` (test mode code: ${s.otp.devOtp})` : ''}
          </p>
          <div className="inline-form">
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit code" aria-label="One-time code" />
            <button className="btn ghost">Move here</button>
          </div>
          <button type="button" className="link" onClick={async () => { setOtpError(null); try { await requestNewOtp(); setOtp(''); } catch (err) { setOtpError(err.message); } }}>Send a new code</button>
          <ErrorText>{otpError}</ErrorText>
        </form>
      )}
      {p.shouldSample && !s.otp && (
        <>
          <Field label="Location source">
            <Select value={s.source === 'ride' ? `ride:${s.rideBusId}` : 'gps'} onChange={(e) => (e.target.value === 'gps' ? setSource('gps') : setSource('ride', Number(e.target.value.split(':')[1])))}>
              <option value="gps">This phone's location</option>
              {demo && (buses.data ?? []).map((b) => <option key={b.busId} value={`ride:${b.busId}`}>Demo: ride along with {b.fleetCode}</option>)}
            </Select>
          </Field>
          <p className="muted">
            One reading every {p.intervalS} s, only in your travel window. It is compared with the bus and discarded - never stored.
            {s.last && <> Last: {time(s.last.at)} · {s.last.prompted ? 'prompt sent' : s.last.status ?? (s.last.matched ? `moving with a bus (${s.last.count ?? ''})` : s.last.reason?.toLowerCase().replaceAll('_', ' ') ?? 'ok')}</>}
          </p>
        </>
      )}
      <ErrorText>{s.error}</ErrorText>
      <button type="button" className="btn ghost" onClick={refreshPlan}>Refresh</button>
    </section>
  );
}

/** QR / code check-in for when GPS is not available (doc 9.7), queued while offline. */
function CheckIn({ token, user, onDone, mode, setMode }) {
  const [routeCode, setRouteCode] = useState(user.homeRouteCode ?? '');
  const [code, setCode] = useState('');
  const [queue, setQueue] = useState(readQueue);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);

  const submit = async (scan) => {
    try {
      const r = await api('/api/attendance/qr', { token, body: scan });
      setMessage(r.alreadyRecorded ? 'You were already recorded on this trip.' : 'Checked in. You are recorded on board.');
      onDone({ bus: r.fleetCode ? r.fleetCode.replace('BSACIST-', 'Bus ') : `Route ${scan.routeCode ?? ''}`.trim(), at: new Date().toISOString(), how: scan.payload ? 'scanned QR' : 'typed code', already: r.alreadyRecorded });
      return true;
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        return true; // the server answered: do not queue
      }
      return false;
    }
  };

  const checkIn = async (scan) => {
    setError(null);
    setMessage(null);
    const full = { ...scan, scannedAt: new Date().toISOString() };
    if (!(await submit(full))) {
      const q = [...readQueue(), full];
      writeQueue(q);
      setQueue(q);
      setMessage('No network. The scan is saved and will be sent when the connection returns.');
    }
  };

  // Replay queued scans when the network is back.
  useEffect(() => {
    const flush = async () => {
      const q = readQueue();
      if (!q.length) return;
      const rest = [];
      for (const scan of q) if (!(await submit(scan))) rest.push(scan);
      writeQueue(rest);
      setQueue(rest);
    };
    flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera scanning where the browser has a barcode detector (Chrome on Android).
  useEffect(() => {
    if (!scanning) return undefined;
    let stream;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const found = await detector.detect(videoRef.current).catch(() => []);
          const hit = found.find((f) => f.rawValue.startsWith('UBTS-BOARD:'));
          if (hit) {
            setScanning(false);
            checkIn({ payload: hit.rawValue });
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err) {
        setError(`Camera: ${err.message}`);
        setScanning(false);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const camera = 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia);
  return (
    <>
      {mode === 'qr' && (
        <>
          <section className={`att-scan${scanning ? ' on' : ''}`}>
            {scanning ? <video ref={videoRef} className="att-video" playsInline muted /> : null}
            <span className="att-scan-frame" aria-hidden="true"><i /><i /><i /><i /><b /></span>
            {scanning
              ? <button type="button" className="btn ghost att-scan-btn" onClick={() => setScanning(false)}>Stop camera</button>
              : camera
                ? <button type="button" className="btn att-scan-btn" onClick={() => setScanning(true)}><Icon name="qr" size={16} /> Start camera</button>
                : <p className="att-scan-note">Scanning works in the phone app, or on Chrome for Android</p>}
          </section>
          <button type="button" className="att-code-link" onClick={() => setMode('code')}>
            <Icon name="keypad" size={18} />
            <span>No camera? Enter the 6-digit code</span>
            <Icon name="arrow" size={16} />
          </button>
        </>
      )}
      {mode === 'code' && (
        <section className="att-panel">
          <p className="muted">Type the route and the 6-digit code shown under the QR on the driver's phone.</p>
          <form className="att-code-form" onSubmit={(e) => { e.preventDefault(); checkIn({ routeCode, code }); }}>
            <Field label="Route"><input value={routeCode} onChange={(e) => setRouteCode(e.target.value)} required /></Field>
            <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} pattern="\d{6}" required /></Field>
            <button className="btn primary"><Icon name="tick" size={16} /> Check in</button>
          </form>
        </section>
      )}
      {queue.length > 0 && <p className="muted small">{queue.length} scan(s) waiting for the network.</p>}
      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

/** A ring with the share of trips counted present, on the navy summary card (as on the phone). */
function Ring({ pct }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg className="att-sum-ring" viewBox="0 0 96 96" role="img" aria-label={`${pct}% present`}>
      <circle cx="48" cy="48" r={r} className="track" />
      {pct > 0 && <circle cx="48" cy="48" r={r} className="fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 48 48)" />}
      <text x="48" y="45" className="pct">{pct}%</text>
      <text x="48" y="62" className="lbl">present</text>
    </svg>
  );
}

/** One direction's month: trips present out of trips taken, with a bar. */
function DirTile({ name, done, total }) {
  return (
    <div className="att-dir">
      <small>{name}</small>
      <b className="tabular">{done}<em>{` of ${total}`}</em></b>
      <i><s style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></i>
    </div>
  );
}

/** Today's morning or evening trip: present (bus and time), waiting for an answer, or not yet. */
function TodayRow({ dir, rec }) {
  const present = Boolean(rec?.present);
  const tone = present ? 'live' : rec ? 'delayed' : 'offline';
  return (
    <div className={`att-today-row ${tone}`}>
      <span className="att-today-icon"><Icon name={present ? 'check' : rec ? 'clock' : 'bus'} size={18} /></span>
      <span className="att-today-text">
        <b>{dir === 'DOWN' ? 'Evening · From college' : 'Morning · To college'}</b>
        <small>{present ? `${busName(rec.fleet_code)} · boarded ${time(rec.boarded_at)}` : rec ? STATUS_TEXT[rec.status] ?? 'Waiting' : 'Not checked in yet'}</small>
      </span>
      <Badge tone={tone}>{present ? 'Present' : rec ? 'Pending' : 'Waiting'}</Badge>
    </div>
  );
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const busName = (fleet) => String(fleet ?? '').replace('BSACIST-', 'Bus ');

function DisputeDialog({ token, record, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [claimedPresent, setClaimedPresent] = useState(!record.present);
  const [error, setError] = useState(null);
  const send = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/attendance/${record.attendance_id}/dispute`, { token, body: { reason, claimedPresent } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title="Dispute this record" onClose={onClose}>
      <p className="muted">{record.fleet_code} · {dateTime(record.boarded_at)} · currently {STATUS_TEXT[record.status]}</p>
      <form onSubmit={send}>
        <Field label="I was">
          <Select value={claimedPresent ? 'yes' : 'no'} onChange={(e) => setClaimedPresent(e.target.value === 'yes')}>
            <option value="yes">On this bus</option>
            <option value="no">Not on this bus</option>
          </Select>
        </Field>
        <Field label="What is wrong?"><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required minLength={5} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn primary">Send to the transport office</button>
      </form>
    </Modal>
  );
}

export default function StudentAttendance() {
  const { token, user, entitlement } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [disputing, setDisputing] = useState(null);
  const record = useAsync(() => (entitlement?.active ? api(`/api/attendance/me?month=${month}`, { token }) : Promise.resolve(null)), [token, month, entitlement?.active]);
  // Only the latest five trips at first (the server sends newest first); the rest fold away.
  const [showAll, setShowAll] = useState(false);
  const [run, setRun] = useState('');
  const [mode, setMode] = useState('qr');
  const [checked, setChecked] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const t = useT();
  const [rating, setRating] = useState(null);
  const rated = useAsync(() => (entitlement?.active ? api('/api/feedback/me', { token }) : Promise.resolve([])), [token, entitlement?.active]);
  const ratedTrips = new Set((rated.data ?? []).map((f) => f.trip_id));
  const canRate = (r) => r.present && Date.now() - new Date(r.boarded_at).getTime() < 7 * 86400000;
  const all = record.data?.records ?? [];
  const records = all.filter((r) => !run || r.direction === run);
  const up = all.filter((r) => r.direction === 'UP');
  const down = all.filter((r) => r.direction === 'DOWN');
  const present = all.filter((r) => r.present).length;
  const pct = all.length ? Math.round((present / all.length) * 100) : 0;
  const disputes = all.filter((r) => r.dispute && !r.dispute.resolution).length;
  // Today's two trips always come from this month, whichever month the history shows.
  const current = useAsync(() => (entitlement?.active && month !== thisMonth() ? api(`/api/attendance/me?month=${thisMonth()}`, { token }) : Promise.resolve(null)), [token, month, entitlement?.active]);
  const todayAll = month === thisMonth() ? all : current.data?.records ?? [];
  const todayOf = (d) => {
    const mine = todayAll.filter((r) => r.direction === d && sameDay(r.boarded_at, Date.now()));
    return mine.find((r) => r.present) ?? mine[0] ?? null;
  };
  const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: month.slice(0, 4) === thisMonth().slice(0, 4) ? undefined : 'numeric' });
  const todayName = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  const toHistory = () => setHistoryOpen(true);
  const shown = showAll ? records : records.slice(0, 5);

  useEffect(() => {
    const reload = () => record.reload();
    window.addEventListener('ubts:attendance-changed', reload);
    return () => window.removeEventListener('ubts:attendance-changed', reload);
  }, [record]);

  return (
    <main className="page app-page att">
      <header className="att-head">
        <h1>{t('Attendance')}</h1>
        {/* The full record opens from this small button, as on the phone. */}
        <button type="button" className="att-history-btn" onClick={toHistory}>
          <Icon name="calendar" size={16} /> {t('History')}
        </button>
      </header>

      <div className="att-grid">
        <div className="att-left">
          {/* The month at a glance, as on the phone. */}
          {entitlement?.active ? (
            <section className="att-sum">
              <div className="att-sum-top">
                <div className="att-sum-text">
                  <small>{monthName.toUpperCase()}</small>
                  <b className="tabular">{record.data ? present : '—'}<em>{record.data ? ` of ${all.length} trips` : ''}</em></b>
                  <span>{t('counted present')} {month === thisMonth() ? t('this month') : ''}</span>
                </div>
                <Ring pct={pct} />
              </div>
              <div className="att-sum-dirs">
                <DirTile name={t('To college')} done={up.filter((r) => r.present).length} total={up.length} />
                <DirTile name={t('From college')} done={down.filter((r) => r.present).length} total={down.length} />
              </div>
              {disputes > 0 && (
                <button type="button" className="att-sum-disputes" onClick={toHistory}>
                  <Icon name="clock" size={15} /> <span>{disputes} dispute{disputes === 1 ? '' : 's'} under review</span> <Icon name="arrow" size={15} />
                </button>
              )}
            </section>
          ) : (
            <section className="panel att-card att-locked">
              <span className="att-today-icon"><Icon name="lock" size={20} /></span>
              <b>Your attendance record is part of the subscription</b>
              <a className="btn primary inline" href="#/pay">Subscribe <Icon name="arrow" size={15} /></a>
            </section>
          )}

          {/* Today: both trips of the day. */}
          <section className="panel att-card" aria-live="polite">
            <div className="att-card-head"><h2>{t('Today')}</h2><small>{todayName}</small></div>
            {checked && (
              <div className="att-checked" role="status">
                <span className="att-checked-icon"><Icon name="check" size={20} /></span>
                <span><b>{checked.already ? 'Already checked in' : "You're checked in"}</b><small>{checked.bus} · {time(checked.at)} · {checked.how}</small></span>
                <button type="button" className="att-checked-close" aria-label="Close" onClick={() => setChecked(null)}><Icon name="x" size={16} /></button>
              </div>
            )}
            <div className="att-today-rows">
              <TodayRow dir="UP" rec={todayOf('UP')} />
              <TodayRow dir="DOWN" rec={todayOf('DOWN')} />
            </div>
          </section>

        </div>

        <div className="att-left">
          {/* Check in yourself, if the bus did not ask. */}
          <section className="panel att-card">
            <div className="att-card-head"><span><h2>{t('Check in')}</h2><small>If the bus didn't ask you, use one of these.</small></span></div>
            <div className="att-tabs" role="tablist" aria-label="Ways to check in">
              {[['qr', 'Scan QR', 'qr'], ['code', 'Code', 'keypad'], ['gps', 'Automatic', 'locate']].map(([k, name, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                  <Icon name={icon} size={16} /> {t(name)}
                </button>
              ))}
            </div>
            {mode === 'gps'
              ? <SamplingStatus token={token} user={user} />
              : <CheckIn token={token} user={user} mode={mode} setMode={setMode} onDone={(c) => { setChecked(c); record.reload(); }} />}
          </section>
        </div>
      </div>

      {historyOpen && (
      <DetailView
        title={t('History')}
        subtitle={record.data ? `${record.data.upPresent} ${t('to college')} · ${record.data.downPresent} ${t('from college')} ${t('present')}` : t('My record')}
        onClose={() => { setHistoryOpen(false); setMonth(thisMonth()); }}
        actions={<input className="att-month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      >
        <section className="att-history" id="att-history">
          {!entitlement?.active ? <Empty>Your attendance record is part of the subscription. <a href="#/pay">Subscribe</a>.</Empty> : (
            <>
              <ErrorText>{record.error?.message}</ErrorText>
              <Chips
                value={run}
                onChange={setRun}
                options={[
                  { value: '', label: t('Both directions'), count: all.length },
                  { value: 'UP', label: t('To college'), count: up.length },
                  { value: 'DOWN', label: t('From college'), count: down.length },
                ]}
              />
              {record.data == null ? <div className="skeleton-block" /> : records.length === 0 ? <Empty>No trips recorded this month.</Empty> : (
                <ul className="att-list">
                  {shown.map((r) => {
                    const d = new Date(r.boarded_at);
                    return (
                      <li key={r.attendance_id} className={r.present ? 'present' : 'absent'}>
                        <span className="att-day"><b>{d.getDate()}</b><small>{d.toLocaleDateString('en-IN', { month: 'short' })}</small></span>
                        <span className="att-main">
                          <b><span className="route-code sm">{r.route_code}</span> {r.route_name}</b>
                          <small>{time(r.boarded_at)} · {r.boarding_stop ?? '—'} → {r.alighting_stop ?? (r.alighted_at ? '—' : 'on board')}</small>
                          <small className="att-how">{METHOD_TEXT[r.method] ?? r.method} · {r.present ? 'Counted present' : 'Not counted'}</small>
                        </span>
                        <span className="att-side">
                          <Badge tone={TONE[r.status]}>{STATUS_TEXT[r.status]}{r.auto_confirmed ? ' (auto)' : ''}</Badge>
                          <DirectionBadge direction={r.direction} />
                          <span className="att-actions">
                            {r.canDispute ? <button type="button" className="link" onClick={() => setDisputing(r)}>Dispute</button> : r.dispute?.resolution ? <small>{r.dispute.resolution}</small> : null}
                            {ratedTrips.has(r.trip_id) ? <small>{t('Rated')}</small> : canRate(r) ? <button type="button" className="link" onClick={() => setRating(r)}>{t('Rate trip')}</button> : null}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {records.length > 5 && (
                <button type="button" className="btn ghost small show-more" onClick={() => setShowAll((v) => !v)}>
                  <Icon name={showAll ? 'up' : 'down'} size={14} />
                  {showAll ? 'Show the latest 5 only' : `Show all ${records.length} trips`}
                </button>
              )}
              <p className="fine-print">Disputes can be raised within 7 days. Records are locked each night at 23:30; the transport office can still correct them.</p>
            </>
          )}
        </section>
      </DetailView>
      )}
      {rating && <RateTrip trip={rating} onClose={() => setRating(null)} onDone={() => { setRating(null); rated.reload(); }} />}
      {disputing && <DisputeDialog token={token} record={disputing} onClose={() => setDisputing(null)} onDone={() => { setDisputing(null); record.reload(); }} />}
    </main>
  );
}
