import { useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, TextInput, useWindowDimensions, View } from 'react-native';
import Icon from '../../components/Icon.js';
import { ll, MapBox, Marker, Polyline } from '../../components/maps';
import {
  Badge, Button, confirm, ErrorText, Notice, Panel, Row, Screen, Select, Sheet, Text, TextField, Txt, usePrompt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAction, useAsync } from '../../lib/hooks.js';
import { haversineMeters } from '../../lib/rules.js';
import { useSession } from '../../lib/session.js';
import { C, F } from '../../theme.js';

function RouteForm({ token, route, onClose, onSaved }) {
  const [f, setF] = useState({ code: route?.code ?? '', name: route?.name ?? '', startPoint: route?.start_point ?? '', endPoint: route?.end_point ?? 'BSACIST', departureTime: route?.departure_time ?? '', description: route?.description ?? '', active: route?.active ?? true });
  const a = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!f.code.trim() || !f.name.trim()) return a.setError('Code and name are required.');
    a.run(() => api(route ? `/api/admin/routes/${route.id}` : '/api/admin/routes', { token, method: route ? 'PATCH' : 'POST', body: f })).then((r) => r && onSaved(r));
  };
  return (
    <Sheet title={route ? `Edit route ${route.code}` : 'New route'} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <TextField label="Code" value={f.code} onChangeText={set('code')} autoCapitalize="characters" />
        <TextField label="Name" value={f.name} onChangeText={set('name')} />
        <TextField label="Starts at" value={f.startPoint} onChangeText={set('startPoint')} />
        <TextField label="Ends at" value={f.endPoint} onChangeText={set('endPoint')} />
        <TextField label="Morning departure" value={f.departureTime} onChangeText={set('departureTime')} placeholder="6.45 AM" />
        <TextField label="Description" value={f.description} onChangeText={set('description')} />
        <Row><Switch value={f.active} onValueChange={set('active')} /><Txt>Active (shown to students)</Txt></Row>
        <ErrorText>{a.error}</ErrorText>
        <Button title="Save" busy={a.busy} onPress={save} />
      </View>
    </Sheet>
  );
}

function StopPin({ stop, onMoved }) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => { const id = setTimeout(() => setTracks(false), 600); return () => clearTimeout(id); }, [stop.seq]);
  return (
    <Marker
      coordinate={ll(stop)}
      anchor={{ x: 0.5, y: 0.5 }}
      draggable
      tracksViewChanges={tracks}
      title={`${stop.seq}. ${stop.name}`}
      description="Long-press and drag to move"
      onDragEnd={(e) => onMoved({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
    >
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.navy, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 11, ...F[800] }}>{stop.seq}</Text>
      </View>
    </Marker>
  );
}

