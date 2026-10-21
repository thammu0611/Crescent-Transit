import { useState } from 'react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useSession } from '../../lib/session.jsx';
import { useAction, useAsync } from '../../lib/useAsync.js';
import { Badge, ErrorText, Notice, Page, Panel, SearchBox, Table } from '../../components/ui.jsx';

/** Identity and subscription status; suspend accounts that have not paid (doc 4.4). */
export default function FinanceStudents() {
  const { token } = useSession();
  const [q, setQ] = useState('');
  const list = useAsync(() => api(`/api/finance/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }), [q, token]);
  const a = useAction();
  const change = (s, action) => {
    const reason = window.prompt(`${action === 'suspend' ? 'Suspend' : 'Reinstate'} ${s.username}? Reason:`);
    if (reason) a.run(() => api(`/api/finance/users/${s.id}/${action}`, { token, body: { reason } }), `${s.username}: ${action === 'suspend' ? 'suspended' : 'reinstated'}.`).then(list.reload);
  };
  return (
    <Page eyebrow="Finance office" title="Students" subtitle="Subscription status by student. Suspended accounts cannot sign in." wide>
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      <Panel title="Students and subscriptions" icon="users">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or username" />
        <Table
          rows={list.data}
          columns={[
            { key: 'username', label: 'Username' },
            { key: 'full_name', label: 'Student', render: (s) => <><b>{s.full_name}</b><small>{s.register_no ?? ''} · {s.department ?? ''}</small></> },
            { key: 'route_code', label: 'Route' },
            { key: 'paid_until', label: 'Paid until', render: (s) => (s.paid_until ? date(s.paid_until) : '—') },
            { key: 'subscribed', label: 'Subscriber', render: (s) => <Badge tone={s.subscribed ? 'live' : 'offline'}>{s.subscribed ? 'Yes' : 'No'}</Badge> },
            { key: 'payments', label: 'Payments', align: 'right' },
            { key: 'status', label: 'Account', render: (s) => <Badge tone={s.status === 'active' ? 'live' : 'danger'}>{s.status}</Badge> },
            { key: 'x', label: '', render: (s) => <button className={`link ${s.status === 'active' ? 'danger' : ''}`} onClick={() => change(s, s.status === 'active' ? 'suspend' : 'unsuspend')}>{s.status === 'active' ? 'Suspend' : 'Reinstate'}</button> },
          ]}
        />
      </Panel>
    </Page>
  );
}
