import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useSession } from '../lib/session.jsx';
import { Block } from './adminkit.jsx';
import Icon from './Icon.jsx';
import { Badge, ErrorText, Notice } from './ui.jsx';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');
const size = (bytes) => (bytes ? `${(Number(bytes) / 1048576).toFixed(1)} MB` : '');

/** The dashboard's view of the system itself: backups, errors, silent buses. */
export default function SystemHealth({ heading = 'System health' }) {
  const { token } = useSession();
  const health = useAsync(() => api('/api/admin/system', { token }), [token]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const h = health.data;

  const backupNow = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api('/api/admin/system/backup', { token, method: 'POST' });
      setDone(r.file ? `Backup saved: ${r.file}` : 'A backup is already running.');
      health.reload?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!h) return null;
  const good = h.database === 'ok' && !h.alerts.length && !h.errors24h && !h.problems.length;
  return (
    <Block
      title={heading}
      caption={good ? 'Everything is running normally' : 'Needs attention'}
      actions={<button className="btn ghost" disabled={busy} onClick={backupNow}><Icon name="shield" size={15} /> {busy ? 'Backing up…' : 'Back up now'}</button>}
    >
      <div className="health-grid">
        <div><small>Database</small><b>{h.database === 'ok' ? `${h.engine.split(' ')[0]} · ${h.databaseMs} ms` : 'Failing'}</b></div>
        <div><small>Last backup</small><b>{when(h.backup.finished_at)}</b>{h.backup.bytes ? <em>{size(h.backup.bytes)}{h.backup.offsite ? ' · offsite' : ''}</em> : null}</div>
        <div><small>Errors, 24 hours</small><b>{h.errors24h}</b></div>
        <div><small>Nightly clean-up</small><b>{when(h.lastNightly)}</b></div>
      </div>
      {h.alerts.length > 0 && (
        <ul className="health-list">
          {h.alerts.map((a) => <li key={a.key}><Badge tone="danger">Now</Badge> {a.message}</li>)}
        </ul>
      )}
      {h.backup.lastError && <ErrorText>{`The last backup failed: ${h.backup.lastError}`}</ErrorText>}
      {h.problems.map((p) => <Notice key={p}>{p}</Notice>)}
      <ErrorText>{error}</ErrorText>
      <Notice>{done}</Notice>
    </Block>
  );
}
