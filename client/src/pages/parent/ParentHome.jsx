import YourData from '../../components/YourData.jsx';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dateTime, etaText, time } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { CHILD_STATUS_TEXT } from '../../../../shared/service.js';
import { DIRECTION_TEXT } from '../../../../shared/direction.js';
import GreetHeader from '../../components/GreetHeader.jsx';
import Icon from '../../components/Icon.jsx';
import { Avatar, ViewList } from '../../components/adminkit.jsx';
import DayBanner from '../../components/DayBanner.jsx';
import { Badge, Empty, ErrorText, Field, ListCard, Panel } from '../../components/ui.jsx';

const STATE_TONE = { NOT_YET: 'offline', ON_BOARD: 'info', REACHED: 'live', WAITING: 'delayed' };

function TripLine({ direction, trip, place }) {
  const t = useT();
  const when = trip.state === 'REACHED' ? `${t('Reached')} ${trip.reachedStop ?? place} · ${time(trip.reachedAt)}`
    : trip.boardedAt ? `${trip.fleetCode} · ${time(trip.boardedAt)}${trip.boardingStop ? ` · ${trip.boardingStop}` : ''}` : null;
  return (
    <div className="child-trip">
      <span><b>{t(DIRECTION_TEXT[direction])}</b>{when && <small>{when}</small>}</span>
      <Badge tone={STATE_TONE[trip.state]}>{t(CHILD_STATUS_TEXT[trip.state])}</Badge>
    </div>
  );
}

function ChildCard({ child }) {
  const t = useT();
  const bus = child.bus;
  const offline = bus?.freshness === 'offline';
  return (
    <section className="panel child-card">
      <div className="kit-profile-top">
        <Avatar name={child.name} size={52} />
        <div>
          <h3>{child.name}</h3>
          <p>{[child.registerNo, child.routeCode && `${t('Route')} ${child.routeCode}`, child.stopName].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className={`child-bus${bus && !offline ? ' on' : ''}`}>
        <Icon name="bus" size={20} />
        {bus ? (
          <span>
            <b>{bus.fleetCode.replace('BSACIST-', 'Bus ')} · {offline ? t('Offline') : bus.eta ? etaText(bus.eta) : t(DIRECTION_TEXT[bus.direction])}</b>
            <small>{bus.nearStop ? `${t('Near')} ${bus.nearStop}` : ''}</small>
          </span>
        ) : <span><b>{child.liveLocked ? 'Live tracking needs a subscription' : t('No bus running right now')}</b></span>}
      </div>
      <TripLine direction="UP" trip={child.inbound} place="college" />
      <TripLine direction="DOWN" trip={child.outbound} place={child.stopName ?? 'home'} />
    </section>
  );
}

/** A parent's home: each linked child's bus and today's two trips. Refreshes by itself. */
export default function ParentHome() {
  const { token, user } = useSession();
  const t = useT();
  const children = useAsync(() => api('/api/parent/children', { token }), [token]);
  const [code, setCode] = useState('');
  const a = useAction();
  useEffect(() => {
    const id = setInterval(() => children.reload(), 20000);
    return () => clearInterval(id);
  }, [children]);
  const add = (e) => {
    e.preventDefault();
    a.run(() => api('/api/parent/link', { token, body: { code } })).then((r) => { if (r) { setCode(''); children.reload(); } });
  };
  const list = children.data;
  const alerts = useAsync(() => api('/api/parent/alerts', { token }), [token]);
  return (
    <main className="page app-page">
      <GreetHeader title={t('My children')} />
      <ErrorText>{children.error?.message}</ErrorText>
      <DayBanner />
      {list == null ? <div className="skeleton-block" /> : list.length === 0 ? <Empty>No student is linked yet. Ask your child for a code from Services in their app.</Empty> : (
        <div className="kit-grid-2 top">{list.map((c) => <ChildCard key={c.id} child={c} />)}</div>
      )}
      {alerts.data?.length > 0 && (
        <Panel title={t('Recent alerts')} icon="bell">
          <div className="kit-list">
            {alerts.data.slice(0, 5).map((a) => <ListCard key={a.id} tone={a.kind === 'LATE' ? 'delayed' : 'alert'} lead={<Icon name={a.kind === 'LATE' ? 'clock' : 'alert'} size={18} />} title={a.title} lines={[a.body, dateTime(a.created_at)]} />)}
          </div>
        </Panel>
      )}
      <Panel title={t('Add a child')} icon="plus">
        <form className="form-row" onSubmit={add}>
          <Field label="Code from your child's app"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9} required autoCapitalize="characters" /></Field>
          <button className="btn primary inline" disabled={a.busy}><Icon name="plus" size={14} /> {t('Add a child')}</button>
        </form>
        <ErrorText>{a.error}</ErrorText>
      </Panel>
      <p className="fine-print">You see the bus and today's trips, never your child's phone location.</p>
      <ViewList label="Account"><YourData /></ViewList>
    </main>
  );
}
