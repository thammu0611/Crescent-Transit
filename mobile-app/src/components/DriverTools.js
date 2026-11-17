import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Image, Modal, Pressable, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DIRECTION_TEXT } from '../../../shared/direction.js';
import { CHECKLIST_ITEMS } from '../../../shared/service.js';
import { api, pickDocumentFile } from '../lib/api.js';
import { date } from '../lib/format.js';
import { useAction, useAsync } from '../lib/hooks.js';
import { useT } from '../lib/offline.js';
import { C, F } from '../theme.js';
import { ViewCard } from './adminkit.js';
import Icon from './Icon.js';
import { Badge, Button, ErrorText, Notice, Row, Text, TextField, Txt } from './ui.js';

/** The check before each run. A failed item goes straight to the transport office. */
export function PreTripCheck({ token }) {
  const t = useT();
  const status = useAsync(() => api('/api/driver/checklist', { token }), [token]);
  const [results, setResults] = useState(() => Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, true])));
  const [note, setNote] = useState('');
  const a = useAction();
  const done = status.data?.done;
  const send = () => a.run(() => api('/api/driver/checklist', { token, body: { results, note } }), t('Check saved.')).then(status.reload);
  return (
    <ViewCard
      icon="check"
      title="Pre-trip check"
      summary={status.data ? `${DIRECTION_TEXT[status.data.direction]} · ${done ? (done.failed ? `${done.failed} failed` : t('All passed')) : t('Not done yet')}` : t('Loading…')}
      badge={status.data ? <Badge tone={!done ? 'delayed' : done.failed ? 'danger' : 'live'}>{!done ? t('To do') : done.failed ? t('Problem') : t('Done')}</Badge> : null}
    >
      {CHECKLIST_ITEMS.map(([k, label]) => (
        <Row key={k}>
          <Txt style={{ flex: 1 }}>{t(label)}</Txt>
          <Txt small muted>{results[k] ? 'OK' : t('Problem')}</Txt>
          <Switch accessibilityLabel={label} value={results[k]} onValueChange={(v) => setResults((r) => ({ ...r, [k]: v }))} />
        </Row>
      ))}
      <TextField label="Note (anything wrong?)" value={note} maxLength={300} onChangeText={setNote} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>
      <Button title="Save check" busy={a.busy} onPress={send} />
    </ViewCard>
  );
}