const SqBtn = ({ icon, onPress, disabled, danger, label }) => (
  <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} hitSlop={4} style={{ width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: danger ? C.danger50 : C.line, backgroundColor: danger ? C.danger50 : '#fff', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
    <Icon name={icon} size={15} color={danger ? C.danger : C.navy} />
  </Pressable>
);

/** Route builder (doc B.8): long-press the map to place a stop, drag to move, reorder, segment distances. */
export default function RoutesAdmin() {
  const { token } = useSession();
  const prompt = usePrompt();
  const { height } = useWindowDimensions();
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
    if (!adding) return;
    setAdding(false);
    const name = await prompt('Name of the new stop?');
    if (!name) return;
    const r = await a.run(() => api(`/api/admin/routes/${routeId}/stops`, { token, body: { name, lat: latlng.lat, lng: latlng.lng } }), `Added ${name}.`);
    if (r) after();
  };
  const move = async (index, delta) => {
    const ids = list.map((st) => st.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    if (await a.run(() => api(`/api/admin/routes/${routeId}/stops/order`, { token, method: 'PUT', body: { stopIds: ids } }))) after();
  };
  const patchStop = async (st, body, msg) => {
    if (await a.run(() => api(`/api/admin/stops/${st.id}`, { token, method: 'PATCH', body }), msg)) after();
  };
  const deleteStop = async (st) => {
    if (!(await confirm(`Delete stop ${st.name}?`, '', 'Delete', true))) return;
    if (await a.run(() => api(`/api/admin/stops/${st.id}`, { token, method: 'DELETE' }), `Deleted ${st.name}.`)) after();
  };
  const totalKm = list.reduce((sum, st, i) => (i ? sum + haversineMeters(list[i - 1], st) : 0), 0) / 1000;

  return (
    <Screen>
      <View style={{ height: Math.round(height * 0.38), borderRadius: 18, overflow: 'hidden', borderWidth: adding ? 3 : 0, borderColor: C.gold }}>
        <MapBox fitPoints={list} fitKey={`${routeId}:${list.length > 0}`} onLongPress={addAt}>
          <Polyline coordinates={list.map(ll)} strokeColor="rgba(15,30,60,0.6)" strokeWidth={4} />
          {list.map((st) => <StopPin key={`${st.id}:${st.lat}:${st.lng}:${st.seq}`} stop={st} onMoved={(p) => patchStop(st, p, `Moved ${st.name}.`)} />)}
        </MapBox>
        {adding && (
          <View style={{ position: 'absolute', top: 8, left: 8, right: 8, backgroundColor: C.gold, padding: 8, borderRadius: 10 }}>
            <Text style={{ ...F[700], color: C.ink, textAlign: 'center' }}>Long-press the map where the new stop is</Text>
          </View>
        )}
      </View>

      <Panel title="Routes" icon="route" actions={<Button small variant="ghost" icon="plus" title="New route" onPress={() => setEditing('new')} />}>
        <Select
          label="Route"
          value={routeId ?? ''}
          onChange={(v) => setRouteId(Number(v))}
          options={(routes.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}${r.active ? '' : ' (inactive)'}` }))}
        />
        {route && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[['pin', `${route.stop_count} stops`], ['route', `${totalKm.toFixed(1)} km`], ['bus', route.buses ?? 'No bus'], ['users', `${route.students} students`], ['clock', `${route.segments_learned} learned ETA segments`]].map(([icon, text]) => (
                <Row key={icon} gap={4} style={{ backgroundColor: C.navy50, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 }}>
                  <Icon name={icon} size={13} color={C.navy} /><Txt small bold>{text}</Txt>
                </Row>
              ))}
              {!route.active && <Badge tone="danger">Inactive</Badge>}
            </View>
            <Button small variant="ghost" icon="edit" title="Edit route details" onPress={() => setEditing(route)} />
          </>
        )}
      </Panel>

      <Panel title="Stops in order" icon="pin" actions={<Button small variant={adding ? 'red' : 'ghost'} icon={adding ? 'x' : 'plus'} title={adding ? 'Cancel' : 'Add on map'} onPress={() => setAdding((x) => !x)} />}>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error ?? stops.error?.message}</ErrorText>
        {list.map((st, i) => (
          <View key={st.id} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line2 }}>
            <Row>
              <Text style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.navy, color: '#fff', textAlign: 'center', lineHeight: 26, ...F[800], fontSize: 12, overflow: 'hidden' }}>{st.seq}</Text>
              <TextInput
                defaultValue={st.name}
                accessibilityLabel={`Name of stop ${st.seq}`}
                onEndEditing={(e) => e.nativeEvent.text !== st.name && e.nativeEvent.text.trim() && patchStop(st, { name: e.nativeEvent.text.trim() }, 'Renamed.')}
                style={{ flex: 1, fontSize: 15, color: C.ink, borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 4 }}
              />
            </Row>
            <Row>
              <Txt small muted style={{ flex: 1 }}>
                {i > 0 ? `+${(haversineMeters(list[i - 1], st) / 1000).toFixed(2)} km` : 'Start'}{st.geo_source === 'interpolated' ? ' · approx.' : ''}
              </Txt>
              <TextInput
                defaultValue={st.scheduled_time ?? ''}
                placeholder="Time"
                accessibilityLabel="Scheduled time"
                onEndEditing={(e) => e.nativeEvent.text !== (st.scheduled_time ?? '') && patchStop(st, { scheduledTime: e.nativeEvent.text }, 'Time saved.')}
                style={{ width: 84, fontSize: 13, color: C.ink, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 }}
              />
              <SqBtn icon="up" label="Move up" onPress={() => move(i, -1)} disabled={i === 0} />
              <SqBtn icon="down" label="Move down" onPress={() => move(i, 1)} disabled={i === list.length - 1} />
              <SqBtn icon="trash" label="Delete stop" danger onPress={() => deleteStop(st)} />
            </Row>
          </View>
        ))}
      </Panel>
      {editing && <RouteForm token={token} route={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); routes.reload(); if (r?.id) setRouteId(r.id); }} />}
    </Screen>
  );
}
