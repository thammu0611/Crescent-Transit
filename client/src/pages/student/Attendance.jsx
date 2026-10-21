import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { METHOD_TEXT, STATUS_TEXT, dateTime, thisMonth, time } from '../../lib/format.js';
import { refreshPlan, setSource, submitOtp, useSampler } from '../../lib/sampler.js';
import { useSession } from '../../lib/session.jsx';
import { useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, Empty, ErrorText, Field, Modal, Notice, Page, Panel, Table } from '../../components/ui.jsx';

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
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null);
  const buses = useAsync(
    () => (s.plan?.subscribed && user.homeRouteCode ? api(`/api/live?route=${encodeURIComponent(user.homeRouteCode)}`, { token }) : Promise.resolve([])),
    [s.plan?.subscribed, user.homeRouteCode, token],
  );
  const p = s.plan;
  if (!p) return <Panel title="Automatic attendance"><p className="muted">Checking…</p></Panel>;
  const checks = [
    ...(p.subscribed ? [] : [['Subscription', false, <a key="a" href="#/pay">Subscribe</a>]]),
    ['Location consent', p.consent, <a key="b" href="#/settings">Give consent in Settings</a>],
    ['This phone bound to your account', p.deviceBound && !s.otp, null],
    ['Inside your travel window', p.inTravelWindow, <span key="c">Window: {p.travelWindows}</span>],
  ];
  return (
    <Panel title="Automatic attendance" icon="signal" actions={<Badge tone={checks.every((c) => c[1]) ? 'live' : 'offline'}>{checks.every((c) => c[1]) ? 'Active' : 'Paused'}</Badge>}>
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
          <p className="muted">Your account is bound to another phone. Enter the one-time code to move it here{s.otp.devOtp ? ` (test mode code: ${s.otp.devOtp})` : ''}.</p>
          <div className="inline-form">
            <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit code" aria-label="One-time code" />
            <button className="btn ghost">Move here</button>
          </div>
          <ErrorText>{otpError}</ErrorText>
        </form>
      )}
      {p.shouldSample && !s.otp && (
        <>
          <Field label="Location source">
            <select value={s.source === 'ride' ? `ride:${s.rideBusId}` : 'gps'} onChange={(e) => (e.target.value === 'gps' ? setSource('gps') : setSource('ride', Number(e.target.value.split(':')[1])))}>
              <option value="gps">This phone's location</option>
              {(buses.data ?? []).map((b) => <option key={b.busId} value={`ride:${b.busId}`}>Demo: ride along with {b.fleetCode}</option>)}
            </select>
          </Field>
          <p className="muted">
            One reading every {p.intervalS} s, only in your travel window. It is compared with the bus and discarded - never stored.
            {s.last && <> Last: {time(s.last.at)} · {s.last.prompted ? 'prompt sent' : s.last.status ?? (s.last.matched ? `moving with a bus (${s.last.count ?? ''})` : s.last.reason?.toLowerCase().replaceAll('_', ' ') ?? 'ok')}</>}
          </p>
        </>
      )}
      <ErrorText>{s.error}</ErrorText>
      <button className="btn ghost" onClick={refreshPlan}>Refresh</button>
    </Panel>
  );
}

/** QR / code check-in for when GPS is not available (doc 9.7), queued while offline. */
function CheckIn({ token, user, onDone }) {
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
      onDone();
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

  return (
    <Panel title="No GPS? Check in with the bus code" icon="qr">
      <p className="muted">Scan the QR code on the driver's screen, or type the route and the 6-digit code shown under it.</p>
      {'BarcodeDetector' in window && (
        <button className="btn ghost" onClick={() => setScanning(true)}>Scan QR code</button>
      )}
      <form className="grid2" onSubmit={(e) => { e.preventDefault(); checkIn({ routeCode, code }); }}>
        <Field label="Route"><input value={routeCode} onChange={(e) => setRouteCode(e.target.value)} required /></Field>
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} pattern="\d{6}" required /></Field>
        <button className="btn primary">Check in</button>
      </form>
      {queue.length > 0 && <p className="muted">{queue.length} scan(s) waiting for the network.</p>}
      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>
      {scanning && (
        <Modal title="Scan the bus QR code" onClose={() => setScanning(false)}>
          <video ref={videoRef} className="scanner" playsInline muted />
        </Modal>
      )}
    </Panel>
  );
}

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
          <select value={claimedPresent ? 'yes' : 'no'} onChange={(e) => setClaimedPresent(e.target.value === 'yes')}>
            <option value="yes">On this bus</option>
            <option value="no">Not on this bus</option>
          </select>
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
  // Only the latest three trips at first (the server sends newest first); the rest fold away.
  const [showAll, setShowAll] = useState(false);
  const records = record.data?.records ?? [];

  useEffect(() => {
    const reload = () => record.reload();
    window.addEventListener('ubts:attendance-changed', reload);
    return () => window.removeEventListener('ubts:attendance-changed', reload);
  }, [record]);

  return (
    <Page eyebrow="Student" title="Attendance" subtitle="Marked when you answer “Did you board?” after your bus leaves your stop, when your phone and the bus travel together, or by the bus QR code.">
      <div className="cols">
        <div className="col">
          <SamplingStatus token={token} user={user} />
          <CheckIn token={token} user={user} onDone={record.reload} />
        </div>
        <div className="col wide">
          <Panel
            icon="check"
            title={record.data ? `My record · ${record.data.tripsPresent} trip${record.data.tripsPresent === 1 ? '' : 's'} present` : 'My record'}
            actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
          >
            {!entitlement?.active ? <Empty>Your attendance record is part of the subscription. <a href="#/pay">Subscribe</a>.</Empty> : (
              <>
                <ErrorText>{record.error?.message}</ErrorText>
                <Table
                  rows={record.data ? (showAll ? records : records.slice(0, 3)) : undefined}
                  rowKey={(r) => r.attendance_id}
                  empty="No trips recorded this month."
                  columns={[
                    { key: 'boarded_at', label: 'Trip', render: (r) => <><b>{dateTime(r.boarded_at)}</b><small><span className="route-code sm">{r.route_code}</span>{r.route_name} · {METHOD_TEXT[r.method] ?? r.method}</small></> },
                    { key: 'stops', label: 'From → to', wrap: true, render: (r) => <>{r.boarding_stop ?? '—'} <span className="muted">→</span> {r.alighting_stop ?? (r.alighted_at ? '—' : <i>on board</i>)}</> },
                    { key: 'status', label: 'Status', render: (r) => <><Badge tone={TONE[r.status]}>{STATUS_TEXT[r.status]}{r.auto_confirmed ? ' (auto)' : ''}</Badge><small>{r.present ? 'Counted present' : 'Not counted'}</small></> },
                    { key: 'x', label: '', render: (r) => (r.canDispute ? <button className="link" onClick={() => setDisputing(r)}>Dispute</button> : <small>{r.dispute?.resolution ?? ''}</small>) },
                  ]}
                />
                {records.length > 3 && (
                  <button type="button" className="btn ghost small show-more" onClick={() => setShowAll((v) => !v)}>
                    <Icon name={showAll ? 'up' : 'down'} size={14} />
                    {showAll ? 'Show the latest 3 only' : `Show all ${records.length} trips`}
                  </button>
                )}
                <p className="fine-print">Disputes can be raised within 7 days. Records are locked each night at 23:30; the transport office can still correct them.</p>
              </>
            )}
          </Panel>
        </div>
      </div>
      {disputing && <DisputeDialog token={token} record={disputing} onClose={() => setDisputing(null)} onDone={() => { setDisputing(null); record.reload(); }} />}
    </Page>
  );
}
