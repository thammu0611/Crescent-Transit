import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/Icon.js';
import {
  Badge, Button, DataList, Empty, ErrorText, ItemCard, LinkButton, MonthPicker, Notice, PageHead, Panel, Row, Screen,
  Segmented, Select, Sheet, Text, TextField, Txt,
} from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';
import { ATTENDANCE_CHANGED, on } from '../../lib/events.js';
import { METHOD_TEXT, STATUS_TEXT, dateTime, thisMonth, time } from '../../lib/format.js';
import { useAsync, useRefresh } from '../../lib/hooks.js';
import { refreshPlan, setSource, submitOtp, useSampler } from '../../lib/sampler.js';
import { useSession } from '../../lib/session.js';
import { getJSON, setJSON } from '../../lib/storage.js';
import { C, F, G } from '../../theme.js';

const QUEUE_KEY = 'ubts.qrQueue';
const TONE = { CONFIRMED: 'live', ON_BOARD: 'live', COMPLETED: 'live', PROVISIONAL: 'delayed', PROMPTED: 'delayed', DISPUTED: 'delayed', ADJUSTED: 'offline', REJECTED: 'offline', VOID: 'offline' };

function SamplingStatus({ token, user, navigation }) {
  const s = useSampler();
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null);
  const buses = useAsync(
    () => (s.plan?.subscribed && user.homeRouteCode ? api(`/api/live?route=${encodeURIComponent(user.homeRouteCode)}`, { token }) : Promise.resolve([])),
    [s.plan?.subscribed, user.homeRouteCode, token],
  );
  const p = s.plan;
  if (!p) return <Panel title="Automatic attendance" icon="signal"><Txt muted>Checking…</Txt><ErrorText>{s.error}</ErrorText><Button title="Refresh" variant="ghost" small onPress={refreshPlan} /></Panel>;
  const checks = [
    ...(p.subscribed ? [] : [['Subscription', false, <LinkButton key="a" title="Subscribe" onPress={() => navigation.navigate('Subscription')} />]]),
    ['Location consent', p.consent, <LinkButton key="b" title="Give consent in Settings" onPress={() => navigation.navigate('Profile')} />],
    ['This phone bound to your account', p.deviceBound && !s.otp, null],
    ['Inside your travel window', p.inTravelWindow, <Txt key="c" muted small>Window: {p.travelWindows}</Txt>],
  ];
  const allOk = checks.every((c) => c[1]);
  return (
    <Panel title="Automatic attendance" icon="signal" actions={<Badge tone={allOk ? 'live' : 'offline'}>{allOk ? 'Active' : 'Paused'}</Badge>}>
      {checks.map(([label, ok, fix]) => (
        <View key={label} style={{ gap: 2 }}>
          <Row>
            <Icon name={ok ? 'check' : 'x'} size={15} color={ok ? C.live : C.danger} />
            <Txt style={{ flex: 1 }}>{label}</Txt>
          </Row>
          {!ok && fix ? <View style={{ paddingLeft: 23 }}>{fix}</View> : null}
        </View>
      ))}
      {s.otp && (
        <View style={{ gap: 8 }}>
          <Txt muted small>Your account is bound to another phone. Enter the one-time code to move it here{s.otp.devOtp ? ` (test mode code: ${s.otp.devOtp})` : ''}.</Txt>
          <Row>
            <TextField value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} placeholder="6-digit code" style={{ flex: 1 }} accessibilityLabel="One-time code" />
            <Button title="Move here" variant="ghost" onPress={async () => { setOtpError(null); try { await submitOtp(otp); } catch (err) { setOtpError(err.message); } }} />
          </Row>
          <ErrorText>{otpError}</ErrorText>
        </View>
      )}
      {p.shouldSample && !s.otp && (
        <>
          <Select
            label="Location source"
            value={s.source === 'ride' ? `ride:${s.rideBusId}` : 'gps'}
            onChange={(v) => (v === 'gps' ? setSource('gps') : setSource('ride', Number(String(v).split(':')[1])))}
            options={[{ value: 'gps', label: "This phone's location" }, ...(buses.data ?? []).map((b) => ({ value: `ride:${b.busId}`, label: `Demo: ride along with ${b.fleetCode}` }))]}
          />
          <Txt muted small>
            One reading every {p.intervalS} s, only in your travel window, while the app is open. It is compared with the bus and discarded - never stored.
            {s.last ? ` Last: ${time(s.last.at)} · ${s.last.prompted ? 'prompt sent' : s.last.status ?? (s.last.matched ? `moving with a bus (${s.last.count ?? ''})` : s.last.reason?.toLowerCase().replaceAll('_', ' ') ?? 'ok')}` : ''}
          </Txt>
        </>
      )}
      <ErrorText>{s.error}</ErrorText>
      <Button title="Refresh" variant="ghost" small onPress={refreshPlan} />
    </Panel>
  );
}

