import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/useAsync.js';
import { useSession } from '../../lib/session.jsx';
import { Badge, ErrorText, Field, Notice, Panel, Segmented } from '../../components/ui.jsx';

const STUDENT_SAMPLE = 'register_no,full_name,email,department,route,stop,graduation_year\n250282601112,Asha Ram,250282601112@crescent.education,MCA,118,Ram Nagar,2027\n';
const ROUTE_SAMPLE = 'route,route_name,stop_name,time,lat,lng\n118,Velachery,Velachery Vijaya Nagar,6.20 AM,12.9756,80.2212\n118,Velachery,BSACIST,8.30 AM,12.8737,80.0823\n';

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Pick a CSV, see what would change, then confirm. */
function Upload({ title, icon, summary, help, sample, sampleName, path, extra, renderPreview, token }) {
  const [csv, setCsv] = useState(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (commit, text = csv) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api(path, { token, body: { csv: text, commit, ...extra } });
      if (commit) {
        setDone(r);
        setPreview(null);
        setCsv(null);
        setName('');
      } else setPreview(r);
    } catch (err) {
      setError(err.body?.problems?.length ? `${err.message}: ${err.body.problems[0].problem} (line ${err.body.problems[0].line})` : err.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setName(file.name);
    setDone(null);
    await send(false, text);
  };

  return (
    <Panel title={title} icon={icon} summary={summary}>
      <p className="muted">{help}</p>
      <div className="btn-row">
        <label className="btn ghost">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" onChange={pick} hidden />
        </label>
        <button type="button" className="btn ghost" onClick={() => downloadText(sampleName, sample)}>Download a sample</button>
      </div>
      {name && <p className="muted">{name}</p>}
      <ErrorText>{error}</ErrorText>
      {preview && (
        <>
          {renderPreview(preview)}
          <button type="button" className="btn primary" disabled={busy || preview.problems?.length > 0} onClick={() => send(true)}>
            {busy ? 'Please wait…' : 'Confirm and apply'}
          </button>
        </>
      )}
      {done && <Notice>Done. The changes are saved and recorded in the audit log.</Notice>}
    </Panel>
  );
}

const Issues = ({ rows }) => (rows.length ? (
  <ul className="health-list">
    {rows.slice(0, 30).map((r, i) => (
      <li key={`${r.line}-${i}`}>
        <Badge tone={r.problems?.length || r.problem ? 'danger' : 'delayed'}>Line {r.line}</Badge>
        {' '}{r.name ? `${r.name}: ` : ''}{[...(r.problems ?? []), ...(r.warnings ?? []), r.problem].filter(Boolean).join('; ')}
      </li>
    ))}
    {rows.length > 30 && <li className="muted">…and {rows.length - 30} more</li>}
  </ul>
) : null);

function EndOfYear({ token }) {
  const thisYear = new Date().getFullYear();
  const summary = useAsync(() => api('/api/admin/roster/summary', { token }), [token]);
  const [year, setYear] = useState(String(thisYear));
  const [action, setAction] = useState('deactivate');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async (commit) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/api/admin/roster/rollover', { token, body: { graduationYear: Number(year), action, commit } });
      if (commit) {
        setDone(r);
        setPreview(null);
        summary.reload?.();
      } else {
        setDone(null);
        setPreview(r);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="End of the year" icon="clock" summary="Those who have finished">
      <p className="muted">Students with a graduation year come from the student list. Without one, they are left alone.</p>
      {summary.data?.length > 0 && (
        <ul className="health-list">
          {summary.data.map((r) => <li key={`${r.graduation_year}-${r.status}`}><b>{r.graduation_year ?? 'No year'}</b> · {r.status} · {r.n}</li>)}
        </ul>
      )}
      <Field label="Finishing in or before"><input type="number" value={year} min="2000" max="2100" onChange={(e) => { setYear(e.target.value); setPreview(null); }} /></Field>
      <Segmented
        value={action}
        onChange={(v) => { setAction(v); setPreview(null); }}
        options={[{ value: 'deactivate', label: 'Stop sign-in, keep records' }, { value: 'delete', label: 'Remove personal data' }]}
      />
      <ErrorText>{error}</ErrorText>
      {!preview && <button type="button" className="btn ghost" disabled={busy} onClick={() => send(false)}>Check how many</button>}
      {preview && (
        <>
          <Notice>{`${preview.students} student${preview.students === 1 ? '' : 's'} will be ${action === 'delete' ? 'removed for good' : 'stopped from signing in'}.`}</Notice>
          <button type="button" className="btn danger" disabled={busy || !preview.students} onClick={() => send(true)}>Confirm</button>
        </>
      )}
      {done && <Notice>{`Done: ${done.students} student${done.students === 1 ? '' : 's'}.`}</Notice>}
    </Panel>
  );
}

/** The transport office's yearly work, in one place. */
export default function Roster() {
  const { token } = useSession();
  const [retire, setRetire] = useState(false);
  return (
    <div className="kit-stack">
      <Upload
        token={token}
        title="Student list"
        icon="users"
        summary="Upload the year's students"
        help="Students already known are updated. New students sign in with Forgot password on their university email, so nobody has to share a password."
        sample={STUDENT_SAMPLE}
        sampleName="students-sample.csv"
        path="/api/admin/roster/students"
        renderPreview={(p) => (
          <>
            <Notice>{`${p.summary.create} new, ${p.summary.update} to update, ${p.summary.skip} with problems (left out).`}</Notice>
            <Issues rows={p.issues} />
          </>
        )}
      />
      <Upload
        token={token}
        title="Route circular"
        icon="route"
        summary="Load next year's routes"
        help="One row per stop, in travel order. A stop that keeps its name keeps its students. Load this when no bus is running."
        sample={ROUTE_SAMPLE}
        sampleName="routes-sample.csv"
        path="/api/admin/roster/routes"
        extra={{ retireMissing: retire }}
        renderPreview={(p) => (
          <>
            <Notice>{`${p.summary.routes} routes in the file, ${p.summary.new} new, ${p.summary.notInFile} not in the file.`}</Notice>
            <ul className="health-list">
              {p.changes.filter((c) => c.added || c.removed || c.studentsToReassign || c.action === 'new').slice(0, 30).map((c) => (
                <li key={c.code}><b>{c.code}</b> · {c.action === 'new' ? 'new route' : `${c.added} stops added, ${c.removed} removed`}{c.studentsToReassign ? ` · ${c.studentsToReassign} students must choose a new stop` : ''}</li>
              ))}
            </ul>
            <Issues rows={p.problems} />
            {p.missing.length > 0 && (
              <label className="check-row">
                <input type="checkbox" checked={retire} onChange={(e) => setRetire(e.target.checked)} />
                {` Retire the ${p.missing.length} routes not in this file`}
              </label>
            )}
          </>
        )}
      />
      <EndOfYear token={token} />
    </div>
  );
}
