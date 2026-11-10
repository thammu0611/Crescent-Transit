import { useState } from 'react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../lib/session.jsx';
import { FEEDBACK_TAGS } from '../../../shared/service.js';
import Icon from './Icon.jsx';
import { ErrorText, Field, Modal } from './ui.jsx';

/** Rate one trip; a problem can go to the transport office as a complaint. */
export default function RateTrip({ trip, onClose, onDone }) {
  const { token } = useSession();
  const t = useT();
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState([]);
  const [comment, setComment] = useState('');
  const [complaint, setComplaint] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k) => setTags((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/feedback', { token, body: { tripId: trip.trip_id, rating, tags, comment, complaint } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Rate this trip')} onClose={onClose} width={460}>
      <p className="muted">{trip.fleet_code} · Route {trip.route_code}</p>
      <form onSubmit={send}>
        <div className="stars" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} out of 5`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>★</button>
          ))}
        </div>
        <div className="tag-picks">
          {FEEDBACK_TAGS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tags.includes(k)} className={tags.includes(k) ? 'on' : ''} onClick={() => toggle(k)}>{label}</button>
          ))}
        </div>
        <Field label="Anything to add?"><textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <label className="check-line">
          <input type="checkbox" checked={complaint} onChange={(e) => setComplaint(e.target.checked)} />
          <span>Raise this as a complaint so the transport office replies</span>
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" disabled={busy || !rating}><Icon name="check" size={15} /> {t('Send to the transport office')}</button>
      </form>
    </Modal>
  );
}