/** Full-screen camera that reports the first boarding QR code it sees. */
function Scanner({ onScan, onClose }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <Row style={{ padding: 12 }}>
          <Text style={{ color: '#fff', ...F[800], fontSize: 17, flex: 1 }}>Scan the bus QR code</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="x" size={24} color="#fff" /></Pressable>
        </Row>
        {!permission ? null : !permission.granted ? (
          <View style={{ padding: 20, gap: 12 }}>
            <Text style={{ color: '#fff' }}>Camera permission is needed to scan the code on the driver's screen.</Text>
            <Button title="Allow camera" variant="red" onPress={requestPermission} />
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current || !String(data).startsWith('UBTS-BOARD:')) return;
              done.current = true;
              onScan(String(data));
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** QR / code check-in for when GPS is not available (doc 9.7), queued while offline. */
function CheckIn({ token, user, onDone }) {
  const [routeCode, setRouteCode] = useState(user.homeRouteCode ?? '');
  const [code, setCode] = useState('');
  const [queue, setQueue] = useState([]);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);

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
      const q = [...(await getJSON(QUEUE_KEY, [])), full];
      await setJSON(QUEUE_KEY, q);
      setQueue(q);
      setMessage('No network. The scan is saved and will be sent when the connection returns.');
    }
  };

  // Replay queued scans on open and whenever the app comes back to the foreground.
  useEffect(() => {
    const flush = async () => {
      const q = await getJSON(QUEUE_KEY, []);
      setQueue(q);
      if (!q.length) return;
      const rest = [];
      for (const scan of q) if (!(await submit(scan))) rest.push(scan);
      await setJSON(QUEUE_KEY, rest);
      setQueue(rest);
    };
    flush();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && flush());
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typed = () => {
    if (!routeCode.trim()) return setError('Enter the route.');
    if (!/^\d{6}$/.test(code)) return setError('The code has 6 digits.');
    checkIn({ routeCode: routeCode.trim(), code });
  };

  return (
    <Panel title="No GPS? Check in with the bus code" icon="qr">
      <Txt muted small>Scan the QR code on the driver's screen, or type the route and the 6-digit code shown under it.</Txt>
      <Button title="Scan QR code" variant="indigo" icon="qr" onPress={() => setScanning(true)} />
      <Row>
        <TextField label="Route" value={routeCode} onChangeText={setRouteCode} style={{ flex: 1 }} autoCapitalize="characters" />
        <TextField label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} style={{ flex: 1 }} />
      </Row>
      <Button title="Check in" onPress={typed} />
      {queue.length > 0 && <Txt muted small>{queue.length} scan(s) waiting for the network.</Txt>}
      <Notice>{message}</Notice>
      <ErrorText>{error}</ErrorText>
      {scanning && <Scanner onClose={() => setScanning(false)} onScan={(payload) => { setScanning(false); checkIn({ payload }); }} />}
    </Panel>
  );
}

