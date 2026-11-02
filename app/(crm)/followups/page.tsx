import Link from 'next/link';
import { contactSaveAction } from '@/app/outreach-actions';
import { taskChangeAction } from '@/app/actions';
import { FollowUp, Notes } from '@/components/ui';
import { getSession, listLeads } from '@/lib/data';
import { listTasks } from '@/lib/data-ext';
import { todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { myFollowups } from '@/lib/outreach';

export const metadata = { title: 'My follow-ups' };
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function FollowupsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const session = (await getSession())!;
  const me = session.user.id; const today = todayIST();
  const in7 = new Date(Date.parse(today + 'T00:00:00Z') + 7 * 864e5).toISOString().slice(0, 10);
  const [fu, tasks, leads] = await Promise.all([myFollowups(me), listTasks(), listLeads()]);
  const myTasks = tasks.filter(t => t.assignee === me && (t.status === 'Open' || t.status === 'In progress')).sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')));
  const leadFu = leads.filter(l => l.assigned_to === me && l.next_followup && !['Won', 'Lost', 'Dropped', 'Banked'].includes(l.stage)).sort((a, b) => a.next_followup!.localeCompare(b.next_followup!));
  type Item = { key: string; when: string | null; kind: string; title: string; sub: string; href: string; action?: React.ReactNode };
  const items: Item[] = [
    ...fu.contacts.map(c => ({ key: 'c' + c.id, when: c.followup_on, kind: 'Contact', title: `${c.name || ''}${c.name && c.organisation ? ' · ' : ''}${c.organisation || ''}`, sub: c.next_action || c.details || c.meeting_status, href: c.event_id ? `/events/${c.event_id}?tab=contacts` : '/people',
      action: can(session, 'outreach.edit') ? <form action={contactSaveAction} className="inline"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="return" value="/followups" /><input type="hidden" name="meeting_status" value="Met" /><input type="hidden" name="followup_on" value="" /><button className="btn btn-sm">Done</button></form> : null })),
    ...fu.preLeads.map(p => ({ key: 'p' + p.id, when: p.due_on, kind: 'Pre-lead', title: p.task, sub: p.steps || p.opportunity || p.status, href: '/pre-leads' })),
    ...myTasks.map(t => ({ key: 't' + t.id, when: t.due_on, kind: 'Task', title: t.title, sub: t.lead_id ? leads.find(l => l.id === t.lead_id)?.title || '' : 'Personal', href: t.lead_id ? `/leads/${t.lead_id}?tab=tasks` : '/tasks',
      action: <form action={taskChangeAction} className="inline"><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="op" value="status" /><input type="hidden" name="status" value="Done" /><input type="hidden" name="return" value="/followups" /><button className="btn btn-sm">Done</button></form> })),
    ...leadFu.map(l => ({ key: 'l' + l.id, when: l.next_followup, kind: 'Lead', title: l.title, sub: l.next_step || l.contact_name || '', href: `/leads/${l.id}` }))
  ];
  const groups: [string, Item[]][] = [
    ['Overdue', items.filter(i => i.when && i.when < today)],
    ['Due today', items.filter(i => i.when === today)],
    ['This week', items.filter(i => i.when && i.when > today && i.when <= in7)],
    ['Later or no date', items.filter(i => !i.when || i.when > in7)]
  ];
  return (
    <>
      <div className="phead"><div><div className="eyebrow">My work</div><h1>My follow-ups</h1><p>Contacts, pre-leads, tasks and leads you own, by due date.</p></div></div>
      <Notes sp={sp} />
      {groups.map(([title, list]) => (
        <section key={title} className={`card${title === 'Overdue' && list.length ? ' warn' : ''}`}>
          <header><h2>{title}</h2><p>{list.length}</p></header>
          {list.length ? <ul className="fulist">{list.sort((a, b) => String(a.when || '9999').localeCompare(String(b.when || '9999'))).map(i => (
            <li key={i.key}><span className={`badge b-out k-${i.kind.toLowerCase().replace(/\W/g, '')}`}>{i.kind}</span><div><Link href={i.href}><b>{i.title}</b></Link><small>{i.sub}</small></div><FollowUp date={i.when} />{i.action}</li>
          ))}</ul> : <p className="muted">Nothing here.</p>}
        </section>
      ))}
    </>
  );
}
