import Link from 'next/link';
import { assignAction, verifyAction } from '@/app/actions';
import { AutoSubmitSelect } from '@/components/AutoSubmit';
import { DecisionPill, Due, Priority, Score, TYPE_COLOR, TypeTag, VerificationPill } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { filterFromParams, filterLeads, isOpen } from '@/lib/views';
import { DECISIONS, LEAD_TYPES, PRIORITIES, SLUG_OF, STAGES, TYPE_LABEL, VERIFICATIONS, type Lead, type Member } from '@/lib/types';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = filterFromParams(sp);
  const [session, leads, members] = await Promise.all([getSession(), listLeads(), listMembers()]);
  const me = session!.user.id;
  const rows = filterLeads(leads, f, me);
  const base = { ...f, type: undefined };
  const countFor = (t?: (typeof LEAD_TYPES)[number]) => filterLeads(leads, { ...base, type: t }, me).length;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])), ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/leads?${s}` : '/leads';
  };
  const title = f.assignee === 'me' ? 'My leads' : f.verification === 'Unverified' && !f.type ? 'Leads to check' : f.type ? TYPE_LABEL[f.type] : 'All leads';

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">Leads</div>
          <h1>{title}</h1>
          <p>{rows.length} {rows.length === 1 ? 'lead' : 'leads'}{f.show === 'all' ? ' including closed ones' : ' still open'}. Mark each one correct or wrong so the dashboard can track crawler accuracy.</p>
        </div>
        <Link className="btn btn-primary" href="/leads/new">+ Add lead</Link>
      </div>

      <nav className="tabs" aria-label="Lead type">
        <Link className="tab" href={qs({ type: undefined })} aria-current={!f.type ? 'page' : undefined}>All <span className="n">{countFor()}</span></Link>
        {LEAD_TYPES.map(t => (
          <Link key={t} className="tab" href={qs({ type: SLUG_OF[t] })} aria-current={f.type === t ? 'page' : undefined}>
            <i className="t-dot" style={{ background: TYPE_COLOR[t] }} aria-hidden="true" />{TYPE_LABEL[t]} <span className="n">{countFor(t)}</span>
          </Link>
        ))}
      </nav>

      <form className="filters" method="get" action="/leads">
        {f.type ? <input type="hidden" name="type" value={SLUG_OF[f.type]} /> : null}
        <input type="search" name="q" defaultValue={f.q || ''} placeholder="Search title, buyer, country, reference…" aria-label="Search" />
        <select name="verification" defaultValue={f.verification || ''} aria-label="Checked">
          <option value="">Any check status</option>
          {VERIFICATIONS.map(v => <option key={v} value={v}>{v === 'Unverified' ? 'Not checked' : v === 'Incorrect' ? 'Wrong lead' : v}</option>)}
        </select>
        <select name="decision" defaultValue={f.decision || ''} aria-label="Decision">
          <option value="">Any decision</option>
          {DECISIONS.map(d => <option key={d} value={d}>{d === 'Undecided' ? 'Not decided' : d}</option>)}
        </select>
        <select name="stage" defaultValue={f.stage || ''} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="assignee" defaultValue={f.assignee || ''} aria-label="Assigned to">
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
        </select>
        <select name="priority" defaultValue={f.priority || ''} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select name="due" defaultValue={f.due || ''} aria-label="Deadline">
          <option value="">Any deadline</option>
          <option value="7">Within 7 days</option>
          <option value="14">Within 14 days</option>
          <option value="30">Within 30 days</option>
        </select>
        <select name="sort" defaultValue={f.sort} aria-label="Sort">
          <option value="deadline">Deadline first</option>
          <option value="fit">Best fit first</option>
          <option value="new">Newest first</option>
        </select>
        <select name="show" defaultValue={f.show} aria-label="Show">
          <option value="open">Open only</option>
          <option value="all">Include closed</option>
        </select>
        <button className="btn btn-primary" type="submit">Apply</button>
        <Link className="btn" href={f.type ? `/leads?type=${SLUG_OF[f.type]}` : '/leads'}>Clear</Link>
      </form>

      <div className="leads" role="table" aria-label="Leads">
        <div className="lrow head" role="row">
          <span>Fit</span><span>Lead</span><span>Deadline</span><span>Status</span><span className="acts">Check and assign</span>
        </div>
        {rows.length ? rows.map(l => <Row key={l.id} lead={l} members={members} />) : (
          <div className="empty">No leads match these filters. Try “Include closed” or clear the search.</div>
        )}
      </div>
    </>
  );
}

function Row({ lead: l, members }: { lead: Lead; members: Member[] }) {
  return (
    <div className={`lrow${isOpen(l) ? '' : ' dim'}`} role="row">
      <Score value={l.fit_score} />
      <div className="t">
        <Link href={`/leads/${l.id}`}>{l.title}</Link>
        <div className="meta">
          {l.funder_buyer ? <span>{l.funder_buyer}</span> : null}
          {l.country ? <span>{l.country}</span> : null}
          {l.ref_no ? <span className="mono">{l.ref_no}</span> : null}
        </div>
        <div className="inline"><TypeTag type={l.lead_type} /><Priority p={l.priority} />{l.deadline_note && /extend|moved|corrigend|amend|chang|postpon/i.test(l.deadline_note) ? <span className="hint" title={l.deadline_note}>Deadline changed</span> : null}{l.red_flags ? <span className="flag-mini" title={l.red_flags}>⚑ {l.red_flags.split(/;\s*/).length} red flag{l.red_flags.split(/;\s*/).length > 1 ? 's' : ''}</span> : null}</div>
      </div>
      <Due deadline={l.deadline} />
      <div className="st">
        <VerificationPill v={l.verification} />
        <DecisionPill d={l.decision} />
        <span className="pill">{l.stage}</span>
      </div>
      <div className="acts">
        {l.verification === 'Unverified' ? (
          <form action={verifyAction} className="inline">
            <input type="hidden" name="id" value={l.id} />
            <button className="btn btn-sm btn-good" name="verification" value="Correct" type="submit">✓ Correct</button>
            <button className="btn btn-sm btn-bad" name="verification" value="Incorrect" type="submit">✕ Wrong</button>
          </form>
        ) : null}
        <form action={assignAction}>
          <input type="hidden" name="id" value={l.id} />
          <AutoSubmitSelect key={l.assigned_to || 'none'} name="assigned_to" defaultValue={l.assigned_to || ''} label={`Assign ${l.title}`}>
            <option value="">Unassigned</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
          </AutoSubmitSelect>
        </form>
      </div>
    </div>
  );
}
