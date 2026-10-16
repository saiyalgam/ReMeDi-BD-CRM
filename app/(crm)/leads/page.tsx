import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { bulkAction, deleteViewAction, saveViewAction } from '@/app/actions';
import { DecisionPill, Due, EligibilityPill, Empty, Flags, Notes, Ref, Score, StagePill, TYPE_COLOR, TypeTag, VerificationPill, Who } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listDeadlines, listDocs, listRequirements, listViews } from '@/lib/data-ext';
import { nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { BUILTIN_VIEWS, filterFromParams, filterLeads, flagContext, flagsOf } from '@/lib/views';
import { DECISIONS, ELIGIBILITY_STATUSES, LEAD_TYPES, PARTNER_NEEDS, SLUG_OF, STAGES, TYPE_LABEL, VERIFICATIONS } from '@/lib/types';

export const metadata = { title: 'Pipeline' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const PAGE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = filterFromParams(sp);
  const [session, leads, members, deadlines, docs, reqs, myViews] = await Promise.all([getSession(), listLeads(), listMembers(), listDeadlines(), listDocs(), listRequirements(), listViews()]);
  const me = session!.user.id;
  const cx = flagContext(deadlines, docs, reqs);
  const all = filterLeads(leads, f, me, cx);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const page = Math.min(f.page || 1, pages);
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([k, v]) => v && !['msg', 'err', 'page'].includes(k as string))) as Record<string, string>;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...flat, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/leads?${s}` : '/leads';
  };
  const currentQuery = new URLSearchParams(flat).toString();
  const activeView = BUILTIN_VIEWS.find(v => new URLSearchParams(v.query).toString() === currentQuery);
  const title = f.assignee === 'me' ? 'My work' : f.type ? TYPE_LABEL[f.type] : activeView && activeView.key !== 'all' ? activeView.name : 'Pipeline';
  const canBulk = can(session, 'opp.edit') || can(session, 'opp.assign') || can(session, 'opp.verify');
  const chips: [string, string][] = [];
  for (const [k, v] of Object.entries(flat)) if (!['sort', 'show', 'type', 'q'].includes(k)) chips.push([k, v]);

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">Pipeline</div>
          <h1>{title}</h1>
          <p>{all.length} {all.length === 1 ? 'opportunity' : 'opportunities'}{f.show === 'all' ? ' including closed ones' : ' still open'}. Verification, eligibility, decision and stage are separate columns.</p>
        </div>
        <div className="inline">
          <ExportMenu kind="pipeline" params={sp} canExport={can(session, 'opp.export')} />
          {can(session, 'opp.create') ? <Link className="btn" href="/settings/import">Import spreadsheet</Link> : null}
          {can(session, 'opp.create') ? <Link className="btn btn-primary" href="/leads/new">+ Add opportunity</Link> : null}
        </div>
      </div>
      <Notes sp={sp} />

      <nav className="views" aria-label="Saved views">
        {BUILTIN_VIEWS.map(v => (
          <Link key={v.key} className="view" href={v.query ? `/leads?${v.query}` : '/leads'} title={v.hint} aria-current={activeView?.key === v.key ? 'page' : undefined}>
            {v.name}<span className="n">{filterLeads(leads, filterFromParams(Object.fromEntries(new URLSearchParams(v.query))), me, cx).length}</span>
          </Link>
        ))}
        {myViews.map(v => (
          <span key={v.id} className="inline" style={{ gap: 0 }}>
            <Link className="view" href={`/leads?${v.query}`} aria-current={v.query === currentQuery ? 'page' : undefined}>★ {v.name}</Link>
            <form action={deleteViewAction}><input type="hidden" name="vid" value={v.id} /><button className="btn-link" type="submit" aria-label={`Remove saved view ${v.name}`} style={{ padding: '0 6px', textDecoration: 'none' }}>×</button></form>
          </span>
        ))}
      </nav>

      <nav className="tabs" aria-label="Opportunity type">
        <Link className="tab" href={qs({ type: undefined })} aria-current={!f.type && !f.types ? 'page' : undefined}>All types</Link>
        {LEAD_TYPES.map(t => (
          <Link key={t} className="tab" href={qs({ type: SLUG_OF[t] })} aria-current={f.type === t ? 'page' : undefined}>
            <i className="t-dot" style={{ background: TYPE_COLOR[t] }} aria-hidden="true" />{TYPE_LABEL[t]}
          </Link>
        ))}
      </nav>

      <form className="filters" method="get" action="/leads" aria-label="Filters">
        {flat.type ? <input type="hidden" name="type" value={flat.type} /> : null}
        <input type="search" name="q" defaultValue={f.q || ''} placeholder="Search ref. no., title, buyer, country…" aria-label="Search" />
        <select name="stage" defaultValue={flat.stage || ''} aria-label="Stage">
          <option value="">Any stage</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="verification" defaultValue={f.verification || ''} aria-label="Verification">
          <option value="">Any verification</option>{VERIFICATIONS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select name="eligibility" defaultValue={f.eligibility || ''} aria-label="Eligibility">
          <option value="">Any eligibility</option>{ELIGIBILITY_STATUSES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select name="decision" defaultValue={f.decision || ''} aria-label="Pursuit decision">
          <option value="">Any decision</option>{DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select name="assignee" defaultValue={f.assignee || ''} aria-label="Owner">
          <option value="">Any owner</option><option value="me">Me</option><option value="none">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
        </select>
        <select name="partner" defaultValue={f.partner || ''} aria-label="Partner need">
          <option value="">Any partner need</option>{PARTNER_NEEDS.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select name="due" defaultValue={f.due || ''} aria-label="Deadline">
          <option value="">Any deadline</option><option value="7">Within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option><option value="overdue">Overdue</option>
        </select>
        <input type="text" name="country" defaultValue={f.country || ''} placeholder="Geography" aria-label="Geography" style={{ width: 120 }} />
        <select name="minScore" defaultValue={f.minScore ? String(f.minScore) : ''} aria-label="Minimum fit score">
          <option value="">Any fit score</option><option value="50">Fit ≥ 50</option><option value="70">Fit ≥ 70</option><option value="85">Fit ≥ 85</option>
        </select>
        <select name="flag" defaultValue={f.flag || ''} aria-label="Flags">
          <option value="">Any flag</option><option value="amendment">Deadline change to verify</option><option value="docs">Documents missing</option><option value="uncertain">Unclear eligibility / scope</option>
        </select>
        <select name="sort" defaultValue={f.sort} aria-label="Sort">
          <option value="deadline">Deadline first</option><option value="fit">Best fit first</option><option value="new">Newest first</option><option value="ref">Reference no.</option>
        </select>
        <select name="show" defaultValue={f.show} aria-label="Open or all"><option value="open">Open only</option><option value="all">Include closed</option></select>
        <button className="btn btn-primary" type="submit">Apply</button>
        <Link className="btn" href="/leads">Clear</Link>
      </form>

      {chips.length ? (
        <div className="chiprow" aria-label="Active filters">
          <span className="muted" style={{ fontSize: 12.5 }}>Filtered by</span>
          {chips.map(([k, v]) => <span key={k} className="chip">{k === 'assignee' ? `owner: ${v === 'me' ? 'me' : v === 'none' ? 'unassigned' : nameOf(members, v)}` : `${k}: ${v.replace(/\+/g, ' ')}`}<Link href={qs({ [k]: undefined })} aria-label={`Remove filter ${k}`}>×</Link></span>)}
          <details className="drawer" style={{ display: 'inline-block' }}>
            <summary style={{ padding: '4px 10px', fontSize: 12.5 }}>Save as view</summary>
            <form action={saveViewAction} className="body inline"><input type="hidden" name="query" value={currentQuery} /><input type="text" name="name" placeholder="View name" required aria-label="View name" /><button className="btn btn-sm btn-primary" type="submit">Save</button></form>
          </details>
        </div>
      ) : null}

      <form action={bulkAction} className="tbl-card">
        <input type="hidden" name="return" value={qs({})} />
        {canBulk ? (
          <div className="bulk" role="group" aria-label="Bulk actions for selected rows">
            <b style={{ fontSize: 12.5 }}>With selected:</b>
            {can(session, 'opp.verify') ? <button className="btn btn-sm" name="op" value="correct" type="submit">✓ Mark correct</button> : null}
            {can(session, 'opp.assign') ? <><select name="assigned_to" aria-label="Owner for selected rows" defaultValue=""><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select><button className="btn btn-sm" name="op" value="assign" type="submit">Assign</button></> : null}
            {can(session, 'opp.edit') ? <><select name="stage" aria-label="Stage for selected rows" defaultValue=""><option value="">Stage…</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}</select><button className="btn btn-sm" name="op" value="stage" type="submit">Set stage</button></> : null}
          </div>
        ) : null}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              {canBulk ? <th style={{ width: 28 }}><span className="sr-only">Select</span></th> : null}
              <th>Ref. no.</th><th>Opportunity · buyer / funder</th><th>Type · source</th><th>Value</th><th>Deadline</th>
              <th>Verification</th><th>Eligibility</th><th>Go / No-go</th><th>Owner</th><th>Next</th>
            </tr></thead>
            <tbody>
              {rows.map(l => {
                const fl = flagsOf(l, cx);
                const next = l.verification === 'Unverified' ? ['Verify lead', `/leads/${l.id}`]
                  : l.approval_status === 'Pending' ? ['Approve decision', `/leads/${l.id}?tab=decision`]
                    : fl.amendment ? ['Verify deadline', `/leads/${l.id}?tab=source`]
                      : l.eligibility_status === 'Not assessed' || l.eligibility_status === 'Needs clarification' ? ['Assess eligibility', `/leads/${l.id}?tab=eligibility`]
                        : l.decision === 'Undecided' ? ['Recommend Go / No-go', `/leads/${l.id}?tab=decision`]
                          : !l.assigned_to ? ['Assign owner', `/leads/${l.id}`]
                            : ['Prepare', `/leads/${l.id}?tab=tasks`];
                return (
                  <tr key={l.id}>
                    {canBulk ? <td><input type="checkbox" name="ids" value={l.id} aria-label={`Select ${l.ref_code}`} /></td> : null}
                    <td><Ref code={l.ref_code} /><div className="sub">{l.stage}</div></td>
                    <td className="t" style={{ minWidth: 260 }}>
                      <Link href={`/leads/${l.id}`}>{l.title}</Link>
                      <div className="sub">{[l.funder_buyer, l.country].filter(Boolean).join(' · ')}</div>
                      <div style={{ marginTop: 4 }}><Flags f={fl} /></div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}><TypeTag type={l.lead_type} /><div className="sub" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.source || ''}>{l.origin === 'crawler' ? 'Crawler' : 'Manual / import'}</div></td>
                    <td style={{ minWidth: 110 }}><span style={{ fontSize: 13 }}>{l.value_band || (l.amount ? l.amount.slice(0, 40) : '—')}</span><div style={{ marginTop: 4 }}><Score value={l.fit_score} /></div></td>
                    <td><Due deadline={l.deadline} note={l.deadline_note} /></td>
                    <td>
                      <VerificationPill v={l.verification} />
                    </td>
                    <td><EligibilityPill e={l.eligibility_status} /></td>
                    <td><DecisionPill d={l.decision} approval={l.approval_status} always /></td>
                    <td><Who name={nameOf(members, l.assigned_to)} /></td>
                    <td style={{ minWidth: 130 }}><Link className="btn btn-sm" href={next[1]!}>{next[0]} →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length ? <Empty title="No opportunities match these filters">Try “Include closed”, remove a filter chip, or clear the search.</Empty> : null}
        </div>
        <div className="tbl-foot">
          <span>Showing {rows.length ? (page - 1) * PAGE + 1 : 0}–{(page - 1) * PAGE + rows.length} of {all.length}. Deadlines and days left are computed from today and the latest verified deadline.</span>
          {pages > 1 ? (
            <nav className="pager" aria-label="Pages">
              {page > 1 ? <Link className="btn btn-sm" href={qs({ page: String(page - 1) })}>← Previous</Link> : null}
              <span>Page {page} of {pages}</span>
              {page < pages ? <Link className="btn btn-sm" href={qs({ page: String(page + 1) })}>Next →</Link> : null}
            </nav>
          ) : null}
        </div>
      </form>
      <StageLegend />
    </>
  );
}

function StageLegend() {
  return <p className="legal">Stages: {STAGES.map((s, i) => <span key={s}>{i ? ' → ' : ''}<StagePill s={s} /></span>).slice(0, 7)} · closed: Won, Lost, Dropped, Banked.</p>;
}