function Scanner({ onScan, onClose }) {
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <Row style={{ padding: 12 }}>
          <Text style={{ color: '#fff', ...F[800], fontSize: 17, flex: 1 }}>{t('Scan the student\'s pass')}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="x" size={24} color="#fff" /></Pressable>
        </Row>
        {!permission ? null : !permission.granted ? (
          <View style={{ padding: 20, gap: 12 }}>
            <Text style={{ color: '#fff' }}>{t('Camera permission is needed to scan a pass.')}</Text>
            <Button title={t('Allow camera')} variant="red" onPress={requestPermission} />
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              done.current = true;
              onScan(String(data));
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** Scan a student's bus pass: shows whether it is valid and records them on the trip. */
export function PassScanner({ token, tripRunning }) {
  const t = useT();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const check = async (code) => {
    setScanning(false);
    setError(null);
    setResult(null);
    try {
      setResult(await api('/api/driver/pass-scan', { token, body: { code } }));
    } catch (err) {
      setError(err.message);
    }
  };
  const line = result && (result.valid
    ? (result.recorded ? 'Valid · marked on board' : result.alreadyRecorded ? 'Valid · already on this trip' : t('Valid'))
    : `Pass not valid${result.validTo ? ` · ended ${date(result.validTo)}` : ''}`);
  return (
    <ViewCard icon="qr" title="Scan a bus pass" summary={tripRunning ? t('Checks the pass and marks the student on board') : t('Checks the pass. Start a trip to mark students on board')}>
      <>
          <Button title="Scan pass" icon="qr" onPress={() => setScanning(true)} />
          <ErrorText>{error}</ErrorText>
          {result ? (
            <Row gap={12} style={{ padding: 12, borderRadius: 16, backgroundColor: result.valid ? C.emerald50 : C.danger50 }}>
              {result.photo ? <Image source={{ uri: result.photo }} style={{ width: 54, height: 54, borderRadius: 12 }} /> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Txt bold>{result.name}</Txt>
                <Txt small muted>{[result.registerNo, result.routeCode && `Route ${result.routeCode}`, result.stopName].filter(Boolean).join(' · ')}</Txt>
                <Txt small muted>{line}{result.sameRoute ? '' : ' · a different route'}</Txt>
              </View>
              <Badge tone={result.valid ? 'live' : 'danger'}>{result.valid ? t('Valid') : t('Not valid')}</Badge>
            </Row>
          ) : null}
          {scanning ? <Scanner onScan={check} onClose={() => setScanning(false)} /> : null}
      </>
    </ViewCard>
  );
}

/** Something left on the bus. */
export function FoundItem({ token }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const a = useAction();
  const send = () => a.run(() => api('/api/lost-items', { token, body: { kind: 'FOUND', title, description } }), t('Posted to lost and found.')).then((r) => { if (r) { setTitle(''); setDescription(''); } });
  return (
    <ViewCard icon="search" title="Found something on the bus?" summary={t('Post it so the student can claim it')}>
      <TextField label="What is it?" value={title} maxLength={80} onChangeText={setTitle} />
      <TextField label="Details" value={description} maxLength={400} onChangeText={setDescription} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>
      <Button title="Post item" busy={a.busy} disabled={title.trim().length < 3} onPress={send} />
    </ViewCard>
  );
}

/** Fuel at the pump: the odometer, litres and what it cost. */
export function FuelEntry({ token }) {
  const t = useT();
  const [form, setForm] = useState({ odometerKm: '', litres: '', costRupees: '' });
  const a = useAction();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const [scan, setScan] = useState(null); // { reading } or { found, message }
  // A photo or PDF of the pump receipt: the server reads it and the boxes fill in.
  const readReceipt = async () => {
    let file;
    try {
      file = await pickDocumentFile();
    } catch (err) {
      setScan({ found: 0, message: err.message });
      return;
    }
    if (!file) return;
    setScan({ reading: true });
    try {
      const r = await api('/api/fuel/receipt', { token, body: { data: file.data, mimeType: file.mimeType, name: file.name } });
      setForm((f) => ({
        odometerKm: r.odometerKm ? String(r.odometerKm) : f.odometerKm,
        litres: r.litres ? String(r.litres) : f.litres,
        costRupees: r.amountRupees ? String(r.amountRupees) : f.costRupees,
      }));
      const found = [r.litres, r.amountRupees, r.odometerKm].filter(Boolean).length;
      setScan({ found, message: found ? t('Filled from the receipt - check the boxes, then save.') : (r.message ?? t('Could not read this receipt. Type the numbers instead.')) });
    } catch (err) {
      setScan({ found: 0, message: err.message });
    }
  };
  const send = () => a.run(() => api('/api/fuel', { token, body: { odometerKm: Number(form.odometerKm), litres: Number(form.litres), costRupees: Number(form.costRupees) } }), t('Fuel saved.'))
    .then((r) => { if (r) setForm({ odometerKm: '', litres: '', costRupees: '' }); });
  return (
    <ViewCard icon="wallet" title="Fuel entry" summary={t('Odometer, litres and the amount paid')}>
      <Button title={scan?.reading ? t('Reading the receipt…') : t('Scan fuel receipt')} icon="camera" variant="ghost" busy={scan?.reading} onPress={readReceipt} />
      {scan?.message ? (scan.found ? <Notice>{scan.message}</Notice> : <ErrorText>{scan.message}</ErrorText>) : null}
      <TextField label="Odometer (km)" keyboardType="number-pad" value={form.odometerKm} onChangeText={set('odometerKm')} />
      <TextField label="Litres" keyboardType="decimal-pad" value={form.litres} onChangeText={set('litres')} />
      <TextField label="Amount paid (₹)" keyboardType="decimal-pad" value={form.costRupees} onChangeText={set('costRupees')} />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error}</ErrorText>
      <Button title="Save fuel" busy={a.busy} disabled={!form.odometerKm || !form.litres || !form.costRupees} onPress={send} />
    </ViewCard>
  );
}