function DisputeDialog({ token, record, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [claimedPresent, setClaimedPresent] = useState(!record.present);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (reason.trim().length < 5) return setError('Describe what is wrong (at least 5 characters).');
    setBusy(true);
    try {
      await api(`/api/attendance/${record.attendance_id}/dispute`, { token, body: { reason, claimedPresent } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Dispute this record" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Txt muted small>{record.fleet_code} · {dateTime(record.boarded_at)} · currently {STATUS_TEXT[record.status]}</Txt>
        <Txt bold>I was</Txt>
        <Segmented value={claimedPresent} onChange={setClaimedPresent} options={[{ value: true, label: 'On this bus' }, { value: false, label: 'Not on this bus' }]} />
        <TextField label="What is wrong?" value={reason} onChangeText={setReason} multiline />
        <ErrorText>{error}</ErrorText>
        <Button title="Send to the transport office" busy={busy} onPress={send} />
      </View>
    </Sheet>
  );
}

export default function StudentAttendance({ navigation }) {
  const { token, user, entitlement } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const [disputing, setDisputing] = useState(null);
  const record = useAsync(() => (entitlement?.active ? api(`/api/attendance/me?month=${month}`, { token }) : Promise.resolve(null)), [token, month, entitlement?.active]);
  const { refreshing, onRefresh } = useRefresh(record, refreshPlan);

  const reload = record.reload;
  // Only the latest three trips at first (the server sends newest first); the rest fold away.
  const [showAll, setShowAll] = useState(false);
  const records = record.data?.records ?? [];
  useEffect(() => on(ATTENDANCE_CHANGED, () => reload()), [reload]);

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="check" colors={G.emerald} eyebrow="Student" title="Attendance" subtitle="Marked when you answer “Did you board?” after your bus leaves your stop, when your phone and the bus travel together, or by the bus QR code." />
      <SamplingStatus token={token} user={user} navigation={navigation} />
      <CheckIn token={token} user={user} onDone={record.reload} />
      <Panel
        icon="check"
        title={record.data ? `My record · ${record.data.tripsPresent} trip${record.data.tripsPresent === 1 ? '' : 's'} present` : 'My record'}
      >
        <MonthPicker value={month} onChange={setMonth} />
        {!entitlement?.active ? (
          <View style={{ alignItems: 'center' }}>
            <Empty>Your attendance record is part of the subscription.</Empty>
            <LinkButton title="Subscribe" onPress={() => navigation.navigate('Subscription')} />
          </View>
        ) : (
          <>
            <ErrorText>{record.error?.message}</ErrorText>
            <DataList
              rows={record.data ? (showAll ? records : records.slice(0, 3)) : undefined}
              keyOf={(r) => r.attendance_id}
              empty="No trips recorded this month."
              render={(r) => (
                <ItemCard
                  title={dateTime(r.boarded_at)}
                  subtitle={`Route ${r.route_code} · ${r.route_name} · ${METHOD_TEXT[r.method] ?? r.method}`}
                  right={<Badge tone={TONE[r.status]}>{`${STATUS_TEXT[r.status]}${r.auto_confirmed ? ' (auto)' : ''}`}</Badge>}
                >
                  <Txt small>{r.boarding_stop ?? '—'} → {r.alighting_stop ?? (r.alighted_at ? '—' : 'on board')}</Txt>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt muted small>{r.present ? 'Counted present' : 'Not counted'}</Txt>
                    {r.canDispute ? <LinkButton title="Dispute" onPress={() => setDisputing(r)} /> : <Txt muted small>{r.dispute?.resolution ?? ''}</Txt>}
                  </Row>
                </ItemCard>
              )}
            />
            {records.length > 3 ? (
              <Button
                small
                variant="ghost"
                icon={showAll ? 'up' : 'down'}
                title={showAll ? 'Show the latest 3 only' : `Show all ${records.length} trips`}
                onPress={() => setShowAll((v) => !v)}
              />
            ) : null}
            <Txt muted small>Disputes can be raised within 7 days. Records are locked each night at 23:30; the transport office can still correct them.</Txt>
          </>
        )}
      </Panel>
      {disputing && <DisputeDialog token={token} record={disputing} onClose={() => setDisputing(null)} onDone={() => { setDisputing(null); record.reload(); }} />}
    </Screen>
  );
}
