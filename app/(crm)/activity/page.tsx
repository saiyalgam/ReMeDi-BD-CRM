import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { Avatar, Badge, Empty, PageHead, Who } from '@/components/ui';
import { getSession, listActivity, listLeads, listMembers } from '@/lib/data';
import { listAudit, listTasks } from '@/lib/data-ext';
import { daysLeft, fmtDate, fmtDateTime, nameOf, todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import { LEAD_TYPES, ORG_ROLES, SLUG_OF, TYPE_LABEL, TYPE_SLUGS, type Activity } from '@/lib/types';

export const metadata = { title: 'Team activity' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
const GROUPS: Record<string, Activity['action'][]> = {
  reviews: ['verified', 'eligibility', 'requirement', 'risk', 'score'],
  decisions: ['decision', 'recommendation', 'approval'],
  assignments: ['assigned'],
  prep: ['pursuit', 'document', 'request', 'task', 'partner', 'meeting'],
  deadlines: ['deadline'],
  notes: ['comment']
};
const GROUP_LABEL: Record<string, string> = { reviews: 'Reviews & assessments', decisions: 'Decisions', assignments: 'Assignment changes', prep: 'Preparation', deadlines: 'Deadlines', notes: 'Notes' };

export default async function ActivityPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, members, leads, activity, tasks, audit] = await Promise.all([getSession(), listMembers(), listLeads(), listActivity(2000), listTasks(), listAudit()]);
  const person = one(sp.person), role = one(sp.role), type = TYPE_SLUGS[one(sp.type)], group = one(sp.group), lead = Number(one(sp.lead)) || null;
  const days = Number(one(sp.days)) || 7;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const byId = new Map(leads.map(l => [l.id, l]));
  const roleIds = new Set(members.filter(m => !role || m.org_role === role).map(m => m.id));
  const rows = activity.filter(a => a.created_at >= since
    && (!person || a.actor === person) && (!role || (a.actor && roleIds.has(a.actor)))
    && (!type || byId.get(a.lead_id)?.lead_type === type) && (!group || (GROUPS[group] || []).includes(a.action)) && (!lead || a.lead_id === lead));
  const periodLabel = days === 1 ? 'today' : `last ${days} days`;

  const people = members.filter(m => (!role || m.org_role === role) && (!person || m.id === person)).map(m => {
    const mine = activity.filter(a => a.actor === m.id && a.created_at >= since && (!type || byId.get(a.lead_id)?.lead_type === type));
    const assessed = new Set(mine.filter(a => ['eligibility', 'requirement', 'risk', 'score'].includes(a.action)).map(a => a.lead_id)).size;
    const myTasks = tasks.filter(t => t.assignee === m.id && !t.personal);
    return {
      m,
      reviews: mine.filter(a => GROUPS.reviews!.includes(a.action)).length,
      assessed,
      bids: leads.filter(l => l.assigned_to === m.id && ['Partnering', 'In preparation'].includes(l.stage) && isOpen(l)).length,
      submitted: leads.filter(l => l.assigned_to === m.id && l.applied_on && l.applied_on >= since.slice(0, 10)).length,
      tasksDone: myTasks.filter(t => t.status === 'Done' && t.done_at && t.done_at >= since).length,
      overdue: myTasks.filter(t => (t.status === 'Open' || t.status === 'In progress') && (daysLeft(t.due_on) ?? 1) < 0).length,
      actions: mine.length
    };
  });
  const totals = people.reduce((a, p) => ({ reviews: a.reviews + p.reviews, assessed: a.assessed + p.assessed, bids: a.bids + p.bids, submitted: a.submitted + p.submitted, overdue: a.overdue + p.overdue }), { reviews: 0, assessed: 0, bids: 0, submitted: 0, overdue: 0 });
  const q = (patch: Record<string, string>) => { const p = new URLSearchParams(Object.fromEntries(Object.entries({ person, role, type: type ? SLUG_OF[type] : '', group, days: String(days), lead: lead ? String(lead) : '', ...patch }).filter(([, v]) => v))); return `/activity?${p}`; };

  return (
    <>
      <PageHead eyebrow="Insight" title="Team activity" crumbs={[{ href: '/', label: 'Dashboard' }]} tools={<ExportMenu kind="activity" params={sp} canExport={can(session, 'opp.export')} />}>
        Who did what and when. Counts describe workload and completed work — they are not a ranking.
      </PageHead>
      <form method="get" className="filters" aria-label="Filters">
        <select name="person" defaultValue={person} aria-label="Person"><option value="">Everyone</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select>
        <select name="role" defaultValue={role} aria-label="Role"><option value="">All roles</option>{ORG_ROLES.map(r => <option key={r}>{r}</option>)}</select>
        <select name="type" defaultValue={type ? SLUG_OF[type] : ''} aria-label="Opportunity type"><option value="">All types</option>{LEAD_TYPES.map(t => <option key={t} value={SLUG_OF[t]}>{TYPE_LABEL[t]}</option>)}</select>
        <select name="group" defaultValue={group} aria-label="Kind of action"><option value="">All actions</option>{Object.entries(GROUP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="days" defaultValue={String(days)} aria-label="Period"><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
        {lead ? <input type="hidden" name="lead" value={lead} /> : null}
        <button className="btn btn-primary" type="submit">Apply</button><Link className="btn" href="/activity">Clear</Link>
      </form>
      {person || lead ? <div className="chiprow">{person ? <span className="chip">Person: {nameOf(members, person)}<Link href={q({ person: '' })} aria-label="Clear person">×</Link></span> : null}{lead ? <span className="chip">Opportunity: {byId.get(lead)?.ref_code}<Link href={q({ lead: '' })} aria-label="Clear opportunity">×</Link></span> : null}</div> : null}

      <div className="stats">
        <div className="stat"><small>Reviews completed ({periodLabel})</small><b>{totals.reviews}</b></div>
        <div className="stat"><small>Opportunities assessed</small><b>{totals.assessed}</b></div>
        <div className="stat"><small>Bids in preparation (now)</small><b>{totals.bids}</b></div>
        <div className="stat"><small>Submissions made</small><b>{totals.submitted}</b></div>
        <Link className="stat" href="/tasks?view=overdue" style={{ textDecoration: 'none', color: 'inherit' }}><small>Overdue tasks (now)</small><b style={{ color: totals.overdue ? 'var(--critical-text)' : undefined }}>{totals.overdue}</b></Link>
      </div>

      <section className="card" aria-labelledby="pp-h">
        <header><div><h2 id="pp-h">By person · {periodLabel}</h2><p>Select a person to filter the activity history.</p></div></header>
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Person</th><th className="r">Actions</th><th className="r">Reviews</th><th className="r">Assessed</th><th className="r">Bids in prep.</th><th className="r">Submitted</th><th className="r">Tasks done</th><th className="r">Overdue tasks</th></tr></thead>
          <tbody>{people.map(p => (
            <tr key={p.m.id} className={person === p.m.id ? 'sel' : ''}>
              <td><Link href={q({ person: p.m.id })} style={{ color: 'inherit', textDecoration: 'none' }}><Who name={p.m.full_name || p.m.email} /></Link> <span className="muted" style={{ fontSize: 12 }}>{p.m.org_role}</span></td>
              <td className="r">{p.actions}</td><td className="r">{p.reviews}</td><td className="r">{p.assessed}</td><td className="r">{p.bids}</td><td className="r">{p.submitted}</td><td className="r">{p.tasksDone}</td>
              <td className="r">{p.overdue ? <Link href={`/tasks?view=overdue`} className="badge b-bad">{p.overdue}</Link> : <span className="muted">0</span>}</td>
            </tr>))}</tbody>
        </table></div>
      </section>

      <section className="card" aria-labelledby="hist-h">
        <header><div><h2 id="hist-h">History</h2><p>{rows.length} action(s). Each entry opens the opportunity it refers to.</p></div></header>
        {rows.length ? (
          <ul className="feed">
            {rows.slice(0, 300).map(a => {
              const l = byId.get(a.lead_id); const who = a.actor ? nameOf(members, a.actor) : 'Crawler / import';
              return (
                <li key={a.id}>
                  <Avatar name={who} />
                  <span style={{ minWidth: 0 }}>
                    {a.actor ? <Link href={q({ person: a.actor })} style={{ fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>{who}</Link> : <b>{who}</b>} <Badge tone="out">{a.action}</Badge>{' '}
                    {l ? <><Link className="rf" href={`/leads/${l.id}?tab=activity`}>{l.ref_code}</Link> <Link href={q({ lead: String(l.id) })} className="muted" style={{ fontSize: 12.5 }}>{l.title.slice(0, 80)}</Link></> : null}
                    {a.detail ? <div className="muted" style={{ fontSize: 12.5, whiteSpace: a.action === 'comment' ? 'pre-wrap' : undefined }}>{a.detail.slice(0, 220)}</div> : null}
                  </span>
                  <span className="when">{fmtDateTime(a.created_at)}</span>
                </li>
              );
            })}
          </ul>
        ) : <Empty title={`No activity ${periodLabel}`}>Try a longer period or clear the filters.</Empty>}
      </section>

      {can(session, 'audit.read') ? (
        <section className="card" aria-labelledby="au-h">
          <header><div><h2 id="au-h">Audit log (partners, evidence, permissions, tasks)</h2><p>Changes outside opportunity history. Visible to roles with audit access.</p></div></header>
          {audit.length ? <div className="tbl-wrap"><table className="tbl plain"><thead><tr><th>When</th><th>Who</th><th>Record</th><th>Change</th></tr></thead>
            <tbody>{audit.slice(0, 60).map(a => <tr key={a.id}><td className="mono-sm">{fmtDateTime(a.created_at)}</td><td>{a.actor ? nameOf(members, a.actor) : 'System'}</td><td className="mono-sm">{a.table_name} · {a.row_id}</td><td>{a.op}{a.changed?.length ? `: ${a.changed.join(', ')}` : ''}</td></tr>)}</tbody></table></div>
            : <Empty title="No audited changes yet" />}
        </section>
      ) : null}
      <p className="legal">Period starts {fmtDate(since.slice(0, 10))}; today is {fmtDate(todayIST())}.</p>
    </>
  );
}
