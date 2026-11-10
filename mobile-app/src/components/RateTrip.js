import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { FEEDBACK_TAGS } from '../../../shared/service.js';
import { api } from '../lib/api.js';
import { useT } from '../lib/offline.js';
import { useSession } from '../lib/session.js';
import { C, F } from '../theme.js';
import { Button, ErrorText, Row, Sheet, Text, TextField, Txt } from './ui.js';

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
  const send = async () => {
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
    <Sheet title={t('Rate this trip')} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Txt muted small>{trip.fleet_code} · Route {trip.route_code}</Txt>
        <Row style={{ justifyContent: 'center' }} gap={6}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${n} out of 5`} onPress={() => setRating(n)} hitSlop={6}>
              <Text style={{ fontSize: 36, color: n <= rating ? C.gold : C.navy100 }}>★</Text>
            </Pressable>
          ))}
        </Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FEEDBACK_TAGS.map(([k, label]) => {
            const on = tags.includes(k);
            return (
              <Pressable key={k} accessibilityRole="button" onPress={() => toggle(k)} style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? C.navyFill : C.line, backgroundColor: on ? C.navyFill : C.paper }}>
                <Text style={{ color: on ? '#fff' : C.ink, ...F[600], fontSize: 13 }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextField label="Anything to add?" value={comment} onChangeText={setComment} multiline maxLength={500} />
        <Row>
          <Txt small style={{ flex: 1 }}>Raise this as a complaint so the transport office replies</Txt>
          <Switch value={complaint} onValueChange={setComplaint} />
        </Row>
        <ErrorText>{error}</ErrorText>
        <Button title={t('Send to the transport office')} icon="check" busy={busy} disabled={!rating} onPress={send} />
      </View>
    </Sheet>
  );
}
