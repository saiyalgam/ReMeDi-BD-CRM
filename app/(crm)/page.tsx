import Link from 'next/link';
import { can } from '@/lib/perm';
import { ExportMenu } from '@/components/Export';
import { Avatar, DecisionPill, Due, Empty, FollowUp, Ref, TypeTag, Who } from '@/components/ui';
import { getSession, lastIngest, listActivity, listLeads, listMembers } from '@/lib/data';
import { listDeadlines, listDocs, listRelationships, listRequirements, listTasks } from '@/lib/data-ext';
import { ago, daysLeft, fmtDate, fmtDateTime, nameOf, todayIST } from '@/lib/format';
import { dashboard, overview } from '@/lib/views';
import type { Activity } from '@/lib/types';

export const metadata = { title: 'Dashboard' };

const ACT: Record<string, string> = {
  comment: 'added a note on', created: 'added', verified: 'checked', assigned: 'changed the owner of', stage: 'moved', decision: 'decided on',
  edited: 'edited', pursuit: 'updated the proposal on', updated: 'refreshed', eligibility: 'assessed eligibility of', recommendation: 'recommended a decision on',
  approval: 'reviewed the decision on', requirement: 'updated a requirement on', risk: 'assessed risk on', score: 'scored', deadline: 'recorded a deadline on',
  document: 'updated documents on', request: 'drafted a document request on', task: 'updated a task on', partner: 'updated partners on', merge: 'merged', meeting: 'prepared a meeting on'
};

