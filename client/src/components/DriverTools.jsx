import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { CHECKLIST_ITEMS } from '../../../shared/service.js';
import { DIRECTION_TEXT } from '../../../shared/direction.js';
import { useT } from '../lib/i18n.js';
import { useAction, useAsync } from '../lib/useAsync.js';
import Icon from './Icon.jsx';
import { ViewCard } from './adminkit.jsx';
import { Badge, ErrorText, Field, Modal, Notice } from './ui.jsx';

/** The check before each run. A failed item goes straight to the transport office. */
export function PreTripCheck({ token }) {
  const t = useT();
  const status = useAsync(() => api('/api/driver/checklist', { token }), [token]);
  const [results, setResults] = useState(() => Object.fromEntries(CHECKLIST_ITEMS.map(([k]) => [k, true])));
  const [note, setNote] = useState('');
  const a = useAction();
  const done = status.data?.done;
  const send = (e) => {
    e.preventDefault();
    a.run(() => api('/api/driver/checklist', { token, body: { results, note } }), t('Check saved.')).then(status.reload);
  };
  return (
    <ViewCard
      icon="check"
      title="Pre-trip check"
      summary={status.data ? `${DIRECTION_TEXT[status.data.direction]} · ${done ? (done.failed ? `${done.failed} item failed` : t('All passed')) : t('Not done yet')}` : t('Loading…')}
      badge={status.data ? <Badge tone={!done ? 'delayed' : done.failed ? 'danger' : 'live'}>{!done ? t('To do') : done.failed ? t('Problem') : t('Done')}</Badge> : null}
    >
      <form onSubmit={send}>
        <div className="check-list">
          {CHECKLIST_ITEMS.map(([k, label]) => (
            <label key={k} className={`check-line${results[k] ? '' : ' failed'}`}>
              <input type="checkbox" checked={results[k]} onChange={(e) => setResults((r) => ({ ...r, [k]: e.target.checked }))} />
              <span>{t(label)}</span>
              <small>{results[k] ? 'OK' : t('Problem')}</small>
            </label>
          ))}
        </div>
        <Field label="Note (anything wrong?)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>{t('Save check')}</button>
      </form>
    </ViewCard>
  );
}

/** Scan a student's bus pass: shows whether it is valid and records them on the trip. */
export function PassScanner({ token, tripRunning, onRecorded }) {
  const t = useT();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const video = useRef(null);
  const canScan = 'BarcodeDetector' in window;

  const check = async (code) => {
    setError(null);
    setResult(null);
    try {
      const r = await api('/api/driver/pass-scan', { token, body: { code } });
      setResult(r);
      if (r.recorded) onRecorded?.();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!scanning) return undefined;
    let stream;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]) {
            setScanning(false);
            check(found[0].rawValue);
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
    <ViewCard icon="qr" title="Scan a bus pass" summary={tripRunning ? t('Checks the pass and marks the student on board') : t('Checks the pass. Start a trip to mark students on board')}>
      {canScan
        ? <button type="button" className="btn primary" onClick={() => setScanning(true)}><Icon name="qr" size={16} /> {t('Scan pass')}</button>
        : <p className="muted">{t('This browser cannot read QR codes. Use the Crescent Transit phone app to scan.')}</p>}
      <ErrorText>{error}</ErrorText>
      {result && (
        <div className={`scan-result ${result.valid ? 'ok' : 'bad'}`}>
          {result.photo && <img src={result.photo} alt="" />}
          <span>
            <b>{result.name}</b>
            <small>{[result.registerNo, result.routeCode && `Route ${result.routeCode}`, result.stopName].filter(Boolean).join(' · ')}</small>
            <small>
              {result.valid ? (result.recorded ? 'Valid · marked on board' : result.alreadyRecorded ? 'Valid · already on this trip' : t('Valid')) : `Pass not valid${result.validTo ? ` · ended ${date(result.validTo)}` : ''}`}
              {result.sameRoute ? '' : ' · a different route'}
            </small>
          </span>
          <Badge tone={result.valid ? 'live' : 'danger'}>{result.valid ? t('Valid') : t('Not valid')}</Badge>
        </div>
      )}
      {scanning && (
        <Modal title={t('Scan the student\'s pass')} onClose={() => setScanning(false)}>
          <video ref={video} className="scanner" playsInline muted />
        </Modal>
      )}
    </ViewCard>
  );
}

/** Something left on the bus. */
export function FoundItem({ token }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const a = useAction();
  const send = (e) => {
    e.preventDefault();
    a.run(() => api('/api/lost-items', { token, body: { kind: 'FOUND', title, description } }), t('Posted to lost and found.')).then((r) => { if (r) { setTitle(''); setDescription(''); } });
  };
  return (
    <ViewCard icon="search" title="Found something on the bus?" summary={t('Post it so the student can claim it')}>
      <form onSubmit={send}>
        <Field label="What is it?"><input value={title} maxLength={80} minLength={3} required onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Details"><input value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>{t('Post item')}</button>
      </form>
    </ViewCard>
  );
}

/** Fuel at the pump: the odometer, litres and what it cost. */
export function FuelEntry({ token }) {
  const t = useT();
  const [form, setForm] = useState({ odometerKm: '', litres: '', costRupees: '' });
  const a = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const send = (e) => {
    e.preventDefault();
    a.run(() => api('/api/fuel', { token, body: { odometerKm: Number(form.odometerKm), litres: Number(form.litres), costRupees: Number(form.costRupees) } }), t('Fuel saved.'))
      .then((r) => { if (r) setForm({ odometerKm: '', litres: '', costRupees: '' }); });
  };
  return (
    <ViewCard icon="wallet" title="Fuel entry" summary={t('Odometer, litres and the amount paid')}>
      <form onSubmit={send}>
        <Field label="Odometer (km)"><input type="number" min="0" inputMode="numeric" value={form.odometerKm} onChange={set('odometerKm')} required /></Field>
        <div className="grid2">
          <Field label="Litres"><input type="number" min="0" step="0.01" inputMode="decimal" value={form.litres} onChange={set('litres')} required /></Field>
          <Field label="Amount paid (₹)"><input type="number" min="0" step="0.01" inputMode="decimal" value={form.costRupees} onChange={set('costRupees')} required /></Field>
        </div>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>{t('Save fuel')}</button>
      </form>
    </ViewCard>
  );
}
