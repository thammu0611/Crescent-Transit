import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../lib/session.jsx';
import Icon from '../../components/Icon.jsx';
import { SuggestionsBlock, WeeklyReportBlock } from '../../components/Automations.jsx';
import { ErrorText, Notice, Page, Segmented } from '../../components/ui.jsx';

/**
 * Suggestions worked out from how the buses really ran (server/insights.js):
 * a corrected timetable, a route that keeps running full, a bus to send when one
 * breaks down. Each is approved or dismissed here; nothing changes before that.
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
    <Page
      eyebrow="Transport office"
      title="Suggestions"
      subtitle="Timetable fixes, crowded routes and replacement buses, worked out from how the buses really ran. Nothing changes until you approve."
      actions={<button className="btn ghost inline" disabled={busy} onClick={lookNow}><Icon name="sparkle" size={14} />{busy ? 'Looking…' : 'Look now'}</button>}
      wide
    >
      <Segmented
        value={status}
        onChange={setStatus}
        options={[{ value: 'PENDING', label: 'Waiting' }, { value: 'APPLIED', label: 'Approved' }, { value: 'DISMISSED', label: 'Dismissed' }, { value: 'ALL', label: 'All' }]}
      />
      <Notice>{msg}</Notice>
      <ErrorText>{error}</ErrorText>
      <SuggestionsBlock status={status} compact={false} reloadKey={reloadKey} />
      <WeeklyReportBlock />
    </Page>
  );
}
