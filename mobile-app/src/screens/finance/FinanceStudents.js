import { useState } from 'react';
import { Badge, DataList, ErrorText, ItemCard, KV, LinkButton, Notice, PageHead, Panel, Screen, SearchBox, usePrompt } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { useAction, useAsync, useRefresh } from '../../lib/hooks.js';
import { useSession } from '../../lib/session.js';
import { G } from '../../theme.js';

/** Identity and subscription status; suspend accounts that have not paid (doc 4.4). */
export default function FinanceStudents() {
  const { token } = useSession();
  const prompt = usePrompt();
  const [q, setQ] = useState('');
  const list = useAsync(() => api(`/api/finance/students${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }), [q, token]);
  const a = useAction();
  const { refreshing, onRefresh } = useRefresh(list);
  const change = async (s, action) => {
    const reason = await prompt(`${action === 'suspend' ? 'Suspend' : 'Reinstate'} ${s.username}? Reason:`);
    if (reason) a.run(() => api(`/api/finance/users/${s.id}/${action}`, { token, body: { reason } }), `${s.username}: ${action === 'suspend' ? 'suspended' : 'reinstated'}.`).then(list.reload);
  };
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHead icon="users" colors={G.navy} eyebrow="Finance office" title="Students" subtitle="Subscription status by student. Suspended accounts cannot sign in." />
      <Notice>{a.message}</Notice>
      <ErrorText>{a.error ?? list.error?.message}</ErrorText>
      <Panel title="Students and subscriptions" icon="users">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or username" />
        <DataList
          rows={list.data}
          render={(s) => (
            <ItemCard title={s.full_name} subtitle={`${s.username}${s.register_no ? ` · ${s.register_no}` : ''}${s.department ? ` · ${s.department}` : ''}`} right={<Badge tone={s.status === 'active' ? 'live' : 'danger'}>{s.status}</Badge>}>
              <KV k="Route" v={s.route_code ?? '—'} />
              <KV k="Paid until" v={s.paid_until ? date(s.paid_until) : '—'} />
              <KV k="Subscriber" v={<Badge tone={s.subscribed ? 'live' : 'offline'}>{s.subscribed ? 'Yes' : 'No'}</Badge>} />
              <KV k="Payments" v={s.payments} />
              <LinkButton danger={s.status === 'active'} title={s.status === 'active' ? 'Suspend' : 'Reinstate'} onPress={() => change(s, s.status === 'active' ? 'suspend' : 'unsuspend')} />
            </ItemCard>
          )}
        />
      </Panel>
    </Screen>
  );
}