export default async function Dashboard() {
  const [session, leads, members, run, tasks, deadlines, docs, reqs, activity, rels] = await Promise.all([
    getSession(), listLeads(), listMembers(), lastIngest(), listTasks(), listDeadlines(), listDocs(), listRequirements(), listActivity(60), listRelationships()
  ]);
  const d = dashboard(leads, members, tasks, deadlines, docs, reqs, activity);
  const o = overview(leads);
  const byId = new Map(leads.map(l => [l.id, l]));
  const firstName = (session?.user.full_name || '').split(' ')[0];
  const hour = new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const maxFunnel = Math.max(1, ...d.funnel.map(f => f.n));
  const maxWeek = Math.max(1, ...d.weeks.map(w => w.count));
  const myRels = rels.filter(r => r.owner === session?.user.id && r.status !== 'Closed')
    .sort((a, b) => String(a.next_followup || '9999').localeCompare(String(b.next_followup || '9999'))).slice(0, 5);
  const needYou = d.attention.filter(a => a.lead.approval_status === 'Pending').length;

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">{fmtDate(todayIST())}</div>
          <h1>{greet}{firstName ? `, ${firstName}` : ''}.</h1>
          <p>{d.attention.length ? <>{d.attention.length} {d.attention.length === 1 ? 'opportunity needs' : 'opportunities need'} attention{needYou ? <>, {needYou} waiting for an approval decision</> : null}.</> : 'Nothing urgent needs a decision right now.'}
            {' '}{run ? <>Last crawler delivery {ago(run.run_at)} ({run.inserted} new{run.updated ? `, ${run.updated} updated` : ''}).</> : 'The crawler has not sent any leads yet.'}</p>
        </div>
        <div className="inline">
          <ExportMenu kind="pipeline" params={{ show: 'open' }} canExport={can(session, 'opp.export')} label="Export / print" />
          <Link className="btn" href="/review">Open review queue</Link>
          <Link className="btn btn-primary" href="/leads/new">+ Add opportunity</Link>
        </div>
      </div>

      <section className="kpis" aria-label="Pipeline summary">
        <Link className="kpi" href="/leads"><small>Active opportunities</small><b className="num">{d.kpi.active}</b><span className="sub">Open, not wrong, not No-go</span></Link>
        <Link className="kpi" href="/leads?type=tender,rfp&stage=Partnering,In+preparation"><small>Tenders / RFPs in preparation</small><b className="num">{d.kpi.tendersPrep}</b><span className="sub">Partnering or preparing</span></Link>
        <Link className="kpi" href="/leads?type=grant,csr&stage=Partnering,In+preparation"><small>Grants / CSR in preparation</small><b className="num">{d.kpi.grantsPrep}</b><span className="sub">Partnering or preparing</span></Link>
        <Link className="kpi focus" href="/leads?review=1"><small>Under review</small><b className="num">{d.kpi.underReview}</b><span className="sub">{d.kpi.unverified} not yet verified · screening or considering</span></Link>
        <Link className="kpi" href="/leads?approval=pending"><small>Decisions awaiting approval</small><b className="num">{d.kpi.pendingApproval}</b><span className="sub">Go / No-go recommended</span></Link>
        <Link className="kpi" href="/leads?due=14"><small>Deadlines in 14 days</small><b className="num">{d.kpi.upcoming}</b><span className="sub">Open opportunities</span></Link>
        <Link className={`kpi${d.kpi.overdue ? ' alert' : ''}`} href="/leads?due=overdue"><small>Overdue</small><b className="num">{d.kpi.overdue}</b><span className="sub">Deadline passed before submission</span></Link>
        <Link className="kpi" href="/leads?stage=Submitted,Clarification&show=all"><small>Submitted · won · lost</small><b className="num">{d.kpi.submitted}<span style={{ fontSize: 18, color: 'var(--muted)' }}> · {d.kpi.won} · {d.kpi.lost}</span></b><span className="sub">{d.kpi.submittedMonth} applied this month</span></Link>
      </section>

      <section className="card" aria-labelledby="att-h">
        <header>
          <div><h2 id="att-h">Needs your attention</h2><p>Approvals first, then by deadline. Each row says why it is here and what to do next.</p></div>
          <Link href="/review">Full review queue</Link>
        </header>
        {d.attention.length ? (
          <div className="att">
            {d.attention.map(({ lead: l, why }) => {
              const action = l.approval_status === 'Pending' ? ['Review decision', `/leads/${l.id}?tab=decision`]
                : why.some(w => w.startsWith('Deadline amendment')) ? ['Verify deadline', `/leads/${l.id}?tab=source`]
                  : why.some(w => w.startsWith('Eligibility')) ? ['Open review', `/leads/${l.id}?tab=eligibility`]
                    : why.includes('No owner') ? ['Assign owner', `/leads/${l.id}`]
                      : why.some(w => w.startsWith('Tender documents')) ? ['See documents', `/leads/${l.id}?tab=documents`] : ['Open', `/leads/${l.id}`];
              return (
                <div key={l.id}>
                  <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
                    <Ref code={l.ref_code} />
                    <Link className="t" href={`/leads/${l.id}`}>{l.title}</Link>
                    <span className="muted" style={{ fontSize: 12.5 }}>{[l.funder_buyer, l.country].filter(Boolean).join(' · ')}</span>
                    <span className="inline"><TypeTag type={l.lead_type} />{l.amount || l.value_band ? <span className="muted" style={{ fontSize: 12.5 }}>{l.value_band || l.amount}</span> : null}</span>
                  </div>
                  <Due deadline={l.deadline} note={l.deadline_note} />
                  <div className="why">{why.map(w => <span key={w} className={`badge ${/approval/.test(w) ? 'b-info' : /passed|missing/i.test(w) ? 'b-bad' : /clarification|verify|amendment/i.test(w) ? 'b-q' : 'b-warn'}`}>{w}</span>)}</div>
                  <div><Who name={nameOf(members, l.assigned_to)} /></div>
                  <div className="acts"><Link className={`btn btn-sm${l.approval_status === 'Pending' ? ' btn-primary' : ''}`} href={action[1]!}>{action[0]} →</Link></div>
                </div>
              );
            })}
          </div>
        ) : <Empty title="Nothing needs attention">New crawler leads appear under Crawler intake.</Empty>}
      </section>

      <div className="grid-2-1">
        <section className="card" aria-labelledby="team-h">
          <header><div><h2 id="team-h">Team work</h2><p>Open opportunities and shared tasks per person. A workload view, not a ranking.</p></div><Link href="/activity">Team activity</Link></header>
          <div className="tbl-wrap"><table className="tbl plain">
            <thead><tr><th>Person</th><th className="r">Opportunities</th><th className="r">Tasks</th><th className="r">Due soon</th><th className="r">Overdue</th></tr></thead>
            <tbody>
              {d.workload.map(w => (
                <tr key={w.member.id}>
                  <td><Link href={`/activity?person=${w.member.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><Who name={w.member.full_name || w.member.email} /></Link> <span className="muted" style={{ fontSize: 12 }}>{w.member.org_role || ''}</span></td>
                  <td className="r"><Link href={`/leads?assignee=${w.member.id}`}>{w.open}</Link></td>
                  <td className="r"><Link href={`/tasks?person=${w.member.id}`}>{w.tasks}</Link></td>
                  <td className="r">{w.dueSoon}</td>
                  <td className="r">{w.overdue ? <span className="badge b-bad">{w.overdue}</span> : <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="card" aria-labelledby="pipe-h">
          <header><div><h2 id="pipe-h">Pipeline</h2><p>Each step is a separate decision.</p></div></header>
          <div className="funnel">
            {d.funnel.map((f, i) => (
              <Link key={f.label} href={f.href} title={`${f.label}: ${f.n}`}>
                <span>{f.label}</span>
                <span className="track"><span style={{ width: `${(f.n / maxFunnel) * 100}%`, background: i === d.funnel.length - 1 ? 'var(--teal)' : undefined, opacity: 1 - i * 0.08 }} /></span>
                <b>{f.n}</b>
              </Link>
            ))}
          </div>
          <p className="legal">Correct ≠ eligible ≠ Go. Lead accuracy so far: {o.accuracy == null ? 'not enough checked leads' : `${Math.round(o.accuracy * 100)}% of ${o.reviewed} checked`}.</p>
        </section>
      </div>

      <div className="grid-2-1">
        <section className="card" aria-labelledby="act-h">
          <header><div><h2 id="act-h">Recent activity</h2><p>Who did what, on which opportunity.</p></div><Link href="/activity">All activity</Link></header>
          {d.recent.length ? (
            <ul className="feed">
              {d.recent.map((a: Activity) => {
                const l = byId.get(a.lead_id); const who = a.actor ? nameOf(members, a.actor) : 'Crawler / import';
                return (
                  <li key={a.id}>
                    <Avatar name={who} />
                    <span style={{ minWidth: 0 }}>
                      <Link href={a.actor ? `/activity?person=${a.actor}` : '/activity'} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>{who}</Link> <span className="what">{ACT[a.action] || a.action}</span>{' '}
                      {l ? <><Link className="rf" href={`/leads/${l.id}?tab=activity`}>{l.ref_code}</Link> <span className="muted">{l.title.slice(0, 70)}{l.title.length > 70 ? '…' : ''}</span></> : null}
                      {a.detail && a.action !== 'created' ? <div className="muted" style={{ fontSize: 12.5 }}>{a.detail.slice(0, 140)}</div> : null}
                    </span>
                    <span className="when" title={fmtDateTime(a.created_at)}>{ago(a.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          ) : <Empty title="No activity yet" />}
        </section>

        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <section className="card" aria-labelledby="my-h">
            <header><div><h2 id="my-h">My leads &amp; relationships</h2><p>Private to you unless you share them.</p></div><Link href="/my">Open</Link></header>
            {myRels.length ? (
              <ul className="feed">
                {myRels.map(r => (
                  <li key={r.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <span style={{ minWidth: 0 }}><Link href={`/my?rel=${r.id}`} style={{ fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>{r.organisation}</Link><div className="muted" style={{ fontSize: 12.5 }}>{r.next_action || r.status}</div></span>
                    <FollowUp date={r.next_followup} />
                  </li>
                ))}
              </ul>
            ) : <Empty title="No personal leads yet" action={{ href: '/my', label: '+ Add a personal lead' }} />}
          </section>

          <section className="card" aria-labelledby="wk-h">
            <header><div><h2 id="wk-h">Applications per week</h2><p>Opportunities with an “applied on” date, last 8 weeks.</p></div><Link href="/reports">Reports</Link></header>
            <div className="weeks" role="img" aria-label={d.weeks.map(w => `week of ${w.week}: ${w.count}`).join(', ')}>
              {d.weeks.map(w => <div key={w.week} title={`Week of ${fmtDate(w.week)}: ${w.count}`}><b>{w.count || ''}</b><i style={{ height: `${(w.count / maxWeek) * 60}px` }} /><span>{fmtDate(w.week).replace(/ \d{4}$/, '')}</span></div>)}
            </div>
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="fu-h">
        <header><div><h2 id="fu-h">Follow-ups this week</h2><p>Opportunities we are pursuing with a follow-up due in 7 days or overdue.</p></div><Link href="/leads?decision=Go">All Go</Link></header>
        {(() => {
          const fu = leads.filter(l => l.next_followup && (daysLeft(l.next_followup) ?? 99) <= 7 && !['Won', 'Lost', 'Dropped', 'Banked'].includes(l.stage)).sort((a, b) => String(a.next_followup).localeCompare(String(b.next_followup))).slice(0, 6);
          return fu.length ? (
            <ul className="feed">{fu.map(l => (
              <li key={l.id} style={{ gridTemplateColumns: 'minmax(0,1fr) 140px auto' }}>
                <span style={{ minWidth: 0 }}><Ref code={l.ref_code} /> <Link className="t" href={`/leads/${l.id}?tab=proposal`}>{l.title}</Link><div className="muted" style={{ fontSize: 12.5 }}>{[l.contact_name, l.contact_role].filter(Boolean).join(', ') || l.funder_buyer}</div></span>
                <FollowUp date={l.next_followup} />
                <DecisionPill d={l.decision} />
              </li>
            ))}</ul>
          ) : <Empty title="No follow-ups due">Set a follow-up date on the Proposal tab of an opportunity.</Empty>;
        })()}
      </section>
    </>
  );
}
