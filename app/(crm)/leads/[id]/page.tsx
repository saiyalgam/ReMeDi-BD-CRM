import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assignAction, commentAction, stageAction, verifyAction } from '@/app/actions';
import { Avatar, Due, Priority, Score, TypeTag, VerificationPill, Who } from '@/components/ui';
import { getLead, listMembers } from '@/lib/data';
import { fmtDate, fmtDateTime, nameOf } from '@/lib/format';
import { STAGES, VERIFICATIONS, type Verification } from '@/lib/types';

const V_TEXT: Record<Verification, string> = { Unverified: 'Not checked', Correct: 'Correct lead', Incorrect: 'Wrong lead', Duplicate: 'Duplicate' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, members] = await Promise.all([getLead(Number(id)), listMembers()]);
  if (!res) notFound();
  const { lead: l, activity } = res;

  const facts: [string, React.ReactNode][] = [
    ['Deadline', <Due key="d" deadline={l.deadline} />],
    ['Value', l.amount || '—'],
    ['Reference', l.ref_no ? <span className="mono">{l.ref_no}</span> : '—'],
    ['Country / state', l.country || '—'],
    ['Eligibility', l.eligibility || '—'],
    ['Partner needed', l.partner_needed || '—'],
    ['Category', l.category],
    ['Source', l.source || '—'],
    ['Found on', fmtDate(l.found_on)]
  ];

  return (
    <>
      <div>
        <Link href="/leads" className="muted" style={{ fontSize: 13 }}>← All leads</Link>
      </div>
      <div className="phead">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
          <Score value={l.fit_score} />
          <div style={{ minWidth: 0 }}>
            <div className="inline" style={{ marginBottom: 6 }}><TypeTag type={l.lead_type} /><VerificationPill v={l.verification} /><span className="pill">{l.stage}</span><Priority p={l.priority} /></div>
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
          <section className="card prose">
            {l.why_fit ? <div><h3>Why it fits</h3><p>{l.why_fit}</p></div> : null}
            {l.risks ? <div><h3>Risks</h3><p>{l.risks}</p></div> : null}
            {l.suggested_partner ? <div><h3>Suggested partner</h3><p>{l.suggested_partner}</p></div> : null}
            {l.next_step ? <div><h3>Next step</h3><p>{l.next_step}</p></div> : null}
            {l.summary ? <div><h3>Summary from the source</h3><p>{l.summary}</p></div> : null}
            {!l.why_fit && !l.risks && !l.summary ? <p className="muted">No notes from the crawler for this lead.</p> : null}
          </section>
          <section className="card">
            <header><h2>Activity</h2></header>
            <form action={commentAction} style={{ display: 'grid', gap: 8 }}>
              <input type="hidden" name="id" value={l.id} />
              <textarea name="comment" placeholder="Add a note for the team (who you spoke to, what the RFP asks for…)" aria-label="Comment" required />
              <div><button className="btn btn-primary" type="submit">Add note</button></div>
            </form>
            <ol className="timeline">
              {activity.map(a => {
                const who = a.actor ? nameOf(members, a.actor) : 'Crawler';
                return (
                  <li key={a.id}>
                    <Avatar name={who} />
                    <div>
                      <div><b>{who}</b> {a.action === 'comment' ? 'added a note' : a.action === 'created' ? 'added this lead' : a.action === 'verified' ? 'checked it' : a.action === 'assigned' ? 'changed the owner' : 'moved the stage'}
                        <span className="when"> · {fmtDateTime(a.created_at)}</span></div>
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
            <form action={verifyAction} style={{ display: "grid", gap: 10 }} key={l.verification + (l.verification_note || "")}>
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
        </aside>
      </div>
    </>
  );
}
