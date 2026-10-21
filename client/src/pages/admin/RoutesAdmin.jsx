import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import BaseTiles from '../../components/BaseTiles.jsx';
import L from 'leaflet';
import { api } from '../../lib/api.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import Icon from '../../components/Icon.jsx';
import { Badge, ErrorText, Field, Modal, Notice, Panel } from '../../components/ui.jsx';
import { haversineMeters } from '../../../../shared/geo.js';

const stopIcon = (n) => L.divIcon({ className: '', html: `<div class="stop-pin">${n}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function ClickToAdd({ enabled, onAdd }) {
  useMapEvents({ click: (e) => enabled && onAdd(e.latlng) });
  return null;
}
function Fit({ stops, id }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length) map.fitBounds(stops.map((s) => [s.lat, s.lng]), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);
  return null;
}

function RouteForm({ token, route, onClose, onSaved }) {
  const [f, setF] = useState({ code: route?.code ?? '', name: route?.name ?? '', startPoint: route?.start_point ?? '', endPoint: route?.end_point ?? 'BSACIST', departureTime: route?.departure_time ?? '', description: route?.description ?? '', active: route?.active ?? true });
  const a = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <Modal title={route ? `Edit route ${route.code}` : 'New route'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); a.run(() => api(route ? `/api/admin/routes/${route.id}` : '/api/admin/routes', { token, method: route ? 'PATCH' : 'POST', body: f })).then((r) => r && onSaved(r)); }}>
        <div className="grid2">
          <Field label="Code"><input value={f.code} onChange={set('code')} required /></Field>
          <Field label="Name"><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Starts at"><input value={f.startPoint} onChange={set('startPoint')} /></Field>
          <Field label="Ends at"><input value={f.endPoint} onChange={set('endPoint')} /></Field>
          <Field label="Morning departure"><input value={f.departureTime} onChange={set('departureTime')} placeholder="6.45 AM" /></Field>
          <label className="field check"><input type="checkbox" checked={f.active} onChange={set('active')} /> <span>Active (shown to students)</span></label>
        </div>
        <Field label="Description"><input value={f.description} onChange={set('description')} /></Field>
        <ErrorText>{a.error}</ErrorText>
        <button className="btn primary" disabled={a.busy}>Save</button>
      </form>
    </Modal>
  );
}

/** Route builder (doc B.8): click to place stops, drag to move, reorder, segment distances. */
export default function RoutesAdmin() {
  const { token } = useSession();
  const routes = useAsync(() => api('/api/admin/routes', { token }), [token]);
  const [routeId, setRouteId] = useState(null);
  const stops = useAsync(() => (routeId ? api(`/api/admin/routes/${routeId}/stops`, { token }) : Promise.resolve([])), [routeId, token]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const a = useAction();
  const route = routes.data?.find((r) => r.id === routeId);
  const list = useMemo(() => stops.data ?? [], [stops.data]);

  useEffect(() => {
    if (!routeId && routes.data?.length) setRouteId(routes.data[0].id);
  }, [routes.data, routeId]);

  const after = () => { stops.reload(); routes.reload(); };
  const addAt = async (latlng) => {
    const name = window.prompt('Name of the new stop?');
    if (!name) return;
    const r = await a.run(() => api(`/api/admin/routes/${routeId}/stops`, { token, body: { name, lat: latlng.lat, lng: latlng.lng } }), `Added ${name}.`);
    if (r) after();
  };
  const move = async (index, delta) => {
    const ids = list.map((s) => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    if (await a.run(() => api(`/api/admin/routes/${routeId}/stops/order`, { token, method: 'PUT', body: { stopIds: ids } }))) after();
  };
  const patchStop = async (s, body, msg) => {
    if (await a.run(() => api(`/api/admin/stops/${s.id}`, { token, method: 'PATCH', body }), msg)) after();
  };
  const deleteStop = async (s) => {
    if (!window.confirm(`Delete stop ${s.name}?`)) return;
    if (await a.run(() => api(`/api/admin/stops/${s.id}`, { token, method: 'DELETE' }), `Deleted ${s.name}.`)) after();
  };
  const totalKm = list.reduce((sum, s, i) => (i ? sum + haversineMeters(list[i - 1], s) : 0), 0) / 1000;

  return (
    <main className="live-layout">
      <aside className="sidebar">
        <Panel title="Routes" icon="route" actions={<button className="btn ghost" onClick={() => setEditing('new')}><Icon name="plus" size={14} />New route</button>}>
          <select className="full" value={routeId ?? ''} onChange={(e) => setRouteId(Number(e.target.value))} aria-label="Route">
            {(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}{r.active ? '' : ' (inactive)'}</option>)}
          </select>
          {route && (
            <>
              <div className="chips">
                <span className="chip"><Icon name="pin" size={13} /><b>{route.stop_count}</b> stops</span>
                <span className="chip"><Icon name="route" size={13} /><b>{totalKm.toFixed(1)}</b> km</span>
                <span className="chip"><Icon name="bus" size={13} /><b>{route.buses ?? 'No bus'}</b></span>
                <span className="chip"><Icon name="users" size={13} /><b>{route.students}</b> students</span>
                <span className="chip"><Icon name="clock" size={13} /><b>{route.segments_learned}</b> learned ETA segments</span>
                {!route.active && <Badge tone="danger">Inactive</Badge>}
              </div>
              <button className="btn ghost" onClick={() => setEditing(route)}><Icon name="edit" size={14} /> Edit route details</button>
            </>
          )}
        </Panel>
        <Panel title="Stops in order" icon="pin" actions={<button className={`btn ${adding ? 'red inline' : 'ghost'}`} onClick={() => setAdding((x) => !x)}><Icon name={adding ? 'x' : 'plus'} size={14} />{adding ? 'Click the map…' : 'Add on map'}</button>}>
          <Notice>{a.message}</Notice>
          <ErrorText>{a.error}</ErrorText>
          <ol className="stop-editor">
            {list.map((s, i) => (
              <li key={s.id}>
                <span className="seq">{s.seq}</span>
                <input className="name" defaultValue={s.name} title={s.name} aria-label={`Name of stop ${s.seq}`} onBlur={(e) => e.target.value !== s.name && patchStop(s, { name: e.target.value }, 'Renamed.')} />
                <div className="meta-row">
                  <small className="seg">
                    {i > 0 ? `+${(haversineMeters(list[i - 1], s) / 1000).toFixed(2)} km` : 'Start'}
                    {s.geo_source === 'interpolated' && <> · <Badge tone="delayed">approx.</Badge></>}
                  </small>
                  <input className="time" defaultValue={s.scheduled_time ?? ''} aria-label="Scheduled time" placeholder="Time" onBlur={(e) => e.target.value !== (s.scheduled_time ?? '') && patchStop(s, { scheduledTime: e.target.value }, 'Time saved.')} />
                  <button className="sq-btn" title="Move up" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><Icon name="up" size={15} /></button>
                  <button className="sq-btn" title="Move down" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === list.length - 1}><Icon name="down" size={15} /></button>
                  <button className="sq-btn danger" title="Delete stop" aria-label="Delete stop" onClick={() => deleteStop(s)}><Icon name="trash" size={14} /></button>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      </aside>
      <section className="map-wrap">
        <MapContainer center={[13.0, 80.17]} zoom={11} className={`map${adding ? ' adding' : ''}`}>
          <BaseTiles />
          <Fit stops={list} id={routeId} />
          <ClickToAdd enabled={adding} onAdd={(ll) => { setAdding(false); addAt(ll); }} />
          <Polyline positions={list.map((s) => [s.lat, s.lng])} pathOptions={{ color: '#142548', weight: 4, opacity: 0.6 }} />
          {list.map((s) => (
            <Marker
              key={`${s.id}:${s.lat}:${s.lng}`}
              position={[s.lat, s.lng]}
              icon={stopIcon(s.seq)}
              draggable
              eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); patchStop(s, { lat: ll.lat, lng: ll.lng }, `Moved ${s.name}.`); } }}
            >
              <Tooltip>{s.seq}. {s.name} · drag to move</Tooltip>
            </Marker>
          ))}
          {list.length === 0 && <CircleMarker center={[12.8737, 80.0823]} radius={6} />}
        </MapContainer>
      </section>
      {editing && <RouteForm token={token} route={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); routes.reload(); if (r?.id) setRouteId(r.id); }} />}
    </main>
  );
}
