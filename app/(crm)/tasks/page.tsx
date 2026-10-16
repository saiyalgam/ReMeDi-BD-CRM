import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { Notes, PageHead } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listTasks } from '@/lib/data-ext';
import { daysLeft, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import { TaskForm, TaskTable } from '../leads/[id]/tabs';

export const metadata = { title: 'Tasks' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = [['mine', 'My tasks'], ['available', 'Available to take'], ['team', 'Team'], ['overdue', 'Overdue'], ['done', 'Done']] as const;

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, tasks, members, leads] = await Promise.all([getSession(), listTasks(), listMembers(), listLeads()]);
  const me = session!.user.id;
  const person = typeof sp.person === 'string' ? sp.person : '';
  const view = (VIEWS.find(v => v[0] === sp.view)?.[0] || (person ? 'team' : 'mine')) as typeof VIEWS[number][0];
  const active = (t: (typeof tasks)[number]) => t.status === 'Open' || t.status === 'In progress';
  const lists = {
    mine: tasks.filter(t => t.assignee === me && active(t)),
    available: tasks.filter(t => !t.assignee && !t.personal && active(t)),
    team: tasks.filter(t => !t.personal && active(t) && (!person || t.assignee === person)),
    overdue: tasks.filter(t => active(t) && (daysLeft(t.due_on) ?? 1) < 0 && !t.personal),
    done: tasks.filter(t => t.status === 'Done' && (!person || t.assignee === person)).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 100)
  };
  const rows = [...lists[view]].sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')));
  const byId = new Map(leads.map(l => [l.id, l]));
  return (
    <>
      <PageHead eyebrow="Desk" title="Tasks" crumbs={[{ href: '/', label: 'Dashboard' }]} tools={<ExportMenu kind="tasks" params={sp} canExport={can(session, 'opp.export')} />}>
        Shared work on opportunities and your personal to-dos. Completing a task needs a short note on what was done and where the evidence is.
      </PageHead>
      <Notes sp={sp} />
      <nav className="qtabs" aria-label="Task views">
        {VIEWS.map(([k, label]) => <Link key={k} className="qtab" href={`/tasks?view=${k}${person && (k === 'team' || k === 'done') ? `&person=${person}` : ''}`} aria-current={view === k ? 'page' : undefined}>{label} <span className="n">{lists[k].length}</span></Link>)}
        {person ? <span className="chip">Person: {nameOf(members, person)}<Link href={`/tasks?view=${view}`} aria-label="Clear person filter">×</Link></span> : null}
      </nav>
      {view === 'available' && !can(session, 'tasks.claim') ? <div className="note warn">Your role cannot take available tasks (this is an open policy question). Ask a GM or leadership to assign one to you.</div> : null}
      <section className="card"><TaskTable tasks={rows} s={session!} members={members} ret={`/tasks?view=${view}`} leads={byId} /></section>
      {can(session, 'tasks.create') ? <TaskForm leadId={null} s={session!} members={members} ret="/tasks" leads={leads.filter(l => isOpen(l))} /> : null}
    </>
  );
}
