import { useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { Badge, ErrorText, Field, FoldPanel, Notice, Page, Panel, Segmented, Table } from '../../components/ui.jsx';

const LATEST = 5;
const updatedAt = (i) => i.resolved_at ?? i.created_at;

/** Announcements to all or one route, and the incident log (doc 4.1). */
export default function Notices() {
  const { token } = useSession();
  const routes = useAsync(() => api('/api/routes'), []);
  const [status, setStatus] = useState('OPEN');
  const incidents = useAsync(() => api(`/api/admin/incidents${status ? `?status=${status}` : ''}`, { token }), [status, token]);
  const [showAll, setShowAll] = useState(false);
  const [f, setF] = useState({ kind: 'ANNOUNCEMENT', routeCode: '', title: '', message: '' });
  // Most recently updated first (a resolution counts as an update).
  const sorted = incidents.data ? [...incidents.data].sort((x, y) => new Date(updatedAt(y)) - new Date(updatedAt(x))) : null;
  const rows = sorted && !showAll ? sorted.slice(0, LATEST) : sorted;
  const a = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const resolve = (i) => {
    const resolution = window.prompt('How was it resolved?', 'Resolved');
    if (resolution) a.run(() => api(`/api/admin/incidents/${i.id}/resolve`, { token, body: { resolution } })).then(incidents.reload);
  };

  return (
    <Page eyebrow="Transport office" title="Alerts and incidents" wide>
      <div className="cols">
        <div className="col">
          <Panel title="Send an announcement" icon="bell">
            <form onSubmit={(e) => { e.preventDefault(); a.run(() => api('/api/notifications', { token, body: { ...f, routeCode: f.routeCode || undefined } }), 'Sent.').then((r) => r !== undefined && setF((x) => ({ ...x, title: '', message: '' }))); }}>
              <div className="grid2">
                <Field label="Kind">
                  <select value={f.kind} onChange={set('kind')}>
                    <option value="ANNOUNCEMENT">Announcement</option><option value="ROUTE_CHANGE">Route change</option><option value="DELAY">Delay</option><option value="BREAKDOWN">Breakdown</option><option value="EMERGENCY">Emergency</option>
                  </select>
                </Field>
                <Field label="To">
                  <select value={f.routeCode} onChange={set('routeCode')}>
                    <option value="">Everyone (notice board)</option>
                    {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>Route {r.code} · {r.name}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Title"><input value={f.title} onChange={set('title')} required maxLength={150} /></Field>
              <Field label="Message"><textarea value={f.message} onChange={set('message')} rows={3} required /></Field>
              <button className="btn primary" disabled={a.busy}>Send</button>
            </form>
            <p className="fine-print">Network-wide notices are on the free notice board. Route alerts go to that route's subscribers.</p>
            <Notice>{a.message}</Notice>
            <ErrorText>{a.error}</ErrorText>
          </Panel>
        </div>
        <div className="col wide">
          <FoldPanel
            icon="alert"
            title="Incidents"
            initiallyOpen
            summary={sorted == null ? 'Loading…' : sorted.length === 0 ? 'Nothing here' : `Latest: ${sorted[0].kind.replaceAll('_', ' ').toLowerCase()} · ${dateTime(updatedAt(sorted[0]))}`}
            badge={sorted?.length ? <Badge tone={status === 'OPEN' ? 'danger' : 'offline'}>{sorted.length}</Badge> : null}
          >
            <div className="incident-bar">
              <Segmented value={status} onChange={(v) => { setStatus(v); setShowAll(false); }} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: '', label: 'All' }]} />
              <span className="muted">{sorted ? (showAll || sorted.length <= LATEST ? `${sorted.length} incident${sorted.length === 1 ? '' : 's'}` : `${LATEST} most recently updated of ${sorted.length}`) : ''}</span>
            </div>
            <Table
              rows={rows}
              empty={status === 'OPEN' ? 'No open incidents.' : 'No incidents.'}
              columns={[
                { key: 'created_at', label: 'Updated', render: (i) => <>{dateTime(updatedAt(i))}{i.resolved_at && <small>reported {dateTime(i.created_at)}</small>}</> },
                { key: 'kind', label: 'Kind', render: (i) => <><Badge tone={['SOS', 'EMERGENCY', 'BREAKDOWN', 'CAPACITY_BREACH'].includes(i.kind) ? 'danger' : 'delayed'}>{i.kind.replaceAll('_', ' ')}</Badge><small>{i.source}{i.username ? ` · ${i.username}` : ''}</small></> },
                { key: 'where', label: 'Bus / route', render: (i) => i.fleet_code ?? (i.route_code ? `Route ${i.route_code}` : '—') },
                { key: 'message', label: 'Detail', wrap: true, render: (i) => <>{i.message ?? '—'}{i.lat != null && <> · <a href={`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=16/${i.lat}/${i.lng}`} target="_blank" rel="noreferrer">map</a></>}</> },
                { key: 'x', label: '', render: (i) => (i.status === 'OPEN' ? <button className="btn ghost inline incident-resolve" onClick={() => resolve(i)}>Resolve</button> : <small>{i.resolution}</small>) },
              ]}
            />
            {sorted && sorted.length > LATEST && (
              <button type="button" className="btn ghost inline" onClick={() => setShowAll((x) => !x)}>
                {showAll ? `Show the ${LATEST} most recent` : `Show all ${sorted.length}`}
              </button>
            )}
          </FoldPanel>
        </div>
      </div>
    </Page>
  );
}
