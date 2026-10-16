import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { notFound } from 'next/navigation';
import { assignAction, claimLeadAction, stageAction, verifyAction } from '@/app/actions';
import { DecisionPill, Denied, Due, EligibilityPill, Notes, Ref, Score, TypeTag, VerificationPill, Who } from '@/components/ui';
import { getLead, getSession, listMembers } from '@/lib/data';
import { listDeadlines, listDocRequests, listDocs, listLeadPartners, listRequirements, listTasks } from '@/lib/data-ext';
import { fmtDate, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { CLOSED_STAGES, STAGES, VERIFICATIONS } from '@/lib/types';
import { ActivityTab, AssessmentTab, DecisionTab, DocumentsTab, EligibilityTab, OverviewTab, PartnersTab, ProposalTab, SourceTab, TasksTab } from './tabs';

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = [
  ['overview', 'Overview'], ['source', 'Source & amendments'], ['eligibility', 'Eligibility'], ['assessment', 'Fit & risk'], ['decision', 'Go / No-go'],
  ['partners', 'Partners'], ['documents', 'Documents'], ['tasks', 'Tasks'], ['proposal', 'Proposal'], ['activity', 'Activity']
] as const;
export type TabKey = typeof TABS[number][0];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const res = await getLead(Number((await params).id));
  return { title: res ? `${res.lead.ref_code} ${res.lead.title.slice(0, 40)}` : 'Opportunity' };
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS.find(t => t[0] === sp.tab)?.[0] || 'overview') as TabKey;
  const leadId = Number(id);
  const [res, members, session, deadlines, reqs, docs, requests, tasks, links] = await Promise.all([
    getLead(leadId), listMembers(), getSession(), listDeadlines(leadId), listRequirements(leadId), listDocs(leadId), listDocRequests(leadId), listTasks(), listLeadPartners()
  ]);
  if (!res) notFound();
  const { lead: l, activity } = res;
  const s = session!;
  const pendingAmend = deadlines.filter(d => d.kind === 'Amendment' && !d.verified && !d.rejected);
  const lastVerified = deadlines.find(d => d.kind === 'Amendment' && d.verified);
  const openReqs = reqs.filter(r => r.status === 'Needs clarification' || (r.status === 'Not assessed' && r.necessity !== 'Optional'));
  const missingDocs = docs.filter(d => d.status === 'Missing' || d.status === 'Login needed' || d.status === 'Requested');
  const leadTasks = tasks.filter(t => t.lead_id === leadId);
  const openTasks = leadTasks.filter(t => t.status === 'Open' || t.status === 'In progress');
  const stageIdx = STAGES.indexOf(l.stage);
  const closed = (CLOSED_STAGES as string[]).includes(l.stage);
  const counts: Partial<Record<TabKey, [number, string]>> = {
    source: [pendingAmend.length, 'warn'], eligibility: [openReqs.length, 'warn'], documents: [missingDocs.length, 'bad'],
    tasks: [openTasks.length, ''], partners: [links.filter(x => x.lead_id === leadId).length, ''], decision: [l.approval_status === 'Pending' ? 1 : 0, 'warn']
  };
  const canAssign = l.assigned_to ? can(s, 'opp.reassign') : can(s, 'opp.assign');

  return (
    <>
      <nav aria-label="Breadcrumb" className="muted" style={{ fontSize: 12.5 }}><Link href="/">Dashboard</Link> / <Link href="/leads">Pipeline</Link> / <span className="ref">{l.ref_code}</span></nav>
      <Notes sp={sp} />

      <section className="rechead" aria-labelledby="opp-title">
        <div className="top">
          <div style={{ display: 'grid', gap: 6, minWidth: 0, flex: '1 1 520px' }}>
            <div className="inline"><Ref code={l.ref_code} big /><TypeTag type={l.lead_type} /><span className="badge b-out">{l.origin === 'crawler' ? 'Source: crawler' : 'Source: manual / import'}</span>{l.duplicate_of ? <Link className="badge b-neu" href={`/leads/${l.duplicate_of}`}>⧉ Duplicate — open original</Link> : null}</div>
            <h1 id="opp-title">{l.title}</h1>
            <span className="muted">{[l.funder_buyer, l.country, l.category].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="inline" style={{ alignItems: 'center' }}>
            <Score value={l.fit_score} />
            <ExportMenu kind="opportunity" id={l.id} canExport={can(s, 'opp.export')} label="Export record" csvSheets={['Summary', 'Eligibility', 'Risks', 'Scorecard', 'Deadlines', 'Documents', 'Document requests', 'Partners', 'Tasks', 'History']} />
            {l.url ? <a className="btn" href={l.url} target="_blank" rel="noopener noreferrer">Open notice ↗</a> : null}
            <Link className="btn btn-primary" href={`/leads/${l.id}?tab=${l.verification === 'Unverified' ? 'overview' : l.eligibility_status === 'Not assessed' || l.eligibility_status === 'Needs clarification' ? 'eligibility' : 'decision'}`}>
              {l.verification === 'Unverified' ? 'Verify lead' : l.eligibility_status === 'Not assessed' || l.eligibility_status === 'Needs clarification' ? 'Review eligibility' : l.approval_status === 'Pending' && can(s, 'decision.approve') ? 'Approve decision' : 'Go / No-go'}
            </Link>
          </div>
        </div>
        <dl className="meta">
          <div><dt>Current deadline</dt><dd><Due deadline={l.deadline} />
            <span className="sub">{lastVerified ? <>↻ Amended (was {fmtDate(lastVerified.previous)}) · {lastVerified.source}</> : l.deadline ? 'Original deadline' : 'No deadline stated'}</span>
            {pendingAmend.length ? <Link href={`/leads/${l.id}?tab=source`} className="flag f-amd">↻ {pendingAmend.length} change{pendingAmend.length > 1 ? 's' : ''} to verify</Link> : null}</dd></div>
          <div><dt>Value</dt><dd>{l.value_band || l.amount || '—'}<span className="sub">{l.value_band && l.amount ? l.amount : l.amount ? 'As stated in the source' : 'Not estimated'}</span></dd></div>
          <div><dt>Owner</dt><dd><Who name={nameOf(members, l.assigned_to)} /><span className="sub">{l.assigned_at ? `since ${fmtDate(l.assigned_at)}` : 'Nobody owns it yet'}</span></dd></div>
          <div><dt>Stage</dt><dd>{l.stage}<span className="sub">{closed ? 'Closed' : `Step ${stageIdx + 1} of 7 active stages`}</span></dd></div>
        </dl>
        <div className="dims" aria-label="Decision fields (separate)">
          <div className="dim"><span>Lead verification</span><VerificationPill v={l.verification} /><span className="by">{l.verified_at ? `${nameOf(members, l.verified_by) || 'someone'}, ${fmtDate(l.verified_at)}` : 'Not checked yet'}</span></div>
          <div className="dim"><span>Eligibility</span><EligibilityPill e={l.eligibility_status} /><span className="by">{l.eligibility_at ? `${nameOf(members, l.eligibility_by)}, ${fmtDate(l.eligibility_at)}` : `${openReqs.length} open requirement${openReqs.length === 1 ? '' : 's'}`}</span></div>
          <div className="dim"><span>Pursuit decision</span><DecisionPill d={l.decision} approval={l.approval_status} always /><span className="by">{l.decided_at && l.decision !== 'Undecided' ? `${nameOf(members, l.decided_by)}, ${fmtDate(l.decided_at)}` : l.approval_status === 'Returned' ? 'Returned for changes' : 'Separate from eligibility'}</span></div>
          <div className="dim"><span>Partner need</span><span className={`badge ${l.partner_need === 'Required by tender' ? 'b-info' : l.partner_need === 'Unclear' ? 'b-q' : 'b-out'}`}>{l.partner_need}</span><span className="by">{l.partner_need === 'Not indicated' ? 'Tender does not require one' : 'See Partners tab'}</span></div>
        </div>
        <ol className="stepper" aria-label={`Stage: ${l.stage}`}>
          {STAGES.slice(0, 7).map((st, i) => (
            <li key={st} style={{ display: 'contents' }}>
              {i ? <span className="sep" aria-hidden="true" /> : null}
              <span className={`s${i < stageIdx && !closed ? ' done' : ''}${st === l.stage ? ' cur' : ''}`} aria-current={st === l.stage ? 'step' : undefined}><i>{i < stageIdx && !closed ? '✓' : i + 1}</i>{st}</span>
            </li>
          ))}
          <li style={{ display: 'contents' }}><span className="sep" aria-hidden="true" /><span className={`s${closed ? ' cur closed' : ''}`}><i>✓</i>{closed ? l.stage : 'Outcome'}</span></li>
        </ol>
      </section>

      <nav className="rtabs" aria-label="Opportunity sections">
        {TABS.map(([k, label]) => {
          const c = counts[k];
          return <Link key={k} className="rtab" href={`/leads/${l.id}?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{label}{c && c[0] ? <span className={`c ${c[1]}`}>{c[0]}</span> : null}</Link>;
        })}
      </nav>

      <div className={`detail${['eligibility', 'assessment', 'documents', 'tasks'].includes(tab) ? ' wide' : ''}`}>
        <div style={{ display: 'grid', gap: 18, minWidth: 0, alignContent: 'start' }}>
          {tab === 'overview' ? <OverviewTab lead={l} session={s} members={members} openReqs={openReqs.length} missingDocs={missingDocs.length} pendingAmend={pendingAmend.length} openTasks={openTasks.length} /> : null}
          {tab === 'source' ? <SourceTab lead={l} session={s} members={members} deadlines={deadlines} /> : null}
          {tab === 'eligibility' ? <EligibilityTab lead={l} session={s} members={members} reqs={reqs} selected={Number(sp.req) || null} /> : null}
          {tab === 'assessment' ? <AssessmentTab lead={l} session={s} members={members} /> : null}
          {tab === 'decision' ? <DecisionTab lead={l} session={s} members={members} reqs={reqs} activity={activity} /> : null}
          {tab === 'partners' ? <PartnersTab lead={l} session={s} reqs={reqs} links={links.filter(x => x.lead_id === leadId)} /> : null}
          {tab === 'documents' ? <DocumentsTab lead={l} session={s} members={members} docs={docs} requests={requests} /> : null}
          {tab === 'tasks' ? <TasksTab lead={l} session={s} members={members} tasks={leadTasks} /> : null}
          {tab === 'proposal' ? <ProposalTab lead={l} session={s} reqs={reqs} /> : null}
          {tab === 'activity' ? <ActivityTab lead={l} session={s} members={members} activity={activity} /> : null}
        </div>

        <aside className="side" aria-label="Quick actions">
          <section className="card">
            <header><div><h2>Is the lead correct?</h2><p>Real and relevant enough to review — not whether we should bid.</p></div></header>
            {can(s, 'opp.verify') ? (
              <form action={verifyAction} style={{ display: 'grid', gap: 10 }} key={l.verification + (l.verification_note || '')}>
                <input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=${tab}`} />
                <div className="radios" role="radiogroup" aria-label="Lead verification">
                  {VERIFICATIONS.map(v => <label key={v}><input type="radio" name="verification" value={v} defaultChecked={l.verification === v} />{v}</label>)}
                </div>
                <label className="fld">Why <span className="hint-text">(required for Incorrect / Duplicate)</span><input type="text" name="note" defaultValue={l.verification_note || ''} placeholder="e.g. checked on GeM; scope is lab-only" /></label>
                <div><button className="btn btn-primary" type="submit">Save check</button></div>
              </form>
            ) : <Denied>Your role cannot change verification.</Denied>}
          </section>

          <section className="card">
            <header><div><h2>Owner</h2><p>{l.assigned_to ? `${nameOf(members, l.assigned_to)} owns this.` : 'Available — nobody owns it yet.'}</p></div></header>
            {canAssign ? (
              <form action={assignAction} className="inline">
                <input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=${tab}`} />
                <select name="assigned_to" defaultValue={l.assigned_to || ''} aria-label="Owner" key={l.assigned_to || 'none'}>
                  <option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}{m.org_role ? ` (${m.org_role})` : ''}</option>)}
                </select>
                <button className="btn" type="submit">{l.assigned_to ? 'Reassign' : 'Assign'}</button>
              </form>
            ) : !l.assigned_to && can(s, 'opp.claim') ? (
              <form action={claimLeadAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=${tab}`} /><button className="btn btn-primary" type="submit">Take this opportunity</button></form>
            ) : l.assigned_to === s.user.id ? (
              <form action={assignAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="assigned_to" value="" /><input type="hidden" name="return" value={`/leads/${l.id}?tab=${tab}`} /><button className="btn" type="submit">Give it back</button></form>
            ) : <Denied>{l.assigned_to ? 'Your role cannot move work between people (an open policy question).' : 'Your role cannot assign this.'}</Denied>}
          </section>

          <section className="card">
            <header><div><h2>Stage</h2><p>In preparation needs an approved Go.</p></div></header>
            {can(s, 'opp.edit') ? (
              <form action={stageAction} className="inline">
                <input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=${tab}`} />
                <select name="stage" defaultValue={l.stage} aria-label="Stage" key={l.stage}>{STAGES.map(st => <option key={st} value={st}>{st}</option>)}</select>
                <button className="btn" type="submit">Update</button>
              </form>
            ) : <Denied>Your role cannot change the stage.</Denied>}
          </section>

          <section className="card">
            <header><div><h2>Go / No-go</h2></div><Link href={`/leads/${l.id}?tab=decision`}>Open</Link></header>
            <div className="inline"><DecisionPill d={l.decision} approval={l.approval_status} always /></div>
            {l.decision_reason ? <p style={{ margin: 0, fontSize: 13.5 }}>{l.decision_reason}</p> : null}
            {l.approval_status === 'Pending' ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{nameOf(members, l.recommended_by)} recommended <b>{l.recommended_decision}</b>{l.recommended_at ? ` on ${fmtDate(l.recommended_at)}` : ''}.</p> : null}
          </section>
        </aside>
      </div>
    </>
  );
}
