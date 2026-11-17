import { useState } from 'react';
import { SuggestionsCard, WeeklyReportCard } from '../../components/Automations.js';
import { Button, ErrorText, Notice, PageHead, Screen, Segmented } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';

/**
 * Suggestions worked out from how the buses really ran (server/insights.js):
 * timetable fixes, crowded routes, a bus to send when one breaks down.
 * Approve or dismiss each; nothing changes before that.
 */
export default function Suggestions() {
  const { token } = useSession();
  const [status, setStatus] = useState('PENDING');
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const lookNow = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const r = await api('/api/admin/suggestions/refresh', { token, method: 'POST' });
      const found = (r.proposals ?? 0) + (r.flagged ?? 0);
      setMsg(found ? `${found} new suggestion${found === 1 ? '' : 's'}.` : 'Nothing new: the timetables and loads look fine.');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <PageHead icon="sparkle" colors={G.navy} eyebrow="Transport office" title="Suggestions" />
      <Segmented
        value={status}
        onChange={setStatus}
        full
        options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'APPLIED', label: 'Approved' }, { value: 'DISMISSED', label: 'Dismissed' }, { value: 'ALL', label: 'All' }]}
      />
      <Button title={busy ? 'Looking…' : 'Look for new ones now'} icon="refresh" variant="ghost" busy={busy} onPress={lookNow} />
      <Notice>{msg}</Notice>
      <ErrorText>{error}</ErrorText>
      <SuggestionsCard status={status} compact={false} reloadKey={reloadKey} />
      <WeeklyReportCard />
    </Screen>
  );
}
