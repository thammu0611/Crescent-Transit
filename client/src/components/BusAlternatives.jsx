import { useCallback, useEffect, useState } from 'react';
import { api, getSocket } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import Icon from './Icon.jsx';
import { Modal } from './ui.jsx';
import { describeOption } from '../../../shared/direction.js';

const SEEN_KEY = 'ubts.alternativesSeen';
const keyOf = (a) => `${a.date}:${a.direction}`;
const busName = (fleetCode) => fleetCode.replace('BSACIST-', 'Bus ');

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

/**
 * "Another bus can take you" (server/alternatives.js). Pops up by itself when
 * the student's bus has passed, gone quiet or not started and a bus of another
 * route can still pick them up near their stop. Once closed it stays closed for
 * that run.
 */
export default function BusAlternatives() {
  const { token, user } = useSession();
  const [alert, setAlert] = useState(null);
  const [seen, setSeen] = useState(readSeen);
  const [near, setNear] = useState(null);
  const student = user?.role === 'student';

  const load = useCallback(async () => {
    if (!token || !student) return;
    try {
      setAlert(await api('/api/alternatives', { token }));
    } catch {
      // Not critical: the next check brings it.
    }
  }, [token, student]);

  useEffect(() => {
    if (!token || !student) return undefined;
    load();
    const socket = getSocket(token);
    const onAlert = (a) => {
      setAlert(a);
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Another bus can take you', { body: a.message, tag: `alternatives-${keyOf(a)}` });
        }
      } catch {
        // Notifications unsupported: the pop-up is enough.
      }
    };
    const onApproaching = (a) => {
      setNear(a);
      try {
        if ('Notification' in window && Notification.permission === 'granted') new Notification(a.title, { body: a.body, tag: `approaching-${a.tripId}` });
      } catch {
        // Notifications unsupported: the banner is enough.
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && load();
    socket.on('bus:alternatives', onAlert);
    socket.on('bus:approaching', onApproaching);
    socket.on('connect', load);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(load, 60000);
    return () => {
      socket.off('bus:alternatives', onAlert);
      socket.off('bus:approaching', onApproaching);
      socket.off('connect', load);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [token, student, load]);

  useEffect(() => {
    if (!near) return undefined;
    const id = setTimeout(() => setNear(null), 15000);
    return () => clearTimeout(id);
  }, [near]);

  const banner = near ? (
    <button type="button" className="near-banner" onClick={() => setNear(null)}>
      <Icon name="bus" size={18} />
      <span><b>{near.title}</b><small>{near.body}</small></span>
    </button>
  ) : null;
  if (!alert?.options?.length || seen === keyOf(alert)) return banner;

  const close = () => {
    setSeen(keyOf(alert));
    try {
      localStorage.setItem(SEEN_KEY, keyOf(alert));
    } catch {
      // Private window: it stays closed until the page reloads.
    }
  };
  const track = (o) => {
    try {
      sessionStorage.setItem('ubts.mapRoute', o.routeCode);
    } catch {
      // The map opens on the student's own route instead.
    }
    close();
  };

  return (
    <>
    {banner}
    <Modal title={null} onClose={close} width={440}>
      <div className="prompt">
        <p className="prompt-q">Another bus can take you</p>
        <p className="muted">{alert.message}</p>
        <div className="alt-list">
          {alert.options.map((o) => {
            const [first, second] = describeOption(o);
            return (
              <a key={o.busId} className="kit-row" href="#/map" onClick={() => track(o)}>
                <span className="route-code">{o.routeCode}</span>
                <span className="kit-row-main">
                  <b>{busName(o.fleetCode)} · {o.routeName}</b>
                  <small>{first}</small>
                  <small>{second}</small>
                </span>
                <Icon name="arrow" size={15} className="kit-chevron" />
              </a>
            );
          })}
        </div>
        <button type="button" className="btn ghost" onClick={close}>OK, got it</button>
      </div>
    </Modal>
    </>
  );
}
