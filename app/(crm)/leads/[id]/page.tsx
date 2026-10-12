import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assignAction, commentAction, decisionAction, detailsAction, pursuitAction, stageAction, verifyAction } from '@/app/actions';
import { Avatar, DecisionPill, Due, Priority, Score, Tag, TypeTag, VerificationPill, Who, riskTone } from '@/components/ui';
import { getLead, listMembers } from '@/lib/data';
import { daysLeft, fmtDate, fmtDateTime, nameOf } from '@/lib/format';
import { stripDaysLeft } from '@/lib/leadtype';
import { DECISIONS, RFP_STATUSES, STAGES, VERIFICATIONS, type Activity, type Decision, type Verification } from '@/lib/types';

const V_TEXT: Record<Verification, string> = { Unverified: 'Not checked', Correct: 'Correct lead', Incorrect: 'Wrong lead', Duplicate: 'Duplicate' };
const D_TEXT: Record<Decision, string> = { Undecided: 'Not decided', Go: 'Go: we pursue it', 'No-go': 'No-go: we skip it' };
const ACT_TEXT: Record<Activity['action'], string> = {
  comment: 'added a note', created: 'added this lead', verified: 'checked it', assigned: 'changed the owner', stage: 'moved the stage',
  decision: 'decided', edited: 'edited the details', pursuit: 'updated the pursuit', updated: 'updated it'
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const msg = typeof sp.msg === 'string' ? sp.msg : '';
  const err = typeof sp.err === 'string' ? sp.err : '';
  const [res, members] = await Promise.all([getLead(Number(id)), listMembers()]);
  if (!res) notFound();
  const { lead: l, activity } = res;
  const fd = daysLeft(l.next_followup);
  const follow = fd === null ? null : fd < 0 ? { text: `overdue by ${-fd} d`, tone: 'urgent' } : fd === 0 ? { text: 'today', tone: 'urgent' } : { text: `in ${fd} d`, tone: fd <= 3 ? 'soon' : 'normal' };

  const facts: [string, React.ReactNode][] = [
    ['Deadline', <span key="d" style={{ display: 'grid', gap: 2 }}><Due deadline={l.deadline} />{l.deadline_note ? <span className="muted" style={{ fontSize: 12.5 }}>{l.deadline_note}</span> : null}</span>],
    ['Value', l.amount || '—'],
    ['Reference', l.ref_no ? <span className="mono">{l.ref_no}</span> : '—'],
    ['Country / state', l.country || '—'],
    ['RFP documents', <Tag key="r" value={l.rfp_status && l.rfp_status !== 'Unknown' ? l.rfp_status : null} tone={riskTone('rfp_status', l.rfp_status)} />],
    ['Category', l.category],
    ['Source', l.source || '—'],
    ['Found on', fmtDate(l.found_on)]
  ];

  const assess: [string, React.ReactNode, string | null][] = [
    ['Business eligibility', <Tag key="e" value={l.eligibility} tone={riskTone('eligibility', l.eligibility)} />, l.eligibility_reason],
    ['Partner for scope', <Tag key="p" value={l.partner_needed} />, [l.scope_gaps && `Gaps: ${l.scope_gaps}`, l.suggested_partner && `Partner: ${l.suggested_partner}`].filter(Boolean).join(' · ') || null],
    ['Business model', <Tag key="b" value={l.business_model} tone={riskTone('business_model', l.business_model)} />, l.business_model_note],
    ['Scope', <Tag key="s" value={l.scope_type} />, l.uses_our_product ? `Uses our product: ${l.uses_our_product}` : null],
    ['Device regulation', <Tag key="g" value={l.regulatory_risk} tone={riskTone('regulatory_risk', l.regulatory_risk)} />, l.regulatory_note]
  ];
  const hasAssessment = assess.some(([, , note], i) => note || [l.eligibility, l.partner_needed, l.business_model, l.scope_type, l.regulatory_risk][i]);
  const risks = stripDaysLeft(l.risks);

  return (
    <>
      <div id="top">
        <Link href="/leads" className="muted" style={{ fontSize: 13 }}>← All leads</Link>
      </div>
      {msg ? <div className="note ok" role="status">{msg}</div> : null}
      {err ? <div className="note err" role="alert">{err}</div> : null}
      <div className="phead">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
          <Score value={l.fit_score} />
          <div style={{ minWidth: 0 }}>
            <div className="inline" style={{ marginBottom: 6 }}><TypeTag type={l.lead_type} /><VerificationPill v={l.verification} /><DecisionPill d={l.decision} /><span className="pill">{l.stage}</span><Priority p={l.priority} /></div>
            <h1 style={{ fontSize: 'clamp(20px, 2.4vw, 26px)', overflowWrap: 'anywhere' }}>{l.title}</h1>
            <p>{[l.funder_buyer, l.country].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        {l.url ? <a className="btn" href={l.url} target="_blank" rel="noopener noreferrer">Open notice ↗</a> : null}
      </div>

      <div className="detail">
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          <section className="card">
            <dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </section>

          {l.red_flags ? (
            <section className="card flags" aria-label="Red flags">
              <h3>Red flags</h3>
              <ul>{l.red_flags.split(/;\s*/).filter(Boolean).map(f => <li key={f}>{f}</li>)}</ul>
            </section>
          ) : null}

          {hasAssessment ? (
            <section className="card">
              <header><div><h2>Assessment</h2><p>Eligibility here is business only (registration, turnover, EMD, experience). Gaps in what we can deliver are under “Partner for scope”.</p></div></header>
              <dl className="assess">
                {assess.map(([k, v, note]) => <div key={k}><dt>{k}</dt><dd>{v}{note ? <span className="note-line">{note}</span> : null}</dd></div>)}
              </dl>
            </section>
          ) : null}

          <section className="card prose">
            {l.why_fit ? <div><h3>Why it fits</h3><p>{stripDaysLeft(l.why_fit)}</p></div> : null}
            {risks ? <div><h3>Risks</h3><p>{risks}</p></div> : null}
            {l.next_step ? <div><h3>Next step</h3><p>{stripDaysLeft(l.next_step)}</p></div> : null}
            {l.summary ? <div><h3>Summary from the source</h3><p>{l.summary}</p></div> : null}
            {!l.why_fit && !risks && !l.summary ? <p className="muted">No notes for this lead yet.</p> : null}
          </section>

          <section className="card">
            <header><h2>Activity</h2></header>
            <form action={commentAction} style={{ display: 'grid', gap: 8 }}>
              <input type="hidden" name="id" value={l.id} />
              <textarea name="comment" placeholder="Add a note: who you spoke to, what the client said, what the RFP asks for…" aria-label="Comment" required />
              <div><button className="btn btn-primary" type="submit">Add note</button></div>
            </form>
            <ol className="timeline">
              {activity.map(a => {
                const who = a.actor ? nameOf(members, a.actor) : 'Crawler / import';
                return (
                  <li key={a.id}>
                    <Avatar name={who} />
                    <div>
                      <div><b>{who}</b> {ACT_TEXT[a.action] || a.action}<span className="when"> · {fmtDateTime(a.created_at)}</span></div>
                      {a.action === 'comment' ? <div className="comment">{a.detail}</div> : <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="side">
          <section className="card">
            <header><div><h2>Is this lead correct?</h2><p>{l.verified_at ? <>Last checked by {nameOf(members, l.verified_by) || 'someone'} on {fmtDate(l.verified_at)}</> : 'Nobody has checked it yet.'}</p></div></header>
            <form action={verifyAction} style={{ display: 'grid', gap: 10 }} key={l.verification + (l.verification_note || '')}>
              <input type="hidden" name="id" value={l.id} />
              <div className="radios" role="radiogroup" aria-label="Check result">
                {VERIFICATIONS.map(v => (
                  <label key={v}><input type="radio" name="verification" value={v} defaultChecked={l.verification === v} />{V_TEXT[v]}</label>
                ))}
              </div>
              <label className="fld">Why (optional)
                <input type="text" name="note" defaultValue={l.verification_note || ''} placeholder="e.g. checked on GeM, scope is lab-only" />
              </label>
              <div><button className="btn btn-primary" type="submit">Save check</button></div>
            </form>
          </section>

          <section className="card">
            <header><div><h2>Do we go for it?</h2><p>{l.decided_at && l.decision !== 'Undecided' ? <>Decided by {nameOf(members, l.decided_by) || 'the team'} on {fmtDate(l.decided_at)}</> : 'A correct lead can still be a No-go. Reasons teach the crawler.'}</p></div></header>
            <form action={decisionAction} style={{ display: 'grid', gap: 10 }} key={l.decision + (l.decision_reason || '')}>
              <input type="hidden" name="id" value={l.id} />
              <div className="radios" role="radiogroup" aria-label="Decision">
                {DECISIONS.map(d => (
                  <label key={d}><input type="radio" name="decision" value={d} defaultChecked={l.decision === d} />{D_TEXT[d]}</label>
                ))}
              </div>
              <label className="fld">Reason (required for No-go)
                <textarea name="reason" defaultValue={l.decision_reason || ''} rows={3} placeholder="e.g. BOOT model: we fund vans upfront; EMD too high; state pays late" />
              </label>
              <div><button className="btn btn-primary" type="submit">Save decision</button></div>
            </form>
          </section>

          <section className="card">
            <header><div><h2>Owner</h2><p>{l.assigned_at ? <>Assigned {fmtDate(l.assigned_at)}</> : 'Pick who will work on it.'}</p></div></header>
            <div><Who name={nameOf(members, l.assigned_to)} /></div>
            <form action={assignAction} className="inline">
              <input type="hidden" name="id" value={l.id} />
              <select name="assigned_to" defaultValue={l.assigned_to || ''} aria-label="Assign to" key={l.assigned_to || 'none'}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
              <button className="btn" type="submit">Assign</button>
            </form>
          </section>

          <section className="card">
            <header><h2>Stage</h2></header>
            <form action={stageAction} className="inline">
              <input type="hidden" name="id" value={l.id} />
              <select name="stage" defaultValue={l.stage} aria-label="Stage" key={l.stage}>
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn" type="submit">Update</button>
            </form>
          </section>

          <section className="card">
            <header><div><h2>Pursuit</h2><p>{follow ? <>Next follow-up {fmtDate(l.next_followup)} · <span className={`due ${follow.tone}`}>{follow.text}</span></> : 'Applied date, client contact, pitch and follow-ups.'}</p></div></header>
            <form action={pursuitAction} className="stack" key={l.updated_at}>
              <input type="hidden" name="id" value={l.id} />
              <div className="two">
                <label className="fld">RFP documents
                  <select name="rfp_status" defaultValue={l.rfp_status || 'Unknown'}>{RFP_STATUSES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                </label>
                <label className="fld">Applied on<input type="date" name="applied_on" defaultValue={l.applied_on || ''} /></label>
              </div>
              <div className="two">
                <label className="fld">Client contact<input type="text" name="contact_name" defaultValue={l.contact_name || ''} placeholder="Name" /></label>
                <label className="fld">Role<input type="text" name="contact_role" defaultValue={l.contact_role || ''} placeholder="e.g. State NHM, procurement" /></label>
              </div>
              <div className="two">
                <label className="fld">Email<input type="email" name="contact_email" defaultValue={l.contact_email || ''} /></label>
                <label className="fld">Phone<input type="tel" name="contact_phone" defaultValue={l.contact_phone || ''} /></label>
              </div>
              <label className="fld">Next follow-up<input type="date" name="next_followup" defaultValue={l.next_followup || ''} /></label>
              <label className="fld">Pitch summary
                <textarea name="pitch_summary" rows={4} defaultValue={l.pitch_summary || ''} placeholder="What we proposed: solution, price, partners, differentiators" />
              </label>
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Log each conversation as a note under Activity.</p>
              <div><button className="btn btn-primary" type="submit">Save pursuit</button></div>
            </form>
          </section>

          <section className="card">
            <details>
              <summary><b>Edit details</b> <span className="muted">deadline, value, link…</span></summary>
              <form action={detailsAction} className="stack" style={{ marginTop: 12 }} key={l.updated_at}>
                <input type="hidden" name="id" value={l.id} />
                <label className="fld">Title<input type="text" name="title" defaultValue={l.title} required /></label>
                <div className="two">
                  <label className="fld">Deadline<input type="date" name="deadline" defaultValue={l.deadline?.slice(0, 10) || ''} /></label>
                  <label className="fld">Value<input type="text" name="amount" defaultValue={l.amount || ''} /></label>
                </div>
                <label className="fld">Deadline note<input type="text" name="deadline_note" defaultValue={l.deadline_note || ''} placeholder="e.g. Extended to 18 Oct by corrigendum 2" /></label>
                <div className="two">
                  <label className="fld">Buyer / funder<input type="text" name="funder_buyer" defaultValue={l.funder_buyer || ''} /></label>
                  <label className="fld">Country / state<input type="text" name="country" defaultValue={l.country || ''} /></label>
                </div>
                <label className="fld">Reference<input type="text" name="ref_no" defaultValue={l.ref_no || ''} /></label>
                <label className="fld">Link<input type="url" name="url" defaultValue={l.url || ''} placeholder="https://" /></label>
                <label className="fld">Summary<textarea name="summary" rows={3} defaultValue={l.summary || ''} /></label>
                <div><button className="btn btn-primary" type="submit">Save details</button></div>
              </form>
            </details>
          </section>
        </aside>
      </div>
    </>
  );
}
