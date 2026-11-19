import { useState } from 'react';
import { api } from '../../lib/api.js';
import { incidentKind, incidentMessage, incidentSource } from '../../../../shared/incidents.js';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, Empty, ErrorText, Field, ListCard, Notice, Page, Panel, Segmented } from '../../components/ui.jsx';
import { Select } from '../../components/Picker.jsx';

const LATEST = 3;
// Each kind with its own icon; urgent ones in red, the rest in amber, closed ones grey.
const KIND_ICON = { TRACKER_OFFLINE: 'signal', SPEEDING: 'clock', CAPACITY_BREACH: 'users', OVERCROWDING: 'users', MOCK_LOCATION: 'pin', SOS: 'alert', EMERGENCY: 'shield', BREAKDOWN: 'bus', DELAY: 'clock', ATTENDANCE_CONFLICT: 'check' };
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

  // SOS, emergencies and breakdowns go up the chain until someone acknowledges them.
  const needsAck = (i) => i.status === 'OPEN' && !i.acknowledged_at && ['SOS', 'EMERGENCY', 'BREAKDOWN'].includes(i.kind);
  const acknowledge = (i) => a.run(() => api(`/api/admin/incidents/${i.id}/ack`, { token, method: 'POST' })).then(incidents.reload);
  // Automatic alerts (tracker offline, speeding, capacity) cleared together.
  const automatic = (incidents.data ?? []).filter((i) => i.status === 'OPEN' && i.source === 'system').length;
  const clearAutomatic = () => {
    if (window.confirm(`Mark all ${automatic} automatic alerts as reviewed? Alerts people sent (SOS, breakdowns, problems) stay open.`)) {
      a.run(() => api('/api/admin/incidents/resolve-system', { token, body: { resolution: 'Reviewed together' } }), `${automatic} automatic alerts cleared.`).then(incidents.reload);
    }
  };
  const resolve = (i) => {
    const resolution = window.prompt('How was it resolved?', 'Resolved');
    if (resolution) a.run(() => api(`/api/admin/incidents/${i.id}/resolve`, { token, body: { resolution } })).then(incidents.reload);
  };

  return (
    <Page eyebrow="Transport office" title="Alerts and incidents" wide>
      <div className={`cols notices-cols${showAll ? ' long' : ''}`}>
        <div className="col">
          <Panel title="Send an announcement" icon="bell" className="notices-compose">
            <form onSubmit={(e) => { e.preventDefault(); a.run(() => api('/api/notifications', { token, body: { ...f, routeCode: f.routeCode || undefined } }), 'Sent.').then((r) => r !== undefined && setF((x) => ({ ...x, title: '', message: '' }))); }}>
              <div className="grid2">
                <Field label="Kind">
                  <Select value={f.kind} onChange={set('kind')}>
                    <option value="ANNOUNCEMENT">Announcement</option><option value="ROUTE_CHANGE">Route change</option><option value="DELAY">Delay</option><option value="BREAKDOWN">Breakdown</option><option value="EMERGENCY">Emergency</option>
                  </Select>
                </Field>
                <Field label="To">
                  <Select value={f.routeCode} onChange={set('routeCode')}>
                    <option value="">Everyone (notice board)</option>
                    {(routes.data ?? []).map((r) => <option key={r.code} value={r.code}>Route {r.code} · {r.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Title"><input value={f.title} onChange={set('title')} required maxLength={150} /></Field>
              <Field label="Message"><textarea value={f.message} onChange={set('message')} rows={3} required /></Field>
              <button className="btn primary" disabled={a.busy}>Send</button>
            </form>
            <p className="fine-print">Network-wide notices go on the public notice board. Route alerts go to that route's subscribers.</p>
            <Notice>{a.message}</Notice>
            <ErrorText>{a.error}</ErrorText>
          </Panel>
        </div>
        <div className="col wide">
          <Panel
            className="notices-incidents"
            icon="alert"
            title="Incidents"
            summary={sorted == null ? 'Loading…' : sorted.length === 0 ? 'Nothing here' : `Latest: ${incidentKind(sorted[0].kind).toLowerCase()} · ${dateTime(updatedAt(sorted[0]))}`}
            badge={sorted?.length ? <Badge tone={status === 'OPEN' ? 'danger' : 'offline'}>{sorted.length}</Badge> : null}
          >
            <div className="incident-bar">
              <Segmented value={status} onChange={(v) => { setStatus(v); setShowAll(false); }} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: '', label: 'All' }]} />
              <span className="muted">{sorted ? (showAll || sorted.length <= LATEST ? `${sorted.length} incident${sorted.length === 1 ? '' : 's'}` : `${LATEST} most recently updated of ${sorted.length}`) : ''}</span>
            </div>
            {status === 'OPEN' && automatic > 1 && (
              <div className="incident-bulk">
                <span><b>{automatic}</b> {automatic === 1 ? 'is an automatic alert' : 'are automatic alerts'} (tracker offline, speeding, capacity).</span>
                <button type="button" className="btn ghost inline" disabled={a.busy} onClick={clearAutomatic}><Icon name="check" size={14} />Clear automatic alerts</button>
              </div>
            )}
            {rows == null ? <div className="skeleton-block short" /> : rows.length === 0 ? <Empty>{status === 'OPEN' ? 'No open incidents.' : 'No incidents.'}</Empty> : (
              <div className="kit-list">
                {rows.map((i) => {
                  const urgent = ['SOS', 'EMERGENCY', 'BREAKDOWN', 'CAPACITY_BREACH'].includes(i.kind);
                  return (
                    <ListCard
                      key={i.id}
                      tone={i.status !== 'OPEN' ? 'empty' : urgent ? 'alert' : 'delayed'}
                      lead={<span className="kit-row-icon"><Icon name={KIND_ICON[i.kind] ?? 'alert'} size={18} /></span>}
                      title={<>{incidentKind(i.kind)} <span className="incident-where">· {i.fleet_code ?? (i.route_code ? `Route ${i.route_code}` : 'Network')}</span></>}
                      lines={[
                        <span key="m" className="wrap">{incidentMessage(i)}</span>,
                        <span key="w" className="incident-meta">
                          {dateTime(updatedAt(i))} · {incidentSource(i)}
                          {i.lat != null && <a className="incident-map" href={`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=16/${i.lat}/${i.lng}`} target="_blank" rel="noreferrer"><Icon name="map" size={13} />View on map</a>}
                        </span>,
                        ...(needsAck(i) ? [<b key="ack" className="incident-unseen">{i.escalation_level ? `Not acknowledged - sent up the chain (${i.escalation_level})` : 'Not acknowledged yet'}</b>] : []),
                      ]}
                      side={i.status === 'OPEN' ? (
                        <span className="row-actions">
                          {needsAck(i) && <button className="btn primary inline" onClick={() => acknowledge(i)}>Acknowledge</button>}
                          <button className="btn ghost inline incident-resolve" onClick={() => resolve(i)}>Resolve</button>
                        </span>
                      ) : <small className="muted">{i.resolution}</small>}
                    />
                  );
                })}
              </div>
            )}
            {sorted && sorted.length > LATEST && (
              <button type="button" className="btn ghost small show-more" onClick={() => setShowAll((x) => !x)}>
                <Icon name={showAll ? 'up' : 'down'} size={14} />
                {showAll ? `Show the ${LATEST} most recent` : `Show all ${sorted.length}`}
              </button>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
}
