import { useState } from 'react';
import { Linking } from 'react-native';
import {
  Badge, Button, DataList, ErrorText, FoldCard, ItemCard, LinkButton, Notice, PageHead, Panel, Row, Screen, Segmented,
  Select, TextField, Txt, usePrompt,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';

const URGENT = ['SOS', 'EMERGENCY', 'BREAKDOWN', 'CAPACITY_BREACH'];
const LATEST = 5;
const updatedAt = (i) => i.resolved_at ?? i.created_at;

/** Announcements to all or one route, and the incident log (doc 4.1). */
export default function Notices() {
  const { token } = useSession();
  const prompt = usePrompt();
  const routes = useAsync(() => api('/api/routes'), []);
  const [status, setStatus] = useState('OPEN');
  const incidents = useAsync(() => api(`/api/admin/incidents${status ? `?status=${status}` : ''}`, { token }), [status, token]);
  const [showAll, setShowAll] = useState(false);
  const [f, setF] = useState({ kind: 'ANNOUNCEMENT', routeCode: '', title: '', message: '' });
  // Most recently updated first (a resolution counts as an update).
  const sorted = incidents.data ? [...incidents.data].sort((x, y) => new Date(updatedAt(y)) - new Date(updatedAt(x))) : null;
  const rows = sorted && !showAll ? sorted.slice(0, LATEST) : sorted;
  const a = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const { refreshing, onRefresh } = useRefresh(incidents);

  const resolve = async (i) => {
    const resolution = await prompt('How was it resolved?', 'Resolved');
    if (resolution) a.run(() => api(`/api/admin/incidents/${i.id}/resolve`, { token, body: { resolution } })).then(incidents.reload);
  };

  const send = () => {
    if (!f.title.trim() || !f.message.trim()) return a.setError('Title and message are required.');
    a.run(() => api('/api/notifications', { token, body: { ...f, routeCode: f.routeCode || undefined } }), 'Sent.')
      .then((r) => r !== undefined && setF((x) => ({ ...x, title: '', message: '' })));
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="bell" colors={G.navy} eyebrow="Transport office" title="Alerts and incidents" />
      <Panel title="Send an announcement" icon="bell">
        <Select
          label="Kind"
          value={f.kind}
          onChange={set('kind')}
          options={[
            { value: 'ANNOUNCEMENT', label: 'Announcement' }, { value: 'ROUTE_CHANGE', label: 'Route change' }, { value: 'DELAY', label: 'Delay' },
            { value: 'BREAKDOWN', label: 'Breakdown' }, { value: 'EMERGENCY', label: 'Emergency' },
          ]}
        />
        <Select
          label="To"
          value={f.routeCode}
          onChange={set('routeCode')}
          options={[{ value: '', label: 'Everyone (notice board)' }, ...(routes.data ?? []).map((r) => ({ value: r.code, label: `Route ${r.code} · ${r.name}` }))]}
        />
        <TextField label="Title" value={f.title} onChangeText={set('title')} maxLength={150} />
        <TextField label="Message" value={f.message} onChangeText={set('message')} multiline />
        <Button title="Send" busy={a.busy} onPress={send} />
        <Txt muted small>Network-wide notices are on the free notice board. Route alerts go to that route's subscribers.</Txt>
        <Notice>{a.message}</Notice>
        <ErrorText>{a.error}</ErrorText>
      </Panel>
      <FoldCard
        icon="alert"
        title="Incidents"
        initiallyOpen
        summary={sorted == null ? 'Loading…' : sorted.length === 0 ? 'Nothing here' : showAll || sorted.length <= LATEST ? `${sorted.length} incident${sorted.length === 1 ? '' : 's'}` : `${LATEST} most recently updated of ${sorted.length}`}
        badge={sorted?.length ? <Badge tone={status === 'OPEN' ? 'danger' : 'offline'}>{sorted.length}</Badge> : null}
      >
        <Segmented value={status} onChange={(v) => { setStatus(v); setShowAll(false); }} options={[{ value: 'OPEN', label: 'Open' }, { value: 'RESOLVED', label: 'Resolved' }, { value: '', label: 'All' }]} />
        <ErrorText>{incidents.error?.message}</ErrorText>
        <DataList
          rows={rows}
          empty={status === 'OPEN' ? 'No open incidents.' : 'No incidents.'}
          render={(i) => (
            <ItemCard
              title={i.fleet_code ?? (i.route_code ? `Route ${i.route_code}` : 'Network')}
              subtitle={`${dateTime(updatedAt(i))}${i.resolved_at ? ' (resolved)' : ''} · ${i.source}${i.username ? ` · ${i.username}` : ''}`}
              tone={URGENT.includes(i.kind) ? 'danger' : i.status === 'OPEN' ? 'delayed' : 'offline'}
              right={<Badge tone={URGENT.includes(i.kind) ? 'danger' : 'delayed'}>{i.kind.replaceAll('_', ' ')}</Badge>}
            >
              <Txt small>{i.message ?? '—'}</Txt>
              <Row gap={16}>
                {i.lat != null && <LinkButton icon="map" title="Map" onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lng}#map=16/${i.lat}/${i.lng}`)} />}
                {i.status === 'OPEN' ? <LinkButton title="Resolve" onPress={() => resolve(i)} /> : <Txt small muted>{i.resolution}</Txt>}
              </Row>
            </ItemCard>
          )}
        />
        {sorted && sorted.length > LATEST ? (
          <Button small variant="ghost" title={showAll ? `Show the ${LATEST} most recent` : `Show all ${sorted.length}`} onPress={() => setShowAll((x) => !x)} />
        ) : null}
      </FoldCard>
    </Screen>
  );
}
