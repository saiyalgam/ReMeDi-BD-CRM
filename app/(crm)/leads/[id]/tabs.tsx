import Link from 'next/link';
import {
  amendmentAction, approveAction, commentAction, decisionAction, detailsAction, docAction, docRequestAction, eligibilityAction, leadPartnerAction,
  meetingAction, pursuitAction, recommendAction, requirementAction, reviewAmendmentAction, risksAction, scoresAction, taskChangeAction, taskCreateAction
} from '@/app/actions';
import { Avatar, Badge, DecisionPill, Denied, Due, Empty, EligibilityPill, FollowUp, ReqPill, RiskPill, Tag, Who, riskTone } from '@/components/ui';
import { listCriteria, listEvents, listKb, listPartners, listRisks, listScores } from '@/lib/data-ext';
import { claimsById, kbStats } from '@/lib/kb';
import { DrivePanel } from './drive-panel';
import { daysLeft, fmtDate, fmtDateTime, nameOf, todayIST } from '@/lib/format';
import { stripDaysLeft } from '@/lib/leadtype';
import { can } from '@/lib/perm';
import { scoreKindOf } from '@/lib/views';
import {
  DOC_KINDS, DOC_STATUSES, ELIGIBILITY_STATUSES, GAP_TYPES, PARTNER_NEEDS, REQ_STATUSES, RFP_STATUSES, RISK_FACTORS, RISK_LEVELS, VALUE_BANDS,
  type Activity, type DeadlineRec, type DocRequest, type Lead, type LeadDoc, type LeadPartner, type Member, type Requirement, type Session, type Task
} from '@/lib/types';

interface Base { lead: Lead; session: Session; members?: Member[] }
const hid = (l: Lead) => <input type="hidden" name="id" value={l.id} />;

// ======================= Overview =======================
export function OverviewTab({ lead: l, session: s, openReqs, missingDocs, pendingAmend, openTasks }: Base & { openReqs: number; missingDocs: number; pendingAmend: number; openTasks: number }) {
  const steps: [boolean, string, string][] = [
    [l.verification !== 'Unverified', 'Verify the lead (Correct / Incorrect / Duplicate)', `/leads/${l.id}`],
    [l.eligibility_status !== 'Not assessed' && l.eligibility_status !== 'Needs clarification', `Assess eligibility clause by clause${openReqs ? ` (${openReqs} open)` : ''}`, `/leads/${l.id}?tab=eligibility`],
    [pendingAmend === 0, 'Verify reported deadline changes', `/leads/${l.id}?tab=source`],
    [missingDocs === 0, 'Get the missing tender documents', `/leads/${l.id}?tab=documents`],
    [l.decision !== 'Undecided', 'Record an approved Go / No-go with reasons', `/leads/${l.id}?tab=decision`],
    [!!l.assigned_to, 'Give it an owner', `/leads/${l.id}`],
    [l.decision !== 'Go' || openTasks > 0 || ['Submitted', 'Clarification', 'Won', 'Lost'].includes(l.stage), 'Plan preparation tasks', `/leads/${l.id}?tab=tasks`]
  ];
  const risks = stripDaysLeft(l.risks);
  return <>
    <section className="card">
      <header><div><h2>Where this stands</h2><p>The next open step comes first.</p></div></header>
      <ol className="openlist" style={{ listStyle: 'none', padding: 0 }}>
        {steps.map(([ok, label, href]) => <li key={label} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge tone={ok ? 'ok' : 'out'} icon={ok ? '✓' : '○'}>{ok ? 'Done' : 'To do'}</Badge>{ok ? <span className="muted">{label}</span> : <Link href={href}>{label}</Link>}</li>)}
      </ol>
    </section>
    <section className="card prose">
      <header><div><h2>Scope and summary</h2><p>From the source notice and the crawler’s first read. Check the tender document before relying on it.</p></div></header>
      {l.summary ? <div><h3>Summary from the source</h3><p>{l.summary}</p></div> : null}
      <dl className="assess">
        <div><dt>Scope type</dt><dd><Tag value={l.scope_type} /></dd></div>
        <div><dt>Uses our product</dt><dd><Tag value={l.uses_our_product} tone={riskTone('uses_our_product', l.uses_our_product)} /></dd></div>
        <div><dt>Business model</dt><dd><Tag value={l.business_model} tone={riskTone('business_model', l.business_model)} />{l.business_model_note ? <span className="note-line">{l.business_model_note}</span> : null}</dd></div>
        <div><dt>RFP documents</dt><dd><Tag value={l.rfp_status && l.rfp_status !== 'Unknown' ? l.rfp_status : null} tone={riskTone('rfp_status', l.rfp_status)} /></dd></div>
      </dl>
      {l.why_fit ? <div><h3>Why it may fit (crawler)</h3><p>{stripDaysLeft(l.why_fit)}</p></div> : null}
      {risks ? <div><h3>Risks noted (crawler)</h3><p>{risks}</p></div> : null}
      {l.red_flags ? <div><h3>Red flags</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{l.red_flags.split(/;\s*/).filter(Boolean).map(f => <li key={f}>{f}</li>)}</ul></div> : null}
      {!l.summary && !l.why_fit && !risks ? <Empty title="No scope notes yet">Open the notice and add a summary under “Edit details”.</Empty> : null}
    </section>
    {can(s, 'opp.edit') ? (
      <details className="drawer">
        <summary>Edit details <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>title, buyer, value, link, summary</span></summary>
        <form action={detailsAction} className="body stack" key={l.updated_at}>
          {hid(l)}
          <label className="fld">Title <span className="req">*</span><input type="text" name="title" defaultValue={l.title} required /></label>
          <div className="two">
            <label className="fld">Buyer / funder<input type="text" name="funder_buyer" defaultValue={l.funder_buyer || ''} /></label>
            <label className="fld">Country / state<input type="text" name="country" defaultValue={l.country || ''} /></label>
          </div>
          <div className="two">
            <label className="fld">Value as stated<input type="text" name="amount" defaultValue={l.amount || ''} placeholder="e.g. ₹7.5 Cr, EMD ₹7.5 lakh" /></label>
            <label className="fld">Value band (team estimate)<select name="value_band" defaultValue={l.value_band || ''}><option value="">Not set</option>{VALUE_BANDS.map(v => <option key={v}>{v}</option>)}</select></label>
          </div>
          <div className="two">
            <label className="fld">Buyer’s reference<input type="text" name="ref_no" defaultValue={l.ref_no || ''} /></label>
            <label className="fld">Link<input type="url" name="url" defaultValue={l.url || ''} placeholder="https://" /></label>
          </div>
          <label className="fld">Summary<textarea name="summary" rows={3} defaultValue={l.summary || ''} /></label>
          <p className="hint-text" style={{ margin: 0 }}>The deadline is changed on the Source &amp; amendments tab, so every change keeps its source and verification.</p>
          <div><button className="btn btn-primary" type="submit">Save details</button></div>
        </form>
      </details>
    ) : null}
  </>;
}

// ======================= Source & amendments =======================
export function SourceTab({ lead: l, session: s, members = [], deadlines }: Base & { deadlines: DeadlineRec[] }) {
  return <>
    <section className="card">
      <header><div><h2>Source</h2><p>Where this opportunity came from.</p></div>{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">Open notice ↗</a> : null}</header>
      <dl className="kv">
        <dt>Found</dt><dd>{fmtDate(l.found_on)} · {l.origin === 'crawler' ? 'by the crawler' : 'added by hand / import'}</dd>
        <dt>Source</dt><dd>{l.source || '—'}</dd>
        <dt>Buyer’s reference</dt><dd className="mono">{l.ref_no || '—'}</dd>
        <dt>CRM reference</dt><dd className="mono">{l.ref_code} <span className="muted">(permanent, never reused)</span></dd>
        <dt>Category</dt><dd>{l.category}</dd>
      </dl>
    </section>
    <section className="card">
      <header><div><h2>Deadline history</h2><p>The original date and every amendment are kept as separate records. The active deadline changes only when an amendment is verified.</p></div></header>
      <div className="tbl-wrap"><table className="tbl plain">
        <thead><tr><th>Kind</th><th>Date</th><th>Previous</th><th>Source</th><th>Status</th><th>Recorded</th><th /></tr></thead>
        <tbody>
          {deadlines.map(d => (
            <tr key={d.id}>
              <td>{d.kind}</td>
              <td className="mono">{fmtDate(d.deadline)}</td>
              <td className="mono muted">{d.previous ? fmtDate(d.previous) : '—'}</td>
              <td style={{ maxWidth: 260 }}>{d.source_url ? <a href={d.source_url} target="_blank" rel="noopener noreferrer">{d.source || 'link'} ↗</a> : d.source || <span className="muted">not given</span>}{d.note ? <div className="sub">{d.note}</div> : null}</td>
              <td>{d.rejected ? <Badge tone="neu" icon="✕">Rejected</Badge> : d.verified ? <Badge tone="ok" icon="✓">Verified</Badge> : <Badge tone="q" icon="?">Awaiting verification</Badge>}
                {d.verified_at && d.kind === 'Amendment' ? <div className="sub">{nameOf(members, d.verified_by) || 'reviewed file'}, {fmtDate(d.verified_at)}</div> : null}</td>
              <td className="sub">{fmtDateTime(d.created_at)}<br />{d.created_by ? nameOf(members, d.created_by) : 'Crawler / import'}</td>
              <td>{!d.verified && !d.rejected && can(s, 'deadline.verify') ? (
                <form action={reviewAmendmentAction} className="inline">
                  <input type="hidden" name="aid" value={d.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=source`} />
                  <button className="btn btn-sm btn-good" name="verdict" value="verify" type="submit">✓ Verify</button>
                  <button className="btn btn-sm" name="verdict" value="reject" type="submit">Reject</button>
                </form>
              ) : null}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {!deadlines.length ? <Empty title="No deadline recorded">Rolling call or not stated. Add one below if the notice gives a date.</Empty> : null}
      <p className="hint-text" style={{ margin: 0 }}>Days left are always computed from today and the active deadline ({l.deadline ? fmtDate(l.deadline) : 'none'}), never stored.</p>
    </section>
    {can(s, 'opp.edit') ? (
      <details className="drawer" open={!deadlines.length}>
        <summary>Record a deadline change or corrigendum</summary>
        <form action={amendmentAction} className="body stack">
          {hid(l)}
          <div className="two">
            <label className="fld">New deadline <span className="req">*</span><input type="date" name="deadline" required /></label>
            <label className="fld">Source <span className="req">*</span><input type="text" name="source" required placeholder="e.g. Corrigendum 2 on the state e-procurement portal" /></label>
          </div>
          <label className="fld">Link to the amendment<input type="url" name="source_url" placeholder="https://" /></label>
          <label className="fld">Note<input type="text" name="note" placeholder="Anything else that changed (scope, EMD, documents)" /></label>
          {can(s, 'deadline.verify') ? <label className="chk"><input type="checkbox" name="verify_now" value="yes" /> I checked the official source — verify now and update the active deadline</label>
            : <p className="hint-text" style={{ margin: 0 }}>Your role records the change; someone who can verify deadlines confirms it from the Review queue.</p>}
          <div><button className="btn btn-primary" type="submit">Record change</button></div>
        </form>
      </details>
    ) : null}
  </>;
}

// ======================= Eligibility =======================
export async function EligibilityTab({ lead: l, session: s, members = [], reqs, selected }: Base & { reqs: Requirement[]; selected: number | null }) {
  const [{ docs: kb }, claims, stats] = await Promise.all([listKb(), claimsById(reqs.map(r => r.evidence_claim || 0)), kbStats()]);
  const today = todayIST();
  const c = (st: string) => reqs.filter(r => r.status === st).length;
  const open = reqs.filter(r => r.status === 'Needs clarification' || (r.status === 'Not assessed' && r.necessity !== 'Optional'));
  const sel = reqs.find(r => r.id === selected) || null;
  const verdictCls = l.eligibility_status === 'Meets directly' ? 'ok' : l.eligibility_status === 'Does not meet' ? 'bad' : l.eligibility_status === 'Not assessed' ? '' : 'uncertain';
  const settled = reqs.length - open.length;
  const edit = can(s, 'assess.edit');
  const kbName = (id: number | null) => kb.find(d => d.id === id);
  // Evidence check (update 4): what is missing, expired or not yet confirmed. Shown beside each clause.
  const claimOf = (r: Requirement) => (r.evidence_claim ? claims.get(r.evidence_claim) : undefined);
  const expiredOf = (r: Requirement) => {
    const d = kbName(r.evidence_doc); const cl = claimOf(r);
    return (!!d?.expires_on && d.expires_on < today) || (!!cl?.doc_expires && cl.doc_expires < today) || cl?.claim_status === 'expired';
  };
  const noEvidence = reqs.filter(r => r.status === 'Meets' && !r.evidence_doc && !r.evidence_claim);
  const expiredEv = reqs.filter(expiredOf);
  const unconfirmed = reqs.filter(r => { const cl = claimOf(r); return !!cl && cl.review_status !== 'confirmed'; });
  const hiddenClaim = reqs.filter(r => r.evidence_claim && !claims.has(r.evidence_claim));
  return <>
    <section className={`verdict ${verdictCls}`} aria-labelledby="ev-h">
      <div className="inline" style={{ justifyContent: 'space-between', width: '100%' }}>
        <h2 id="ev-h">Eligibility: {l.eligibility_status === 'Not assessed' ? <span className="muted">not yet determined</span> : l.eligibility_status}</h2>
        <EligibilityPill e={l.eligibility_status} />
      </div>
      {l.eligibility_summary ? <p style={{ margin: 0 }}>{l.eligibility_summary}</p> : null}
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{reqs.length ? `${settled} of ${reqs.length} requirements settled.` : 'No requirements recorded yet.'} A definitive result is shown only when every mandatory requirement is assessed and each clarification is answered.</p>
      {reqs.length ? <>
        <div className="segbar" role="img" aria-label={`${c('Meets')} meet, ${c('Partner may cover')} partner may cover, ${c('Needs clarification')} need clarification, ${c('Not assessed')} not assessed, ${c('Does not meet')} do not meet`}>
          <span style={{ flex: c('Meets'), background: 'var(--teal)' }} /><span style={{ flex: c('Partner may cover'), background: 'var(--accent-mark)' }} /><span style={{ flex: c('Needs clarification'), background: 'var(--warning)' }} /><span style={{ flex: c('Not assessed'), background: 'var(--neutral-mark)' }} /><span style={{ flex: c('Does not meet'), background: 'var(--critical)' }} />
        </div>
        <div className="inline">{REQ_STATUSES.map(st => <span key={st} className="inline" style={{ gap: 4 }}><ReqPill s={st} /><b className="num">{c(st)}</b></span>)}</div>
      </> : null}
      {open.length ? <div><b style={{ fontSize: 13.5 }}>Open before a result can be recorded</b><ol className="openlist">{open.map(r => <li key={r.id}><Link href={`/leads/${l.id}?tab=eligibility&req=${r.id}#clause`}>{r.requirement}</Link>{r.question ? <> — <i>{r.question}</i></> : r.status === 'Not assessed' ? ' — not assessed' : ''}</li>)}</ol></div> : null}
      {noEvidence.length || expiredEv.length || unconfirmed.length || hiddenClaim.length ? (
        <div className="verdict uncertain" role="status"><b style={{ fontSize: 13.5 }}>Evidence check</b>
          <ul className="openlist" style={{ margin: 0 }}>
            {noEvidence.length ? <li>{noEvidence.length} requirement(s) marked “Meets” without linked evidence.</li> : null}
            {expiredEv.length ? <li><span style={{ color: 'var(--critical-text)' }}>{expiredEv.length} requirement(s) rely on expired evidence</span> — renew the document or link a current one.</li> : null}
            {unconfirmed.length ? <li>{unconfirmed.length} cited claim(s) are machine-extracted and not yet confirmed by a reviewer.</li> : null}
            {hiddenClaim.length ? <li>{hiddenClaim.length} cited claim(s) are restricted and hidden for your role.</li> : null}
          </ul>
        </div>
      ) : null}
      {l.eligibility ? <p className="hint-text" style={{ margin: 0 }}>Crawler’s first guess (not reviewed): <b>{l.eligibility}</b>{l.eligibility_reason ? ` — ${l.eligibility_reason}` : ''}. A consortium being <i>allowed</i> does not mean a partner is <i>needed</i>.</p> : null}
    </section>

    <section className="card" aria-labelledby="rq-h">
      <header><div><h2 id="rq-h">Requirement checklist</h2><p>Select a requirement to see its tender wording and evidence side by side.</p></div></header>
      {reqs.length ? (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Requirement</th><th>Tender wording / threshold</th><th>Source</th><th>Company evidence</th><th>Status</th><th>Reviewer note</th></tr></thead>
          <tbody>
            {reqs.map(r => (
              <tr key={r.id} className={r.id === selected ? 'sel' : ''}>
                <td className="t" style={{ minWidth: 150 }}><Link href={`/leads/${l.id}?tab=eligibility&req=${r.id}#clause`} aria-current={r.id === selected ? 'true' : undefined}>{r.requirement}</Link><div className="sub">{r.necessity}{r.extracted ? ' · extracted, unreviewed' : ''}</div></td>
                <td style={{ minWidth: 200, fontSize: 13 }}>{r.excerpt || <span className="muted">—</span>}</td>
                <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.source_doc || '—'}<div className="sub">{r.source_ref || ''}</div></td>
                <td style={{ minWidth: 180, fontSize: 13 }}>
                  {kbName(r.evidence_doc) ? <Link href={`/knowledge/${r.evidence_doc}`}>{kbName(r.evidence_doc)!.name}</Link> : null}
                  {claimOf(r) ? <div className="sub">“{claimOf(r)!.quote || claimOf(r)!.statement}” — <Link href={`/knowledge/${claimOf(r)!.document_id}#c${claimOf(r)!.id}`}>{claimOf(r)!.doc_name || 'source'}, {claimOf(r)!.locator}</Link></div> : null}
                  {r.evidence ? <div className={kbName(r.evidence_doc) || claimOf(r) ? 'sub' : ''}>{r.evidence}</div> : !r.evidence_doc && !r.evidence_claim ? <span className="flag f-doc">No evidence linked</span> : null}
                  {expiredOf(r) ? <div><Badge tone="bad" icon="!">Expired evidence</Badge></div> : claimOf(r) && claimOf(r)!.review_status !== 'confirmed' ? <div><Badge tone="warn">Claim not confirmed</Badge></div> : null}
                </td>
                <td><ReqPill s={r.status} />{r.confidence ? <div className="sub">{r.confidence} confidence</div> : null}</td>
                <td style={{ minWidth: 160, fontSize: 13 }} className="muted">{r.question ? <><b style={{ color: 'var(--warning-text)' }}>Q:</b> {r.question}<br /></> : null}{r.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <Empty title="No requirements yet">Add the eligibility clauses from the tender document: turnover, experience, registrations, certifications, consortium rules.</Empty>}
    </section>

    {sel ? (
      <section id="clause" aria-labelledby="cl-h" style={{ display: 'grid', gap: 10 }}>
        <h2 id="cl-h" style={{ margin: 0, fontSize: 16 }}>{sel.requirement} — source and evidence</h2>
        <div className="clause">
          <div>
            <div className="inline" style={{ justifyContent: 'space-between' }}><b>Tender clause</b><span className="muted" style={{ fontSize: 12.5 }}>{[sel.source_doc, sel.source_ref].filter(Boolean).join(' · ') || 'Source not recorded'}</span></div>
            {sel.excerpt ? <div className="quote">{sel.excerpt}</div> : <div className="draftbox">No tender wording recorded. Copy the exact clause so reviewers can check it.</div>}
            <span className="inline"><Badge tone="out">{sel.necessity}</Badge>{sel.partner_need !== 'Not indicated' ? <Badge tone="info">{sel.partner_need}</Badge> : null}{sel.gap_type ? <Badge tone="neu">Gap: {sel.gap_type}</Badge> : null}</span>
          </div>
          <div>
            <b>Company evidence</b>
            {kbName(sel.evidence_doc) ? <div className="verdict"><b>{kbName(sel.evidence_doc)!.name}</b><span className="muted" style={{ fontSize: 13 }}>{kbName(sel.evidence_doc)!.entity} · {kbName(sel.evidence_doc)!.approval}{kbName(sel.evidence_doc)!.expires_on ? ` · expires ${fmtDate(kbName(sel.evidence_doc)!.expires_on)}` : ''}</span></div> : null}
            {claimOf(sel) ? (
              <div className="verdict">
                <span className="muted" style={{ fontSize: 12.5 }}>Cited claim #{claimOf(sel)!.id} · {claimOf(sel)!.claim_status} · review {claimOf(sel)!.review_status.replace('_', ' ')}</span>
                <div className="quote">{claimOf(sel)!.quote || claimOf(sel)!.statement}</div>
                <span style={{ fontSize: 12.5 }}>Source: <Link href={`/knowledge/${claimOf(sel)!.document_id}#c${claimOf(sel)!.id}`}>{claimOf(sel)!.doc_name || 'document'}</Link> — {claimOf(sel)!.locator}</span>
              </div>
            ) : sel.evidence_claim ? <Denied>The cited claim is restricted and hidden for your role.</Denied> : null}
            {expiredOf(sel) ? <div className="verdict bad"><b style={{ fontSize: 13.5 }}>! Evidence has expired</b><span style={{ fontSize: 13.5 }}>Do not rely on it in a bid until a current version is linked.</span></div> : null}
            {sel.evidence ? <p style={{ margin: 0 }}>{sel.evidence}</p> : !sel.evidence_doc && !sel.evidence_claim ? <div className="draftbox">No evidence linked yet. <Link href={`/knowledge?q=${encodeURIComponent(sel.requirement)}`}>Search the knowledge base</Link> for a cited passage.</div> : null}
            <div className="inline"><ReqPill s={sel.status} />{sel.confidence ? <Badge tone="neu">{sel.confidence} confidence</Badge> : null}</div>
            {sel.question ? <div className="verdict uncertain"><b style={{ fontSize: 13.5 }}>? Why this is uncertain</b><span style={{ fontSize: 13.5 }}>{sel.question}</span></div> : null}
            <span className="muted" style={{ fontSize: 12.5 }}>Last reviewed by {nameOf(members, sel.reviewer) || '—'} · {fmtDateTime(sel.updated_at)}</span>
          </div>
        </div>
        {edit ? <RequirementForm l={l} r={sel} kb={kb} claimsOn={stats.installed} /> : <Denied>Your role cannot edit requirements.</Denied>}
      </section>
    ) : null}

    {edit ? (
      <details className="drawer" open={!reqs.length}>
        <summary>+ Add a requirement</summary>
        <div className="body"><RequirementForm l={l} r={null} kb={kb} claimsOn={stats.installed} /></div>
      </details>
    ) : null}

    {edit ? (
      <section className="card" aria-labelledby="res-h">
        <header><div><h2 id="res-h">Record the eligibility result</h2><p>Eligibility is not the decision to pursue. A correct, eligible lead can still be a No-go.</p></div></header>
        <form action={eligibilityAction} className="stack" key={l.eligibility_status + (l.eligibility_summary || '')}>
          {hid(l)}
          <div className="two">
            <label className="fld">Result<select name="eligibility_status" defaultValue={l.eligibility_status}>{ELIGIBILITY_STATUSES.map(e => <option key={e}>{e}</option>)}</select></label>
            <label className="fld">Partner need (from the tender)<select name="partner_need" defaultValue={l.partner_need}>{PARTNER_NEEDS.map(p => <option key={p}>{p}</option>)}</select></label>
          </div>
          <label className="fld">Summary <span className="hint-text">— which clauses decide it and what is still open</span><textarea name="eligibility_summary" rows={3} defaultValue={l.eligibility_summary || ''} /></label>
          <p className="hint-text" style={{ margin: 0 }}>“Meets directly” is blocked while a mandatory requirement is open. “Eligible with partner” needs a requirement marked “Partner may cover”.</p>
          <div><button className="btn btn-primary" type="submit">Save result</button></div>
        </form>
      </section>
    ) : null}
  </>;
}

function RequirementForm({ l, r, kb, claimsOn }: { l: Lead; r: Requirement | null; kb: { id: number; name: string; entity: string; approval: string }[]; claimsOn: boolean }) {
  return (
    <form action={requirementAction} className="stack card" key={r?.updated_at || 'new'}>
      {hid(l)}{r ? <input type="hidden" name="rid" value={r.id} /> : null}
      {r ? <h3 className="h" style={{ margin: 0 }}>Edit this requirement</h3> : null}
      <div className="two">
        <label className="fld">Requirement <span className="req">*</span><input type="text" name="requirement" defaultValue={r?.requirement || ''} required placeholder="e.g. Average annual turnover" /></label>
        <label className="fld">Necessity<select name="necessity" defaultValue={r?.necessity || 'Unclear'}><option>Mandatory</option><option>Optional</option><option>Unclear</option></select></label>
      </div>
      <label className="fld">Tender wording / threshold<textarea name="excerpt" rows={2} defaultValue={r?.excerpt || ''} placeholder="Copy the exact clause" /></label>
      <div className="two">
        <label className="fld">Source document<input type="text" name="source_doc" defaultValue={r?.source_doc || ''} placeholder="e.g. RFP Vol. 1" /></label>
        <label className="fld">Page / section / clause<input type="text" name="source_ref" defaultValue={r?.source_ref || ''} placeholder="e.g. §4.2(b), p. 18" /></label>
      </div>
      <div className="two">
        <label className="fld">Evidence record<select name="evidence_doc" defaultValue={r?.evidence_doc ? String(r.evidence_doc) : ''}><option value="">None linked</option>{kb.map(d => <option key={d.id} value={d.id}>{d.name} ({d.entity}, {d.approval})</option>)}</select></label>
        <label className="fld">Evidence note<input type="text" name="evidence" defaultValue={r?.evidence || ''} placeholder="What the evidence shows" /></label>
      </div>
      {claimsOn ? <label className="fld">Cited claim number <span className="hint-text">— from <Link href={`/knowledge?view=claims${r ? `&q=${encodeURIComponent(r.requirement.split(/\s+/).slice(0, 3).join(' '))}` : ''}`} target="_blank">Knowledge base › Claims</Link>; the quote and page appear beside the clause</span><input type="number" name="evidence_claim" min={1} defaultValue={r?.evidence_claim ? String(r.evidence_claim) : ''} placeholder="e.g. 1234" /></label> : null}
      <div className="two">
        <label className="fld">Status<select name="status" defaultValue={r?.status || 'Not assessed'}>{REQ_STATUSES.map(st => <option key={st}>{st}</option>)}</select></label>
        <label className="fld">Confidence<select name="confidence" defaultValue={r?.confidence || ''}><option value="">—</option><option>High</option><option>Medium</option><option>Low</option></select></label>
      </div>
      <label className="fld">Open question <span className="hint-text">(required for “Needs clarification”)</span><input type="text" name="question" defaultValue={r?.question || ''} placeholder="The exact question to ask the buyer or the team" /></label>
      <div className="two">
        <label className="fld">Partner need for this clause<select name="partner_need" defaultValue={r?.partner_need || 'Not indicated'}><option>Not indicated</option><option>Required by tender</option><option>Recommended for delivery</option></select></label>
        <label className="fld">Gap type<select name="gap_type" defaultValue={r?.gap_type || ''}><option value="">—</option>{GAP_TYPES.map(g => <option key={g}>{g}</option>)}</select></label>
      </div>
      <label className="fld">Reviewer note<input type="text" name="note" defaultValue={r?.note || ''} /></label>
      <div className="inline">
        <button className="btn btn-primary" type="submit">{r ? 'Save requirement' : 'Add requirement'}</button>
        {r ? <button className="btn btn-bad" type="submit" name="op" value="delete" formNoValidate>Remove</button> : null}
      </div>
    </form>
  );
}

// ======================= Fit & risk =======================
export async function AssessmentTab({ lead: l, session: s, members = [] }: Base) {
  const [risks, criteria, scores] = await Promise.all([listRisks(l.id), listCriteria(), listScores(l.id)]);
  const kind = scoreKindOf(l);
  const crit = criteria.filter(c => c.kind === kind && c.active);
  const scored = crit.map(c => ({ c, s: scores.find(x => x.criterion_id === c.id) }));
  const wsum = scored.reduce((a, x) => a + (x.s?.score != null ? x.c.weight : 0), 0);
  const total = wsum ? Math.round(scored.reduce((a, x) => a + (x.s?.score != null ? x.s.score * x.c.weight : 0), 0) / (wsum * 5) * 100) : null;
  const edit = can(s, 'assess.edit');
  return <>
    <section className="card">
      <header><div><h2>Commercial and delivery risk</h2><p>Assess only what the source supports; leave “Unclear” and say what is missing otherwise.</p></div></header>
      <form action={risksAction} className="stack">
        {hid(l)}
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Factor</th><th>Level</th><th>What the source says</th><th>Source</th></tr></thead>
          <tbody>
            {RISK_FACTORS.map((f, i) => {
              const r = risks.find(x => x.factor === f);
              return (
                <tr key={f}>
                  <td style={{ minWidth: 200, fontWeight: 600, fontSize: 13.5 }}>{f}{r ? <div className="sub">{nameOf(members, r.updated_by)} · {fmtDate(r.updated_at)}</div> : null}</td>
                  <td>{edit ? <select name={`level_${i}`} defaultValue={r?.level || ''} aria-label={`Risk level: ${f}`}><option value="">Not assessed</option>{RISK_LEVELS.map(v => <option key={v}>{v}</option>)}</select> : r ? <RiskPill l={r.level} /> : <span className="muted">—</span>}</td>
                  <td>{edit ? <input type="text" name={`note_${i}`} defaultValue={r?.note || ''} aria-label={`Note: ${f}`} style={{ width: '100%' }} /> : r?.note}</td>
                  <td>{edit ? <input type="text" name={`source_${i}`} defaultValue={r?.source || ''} aria-label={`Source: ${f}`} placeholder="doc · page" style={{ width: 140 }} /> : r?.source}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {edit ? <div><button className="btn btn-primary" type="submit">Save risk assessment</button></div> : <Denied>Your role can read but not edit the risk assessment.</Denied>}
      </form>
    </section>

    <section className="card">
      <header><div><h2>Scorecard: {kind}</h2><p>Criteria and weights are set by admins per opportunity type. The score assists the review; it never makes the decision.</p></div>
        <span className="inline"><Badge tone={total == null ? 'neu' : total >= 70 ? 'ok' : total >= 45 ? 'warn' : 'bad'}>{total == null ? 'Not scored' : `${total} / 100`}</Badge><span className="muted" style={{ fontSize: 12.5 }}>Crawler fit: {l.fit_score ?? '—'}</span></span></header>
      {crit.length ? (
        <form action={scoresAction} className="stack">
          {hid(l)}
          <div className="tbl-wrap"><table className="tbl plain">
            <thead><tr><th>Criterion</th><th className="r">Weight</th><th>Score 0–5</th><th>Rationale (required)</th><th>Evidence</th></tr></thead>
            <tbody>
              {scored.map(({ c, s: sc }) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 220 }}><input type="hidden" name="criterion" value={c.id} /><b style={{ fontSize: 13.5 }}>{c.criterion}</b>{c.guidance ? <div className="sub">{c.guidance}</div> : null}</td>
                  <td className="r">{c.weight}</td>
                  <td>{edit ? <select name={`score_${c.id}`} defaultValue={sc?.score != null ? String(sc.score) : ''} aria-label={`Score: ${c.criterion}`}><option value="">—</option>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select> : sc?.score ?? '—'}</td>
                  <td>{edit ? <input type="text" name={`why_${c.id}`} defaultValue={sc?.rationale || ''} aria-label={`Rationale: ${c.criterion}`} style={{ width: '100%', minWidth: 180 }} /> : sc?.rationale}</td>
                  <td>{edit ? <input type="text" name={`ev_${c.id}`} defaultValue={sc?.evidence || ''} aria-label={`Evidence: ${c.criterion}`} style={{ width: 150 }} /> : sc?.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {edit ? <div><button className="btn btn-primary" type="submit">Save scorecard</button></div> : null}
        </form>
      ) : <Empty title="No criteria for this type">An admin can add them under Settings → Scoring rules.</Empty>}
    </section>

    <section className="card">
      <header><div><h2>Crawler assessment (unreviewed)</h2><p>The crawler’s first read. Use it as a starting point only.</p></div></header>
      <dl className="assess">
        <div><dt>Business eligibility (crawler)</dt><dd><Tag value={l.eligibility} tone={riskTone('eligibility', l.eligibility)} />{l.eligibility_reason ? <span className="note-line">{l.eligibility_reason}</span> : null}</dd></div>
        <div><dt>Partner for scope (crawler)</dt><dd><Tag value={l.partner_needed} />{[l.scope_gaps && `Gaps: ${l.scope_gaps}`, l.suggested_partner && `Suggested: ${l.suggested_partner}`].filter(Boolean).map(x => <span key={x} className="note-line">{x}</span>)}</dd></div>
        <div><dt>Device regulation</dt><dd><Tag value={l.regulatory_risk} tone={riskTone('regulatory_risk', l.regulatory_risk)} />{l.regulatory_note ? <span className="note-line">{l.regulatory_note}</span> : null}</dd></div>
        <div><dt>Business model</dt><dd><Tag value={l.business_model} tone={riskTone('business_model', l.business_model)} />{l.business_model_note ? <span className="note-line">{l.business_model_note}</span> : null}</dd></div>
      </dl>
    </section>
  </>;
}

// ======================= Go / No-go =======================
export function DecisionTab({ lead: l, session: s, members = [], reqs, activity }: Base & { reqs: Requirement[]; activity: Activity[] }) {
  const unsettled = l.eligibility_status === 'Not assessed' || l.eligibility_status === 'Needs clarification' || reqs.some(r => r.status === 'Needs clarification');
  const history = activity.filter(a => ['decision', 'recommendation', 'approval', 'eligibility'].includes(a.action));
  return <>
    <section className={`verdict ${l.decision === 'Go' ? 'ok' : l.decision === 'No-go' ? 'bad' : l.approval_status === 'Pending' ? 'uncertain' : ''}`}>
      <div className="inline" style={{ justifyContent: 'space-between', width: '100%' }}><h2>Pursuit decision</h2><DecisionPill d={l.decision} approval={l.approval_status} always /></div>
      {l.decision !== 'Undecided' ? <p style={{ margin: 0 }}><b>{l.decision}</b> — {l.decision_reason} <span className="muted">({nameOf(members, l.decided_by) || 'recorded'}, {fmtDate(l.decided_at)})</span></p> : <p style={{ margin: 0 }} className="muted">No decision recorded. Recommend one with reasons; someone allowed to approve confirms it.</p>}
      {l.approval_status === 'Pending' ? <p style={{ margin: 0 }}>{nameOf(members, l.recommended_by)} recommended <b>{l.recommended_decision}</b> on {fmtDate(l.recommended_at)}: {l.recommendation_reason}</p> : null}
      {l.approval_status === 'Returned' ? <p style={{ margin: 0, color: 'var(--warning-text)' }}>Returned: {l.approval_note}</p> : null}
      {unsettled ? <div className="draftbox">? Eligibility is not settled ({l.eligibility_status}). A decision now is conditional on the open clarifications — say so in the reason.</div> : null}
      {l.verification !== 'Correct' ? <div className="draftbox">The lead is not verified as Correct yet. Verify it before recommending a decision.</div> : null}
    </section>

    {l.approval_status === 'Pending' && can(s, 'decision.approve') ? (
      <section className="card" aria-labelledby="ap-h">
        <header><div><h2 id="ap-h">Approve or return</h2><p>Approving records the decision as yours, with the recommender’s reason and your note.</p></div></header>
        <form action={approveAction} className="stack">
          {hid(l)}
          <label className="fld">Your note <span className="hint-text">(required when returning)</span><textarea name="note" rows={2} placeholder="Conditions, or what is missing" /></label>
          <div className="inline"><button className="btn btn-primary" name="verdict" value="approve" type="submit">Approve {l.recommended_decision}</button><button className="btn" name="verdict" value="return" type="submit">Return for changes</button></div>
        </form>
      </section>
    ) : null}

    {can(s, 'decision.recommend') ? (
      <section className="card" aria-labelledby="rc-h">
        <header><div><h2 id="rc-h">Recommend Go or No-go</h2><p>Give the reason and the evidence. It goes to the approval queue{can(s, 'decision.approve') ? ' (you can also approve it yourself below)' : ''}.</p></div></header>
        <form action={recommendAction} className="stack" key={(l.recommended_decision || '') + l.approval_status}>
          {hid(l)}
          <div className="radios" role="radiogroup" aria-label="Recommendation">
            <label><input type="radio" name="recommendation" value="Go" defaultChecked={l.recommended_decision === 'Go'} />▶ Recommend Go</label>
            <label><input type="radio" name="recommendation" value="No-go" defaultChecked={l.recommended_decision === 'No-go'} />■ Recommend No-go</label>
          </div>
          <label className="fld">Rationale and evidence <span className="req">*</span><textarea name="reason" rows={4} defaultValue={l.approval_status === 'Pending' ? l.recommendation_reason || '' : ''} placeholder="e.g. Strategic fit with existing programme; proceed only if the turnover clarification is favourable (see Eligibility). EMD and payment terms reviewed on Fit & risk." required /></label>
          <p className="hint-text" style={{ margin: 0 }}>No-go reasons are kept as learning data: the crawler reads recent reasons before scoring similar leads. Criteria never change automatically.</p>
          <div><button className="btn btn-primary" type="submit">Send for approval</button></div>
        </form>
      </section>
    ) : <Denied>Your role cannot recommend a decision.</Denied>}

    {can(s, 'decision.approve') ? (
      <details className="drawer">
        <summary>Record a decision directly <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(approvers only)</span></summary>
        <form action={decisionAction} className="body stack" key={l.decision + (l.decision_reason || '')}>
          {hid(l)}
          <div className="radios" role="radiogroup" aria-label="Decision">
            {(['Undecided', 'Go', 'No-go'] as const).map(d => <label key={d}><input type="radio" name="decision" value={d} defaultChecked={l.decision === d} />{d}</label>)}
          </div>
          <label className="fld">Reason <span className="req">*</span><textarea name="reason" rows={3} defaultValue={l.decision_reason || ''} /></label>
          <div><button className="btn" type="submit">Save decision</button></div>
        </form>
      </details>
    ) : null}

    <section className="card">
      <header><h2>Decision history</h2></header>
      {history.length ? <ol className="timeline">{history.map(a => { const who = a.actor ? nameOf(members, a.actor) : 'Crawler / import'; return <li key={a.id}><Avatar name={who} /><div><b>{who}</b> <span className="when">{fmtDateTime(a.created_at)}</span><div style={{ fontSize: 13.5 }}>{a.detail}</div></div></li>; })}</ol> : <Empty title="No decision history yet" />}
    </section>
  </>;
}

// ======================= Partners =======================
export async function PartnersTab({ lead: l, session: s, reqs, links }: Base & { reqs: Requirement[]; links: LeadPartner[] }) {
  const partners = await listPartners();
  const gaps = reqs.filter(r => r.partner_need !== 'Not indicated' || r.status === 'Partner may cover');
  const pName = (id: number) => partners.find(p => p.id === id);
  if (!can(s, 'partners.read')) return <Denied>Your role cannot see the partner directory.</Denied>;
  return <>
    <section className="card">
      <header><div><h2>Partner need</h2><p>“Required by the tender” and “recommended for delivery” are kept apart. A consortium being allowed is not a need.</p></div></header>
      <dl className="kv"><dt>Tender requirement</dt><dd>{l.partner_need}</dd><dt>Crawler suggestion</dt><dd>{l.partner_needed || '—'}{l.scope_gaps ? ` · gaps: ${l.scope_gaps}` : ''}{l.suggested_partner ? ` · suggested: ${l.suggested_partner}` : ''} <span className="muted">(unreviewed)</span></dd></dl>
      {gaps.length ? (
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Requirement creating the need</th><th>Need</th><th>Gap type</th><th>Status</th></tr></thead>
          <tbody>{gaps.map(r => <tr key={r.id}><td><Link href={`/leads/${l.id}?tab=eligibility&req=${r.id}#clause`}>{r.requirement}</Link></td><td>{r.partner_need}</td><td>{r.gap_type || '—'}</td><td><ReqPill s={r.status} /></td></tr>)}</tbody>
        </table></div>
      ) : <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No requirement is marked as needing a partner. Mark the clause on the Eligibility tab first, so every partner suggestion explains which gap it covers.</p>}
    </section>
    <section className="card">
      <header><div><h2>Partners on this opportunity</h2></div></header>
      {links.length ? (
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Partner</th><th>Need</th><th>Gap it covers</th><th>Evidence behind the match</th><th>Status</th><th /></tr></thead>
          <tbody>{links.map(lp => { const p = pName(lp.partner_id); return (
            <tr key={lp.id}>
              <td><Link href={`/partners/${lp.partner_id}`}><b>{p?.name || 'Partner'}</b></Link>{p ? <div className="sub">{p.verification} · {p.relationship}</div> : null}</td>
              <td>{lp.need}</td><td>{lp.gap_type ? <b>{lp.gap_type}: </b> : null}{lp.gap_note}</td><td>{lp.evidence || <span className="flag f-doc">No evidence</span>}</td>
              <td>{lp.status}</td>
              <td>{can(s, 'assess.edit') ? <form action={leadPartnerAction}>{hid(l)}<input type="hidden" name="lpid" value={lp.id} /><button className="btn btn-sm btn-bad" name="op" value="remove" type="submit">Remove</button></form> : null}</td>
            </tr>); })}</tbody>
        </table></div>
      ) : <Empty title="No partners linked" />}
      {can(s, 'assess.edit') ? (
        <details className="drawer">
          <summary>+ Link a partner to a gap</summary>
          <form action={leadPartnerAction} className="body stack">
            {hid(l)}
            <div className="two">
              <label className="fld">Partner <span className="req">*</span><select name="partner_id" required defaultValue=""><option value="" disabled>Choose…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.verification !== 'Verified' ? ` (${p.verification.toLowerCase()})` : ''}</option>)}</select></label>
              <label className="fld">Need<select name="need" defaultValue="Recommended for delivery"><option>Required by tender</option><option>Recommended for delivery</option></select></label>
            </div>
            <div className="two">
              <label className="fld">Gap type<select name="gap_type" defaultValue=""><option value="">—</option>{GAP_TYPES.map(g => <option key={g}>{g}</option>)}</select></label>
              <label className="fld">Status<select name="status" defaultValue="Suggested"><option>Suggested</option><option>Contacted</option><option>Committed</option><option>Declined</option></select></label>
            </div>
            <label className="fld">Which requirement or delivery gap does it cover? <span className="req">*</span><input type="text" name="gap_note" required placeholder="e.g. §6.3 field staff in every district; we have no presence in 3 districts" /></label>
            <label className="fld">Evidence behind the match<input type="text" name="evidence" placeholder="e.g. their registration certificate; prior project letter (link in Knowledge base)" /></label>
            <p className="hint-text" style={{ margin: 0 }}>Unverified partners can be suggested, but say so in the proposal until their identity and capabilities are confirmed.</p>
            <div><button className="btn btn-primary" type="submit">Link partner</button> <Link className="btn" href="/partners">Partner directory</Link></div>
          </form>
        </details>
      ) : null}
    </section>
  </>;
}

// ======================= Documents =======================
export function DocumentsTab({ lead: l, session: s, members = [], docs, requests }: Base & { docs: LeadDoc[]; requests: DocRequest[] }) {
  if (!can(s, 'docs.read')) return <Denied>Your role cannot see tender documents.</Denied>;
  const edit = can(s, 'docs.edit');
  const missing = docs.filter(d => d.status === 'Missing' || d.status === 'Login needed');
  return <>
    <DrivePanel lead={l} session={s} members={members} />
    <section className="card">
      <header><div><h2>Tender documents</h2><p>RFP, corrigenda, annexures and clarifications, with version and review status.{can(s, 'docs.read_restricted') ? '' : ' Restricted documents are hidden for your role.'}</p></div></header>
      {docs.length ? (
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Document</th><th>Kind · version</th><th>Status</th><th>Review</th><th>Dates</th></tr></thead>
          <tbody>{docs.map(d => (
            <tr key={d.id}>
              <td style={{ minWidth: 200 }}>{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer"><b>{d.name}</b> ↗</a> : <b>{d.name}</b>}{d.restricted ? <> <Badge tone="neu">Restricted</Badge></> : null}{d.note ? <div className="sub">{d.note}</div> : null}<div className="sub">Added by {nameOf(members, d.added_by) || '—'}</div></td>
              <td>{d.kind}{d.version ? ` · ${d.version}` : ''}</td>
              <td>{edit ? <form action={docAction} className="inline">{hid(l)}<input type="hidden" name="did" value={d.id} /><select name="status" defaultValue={d.status} aria-label={`Status of ${d.name}`}>{DOC_STATUSES.map(x => <option key={x}>{x}</option>)}</select><button className="btn btn-sm" type="submit">Save</button></form> : <Badge tone={d.status === 'Missing' ? 'bad' : d.status === 'Available' || d.status === 'Received' ? 'ok' : 'warn'}>{d.status}</Badge>}</td>
              <td>{edit ? <form action={docAction} className="inline">{hid(l)}<input type="hidden" name="did" value={d.id} /><select name="review_status" defaultValue={d.review_status} aria-label={`Review of ${d.name}`}><option>Not reviewed</option><option>Reviewed</option><option>Superseded</option></select><button className="btn btn-sm" type="submit">Save</button></form> : d.review_status}</td>
              <td className="sub">{d.issued_on ? `Issued ${fmtDate(d.issued_on)}` : ''}{d.expires_on ? <><br />{(daysLeft(d.expires_on) ?? 0) < 0 ? <span className="flag f-doc">Expired {fmtDate(d.expires_on)}</span> : `Valid to ${fmtDate(d.expires_on)}`}</> : null}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty title="No documents recorded">Add the RFP and any annexures, or record one as missing.</Empty>}
      {edit ? (
        <details className="drawer">
          <summary>+ Add a document or record a missing one</summary>
          <form action={docAction} className="body stack">
            {hid(l)}
            <div className="two">
              <label className="fld">Name <span className="req">*</span><input type="text" name="name" required placeholder="e.g. Annexure F — Bill of quantities" /></label>
              <label className="fld">Kind<select name="kind" defaultValue="RFP">{DOC_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
            </div>
            <div className="two">
              <label className="fld">Status<select name="status" defaultValue="Available">{DOC_STATUSES.map(k => <option key={k}>{k}</option>)}</select></label>
              <label className="fld">Version<input type="text" name="version" placeholder="e.g. v2 / Corrigendum 1" /></label>
            </div>
            <label className="fld">Link<input type="url" name="url" placeholder="https://" /></label>
            <div className="two"><label className="fld">Issued on<input type="date" name="issued_on" /></label><label className="fld">Valid until<input type="date" name="expires_on" /></label></div>
            <label className="fld">Note<input type="text" name="note" /></label>
            {can(s, 'docs.read_restricted') ? <label className="chk"><input type="checkbox" name="restricted" /> Restricted (financial, statutory, banking or personal)</label> : null}
            <div><button className="btn btn-primary" type="submit">Save document</button></div>
          </form>
        </details>
      ) : null}
    </section>

    <section className="card">
      <header><div><h2>Requests for missing documents</h2><p>The CRM prepares drafts and reminders. A person reviews each one and sends it from their own mailbox or the portal.</p></div></header>
      {requests.map(r => (
        <details key={r.id} className="drawer" open={r.status === 'Draft'}>
          <summary><span>{r.document} <span className="muted" style={{ fontWeight: 400 }}>· to {r.to_name || r.to_email || '—'}</span></span><Badge tone={r.status === 'Draft' ? 'q' : r.status === 'Reviewed' ? 'info' : r.status === 'Sent by a person' ? 'ok' : 'neu'}>{r.status}</Badge></summary>
          <div className="body">
            <div className="draftbox">Draft only — nothing is sent automatically.{r.remind_on ? ` Reminder date: ${fmtDate(r.remind_on)}.` : ''}</div>
            {edit && r.status === 'Draft' ? (
              <form action={docRequestAction} className="stack">
                {hid(l)}<input type="hidden" name="rid" value={r.id} />
                <div className="two"><label className="fld">Document<input type="text" name="document" defaultValue={r.document} required /></label><label className="fld">Remind on<input type="date" name="remind_on" defaultValue={r.remind_on || ''} /></label></div>
                <div className="two"><label className="fld">To (name)<input type="text" name="to_name" defaultValue={r.to_name || ''} /></label><label className="fld">To (email)<input type="email" name="to_email" defaultValue={r.to_email || ''} /></label></div>
                <label className="fld">Subject<input type="text" name="subject" defaultValue={r.subject || ''} /></label>
                <label className="fld">Message<textarea name="body" rows={7} defaultValue={r.body || ''} /></label>
                <div className="inline"><button className="btn" type="submit">Save draft</button><button className="btn btn-primary" type="submit" name="status" value="Reviewed">Mark reviewed — ready to send</button><button className="btn" type="submit" name="status" value="Cancelled">Cancel request</button></div>
              </form>
            ) : (
              <>
                <dl className="kv"><dt>Subject</dt><dd>{r.subject}</dd><dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.body}</dd><dt>Drafted by</dt><dd>{nameOf(members, r.drafted_by)}{r.reviewed_by ? ` · reviewed by ${nameOf(members, r.reviewed_by)}` : ''}</dd></dl>
                {edit && r.status === 'Reviewed' ? (
                  <div className="inline">
                    {r.to_email ? <a className="btn" href={`mailto:${r.to_email}?subject=${encodeURIComponent(r.subject || '')}&body=${encodeURIComponent(r.body || '')}`}>Open in my email app</a> : null}
                    <form action={docRequestAction}>{hid(l)}<input type="hidden" name="rid" value={r.id} /><button className="btn btn-primary" type="submit" name="status" value="Sent by a person">I sent it</button></form>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </details>
      ))}
      {!requests.length ? <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No requests yet.</p> : null}
      {edit ? (
        <details className="drawer" open={missing.length > 0 && !requests.some(r => r.status === 'Draft')}>
          <summary>+ Draft a request</summary>
          <form action={docRequestAction} className="body stack">
            {hid(l)}
            <div className="two">
              <label className="fld">Missing document <span className="req">*</span><input type="text" name="document" required defaultValue={missing[0]?.name || ''} /></label>
              <label className="fld">Remind me on<input type="date" name="remind_on" /></label>
            </div>
            <div className="two"><label className="fld">To (name)<input type="text" name="to_name" defaultValue={l.contact_name || ''} placeholder="Tender inviting officer" /></label><label className="fld">To (email)<input type="email" name="to_email" defaultValue={l.contact_email || ''} /></label></div>
            <label className="fld">Subject<input type="text" name="subject" defaultValue={`${l.ref_no ? `Tender ${l.ref_no}: ` : ''}request for ${missing[0]?.name || 'missing document'}`} /></label>
            <label className="fld">Message<textarea name="body" rows={7} defaultValue={`Dear Sir/Madam,\n\nThe tender ${l.ref_no ? `(${l.ref_no}) ` : ''}refers to ${missing[0]?.name || '[document]'}, which is not available on the portal. We request that it be published or shared so bidders can prepare a compliant response.\n\nRegards,\n[Name]\nNeurosynaptic Communications Pvt. Ltd.`} /></label>
            <div><button className="btn btn-primary" type="submit">Save draft for review</button></div>
          </form>
        </details>
      ) : null}
    </section>
  </>;
}

// ======================= Tasks =======================
export function TasksTab({ lead: l, session: s, members = [], tasks }: Base & { tasks: Task[] }) {
  return <>
    <section className="card">
      <header><div><h2>Preparation tasks</h2><p>Shared tasks for this opportunity. Unassigned tasks are available for anyone allowed to take them.</p></div><Link href="/tasks">All tasks</Link></header>
      <TaskTable tasks={tasks} s={s} members={members} ret={`/leads/${l.id}?tab=tasks`} />
    </section>
    {can(s, 'tasks.create') ? <TaskForm leadId={l.id} s={s} members={members} ret={`/leads/${l.id}?tab=tasks`} /> : null}
  </>;
}

export function TaskTable({ tasks, s, members, ret, leads }: { tasks: Task[]; s: Session; members: Member[]; ret: string; leads?: Map<number, Lead> }) {
  if (!tasks.length) return <Empty title="No tasks here" />;
  return (
    <div className="tbl-wrap"><table className="tbl plain">
      <thead><tr><th>Task</th>{leads ? <th>Opportunity</th> : null}<th>Owner</th><th>Due</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{tasks.map(t => {
        const mine = t.assignee === s.user.id || t.created_by === s.user.id;
        const l = leads && t.lead_id ? leads.get(t.lead_id) : undefined;
        return (
          <tr key={t.id}>
            <td style={{ minWidth: 200 }}><b style={{ fontSize: 13.5 }}>{t.title}</b>{t.personal ? <> <Badge tone="neu">Personal</Badge></> : null}{t.detail ? <div className="sub">{t.detail}</div> : null}{t.done_note ? <div className="sub">✓ {t.done_note}</div> : null}</td>
            {leads ? <td>{l ? <Link href={`/leads/${l.id}?tab=tasks`} className="ref">{l.ref_code}</Link> : <span className="muted">—</span>}{l ? <div className="sub" style={{ maxWidth: 220 }}>{l.title.slice(0, 60)}</div> : null}</td> : null}
            <td>{t.assignee ? <Who name={nameOf(members, t.assignee)} /> : <Badge tone="q">Available</Badge>}</td>
            <td><FollowUp date={t.due_on} /></td>
            <td><Badge tone={t.status === 'Done' ? 'ok' : t.status === 'Cancelled' ? 'neu' : (daysLeft(t.due_on) ?? 1) < 0 ? 'bad' : t.status === 'In progress' ? 'info' : 'out'}>{t.status === 'Open' && (daysLeft(t.due_on) ?? 1) < 0 ? 'Overdue' : t.status}</Badge></td>
            <td style={{ minWidth: 220 }}>
              {t.status === 'Done' || t.status === 'Cancelled' ? <span className="sub">{t.done_at ? fmtDate(t.done_at) : ''}</span> : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {!t.assignee && can(s, 'tasks.claim') ? <form action={taskChangeAction}><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="return" value={ret} /><button className="btn btn-sm btn-primary" name="op" value="claim" type="submit">Take it</button></form> : null}
                  {mine || can(s, 'tasks.assign') ? (
                    <form action={taskChangeAction} className="inline">
                      <input type="hidden" name="tid" value={t.id} /><input type="hidden" name="return" value={ret} /><input type="hidden" name="op" value="status" />
                      <select name="status" defaultValue={t.status === 'Open' ? 'In progress' : 'Done'} aria-label="New status"><option>In progress</option><option>Done</option><option>Cancelled</option><option>Open</option></select>
                      <input type="text" name="done_note" placeholder="Completion note" aria-label="Completion note (required for Done)" style={{ width: 130 }} />
                      <button className="btn btn-sm" type="submit">Save</button>
                    </form>
                  ) : null}
                  {can(s, 'tasks.assign') ? (
                    <form action={taskChangeAction} className="inline"><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="return" value={ret} /><input type="hidden" name="op" value="assign" />
                      <select name="assignee" defaultValue={t.assignee || ''} aria-label="Assign task"><option value="">Available (unassigned)</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select><button className="btn btn-sm" type="submit">Assign</button>
                    </form>
                  ) : t.assignee === s.user.id ? <form action={taskChangeAction}><input type="hidden" name="tid" value={t.id} /><input type="hidden" name="return" value={ret} /><button className="btn btn-sm" name="op" value="release" type="submit">Give back</button></form> : null}
                </div>
              )}
            </td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

export function TaskForm({ leadId, s, members, ret, leads }: { leadId: number | null; s: Session; members: Member[]; ret: string; leads?: Lead[] }) {
  return (
    <details className="drawer">
      <summary>+ New task</summary>
      <form action={taskCreateAction} className="body stack">
        {leadId ? <input type="hidden" name="lead_id" value={leadId} /> : null}<input type="hidden" name="return" value={ret} />
        <label className="fld">Task <span className="req">*</span><input type="text" name="title" required placeholder="e.g. Get experience letters for the last 3 similar projects" /></label>
        {leads ? <label className="fld">Opportunity<select name="lead_id" defaultValue=""><option value="">None (general task)</option>{leads.map(l => <option key={l.id} value={l.id}>{l.ref_code} · {l.title.slice(0, 70)}</option>)}</select></label> : null}
        <div className="two">
          <label className="fld">Owner<select name="assignee" defaultValue=""><option value="">Available — anyone can take it</option>{(can(s, 'tasks.assign') ? members : members.filter(m => m.id === s.user.id)).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
          <label className="fld">Due<input type="date" name="due_on" min={todayIST()} /></label>
        </div>
        <label className="fld">Details<textarea name="detail" rows={2} /></label>
        <label className="chk"><input type="checkbox" name="personal" /> Personal task (only you see it)</label>
        <div><button className="btn btn-primary" type="submit">Create task</button></div>
      </form>
    </details>
  );
}

// ======================= Proposal =======================
export async function ProposalTab({ lead: l, session: s, reqs }: Base & { reqs: Requirement[] }) {
  const { docs: kb } = await listKb();
  const usable = kb.filter(d => d.approval === 'Approved' && !((daysLeft(d.expires_on) ?? 1) < 0));
  const expired = kb.filter(d => (daysLeft(d.expires_on) ?? 1) < 0);
  const checklist = reqs.filter(r => r.necessity !== 'Optional');
  return <>
    <section className="card">
      <header><div><h2>Response checklist</h2><p>Assembled from the requirement checklist. Each line needs approved, current evidence before export or submission.</p></div></header>
      {checklist.length ? (
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Requirement</th><th>Evidence</th><th>Ready?</th></tr></thead>
          <tbody>{checklist.map(r => {
            const d = kb.find(x => x.id === r.evidence_doc);
            const ok = d && d.approval === 'Approved' && !((daysLeft(d.expires_on) ?? 1) < 0);
            return <tr key={r.id}><td><Link href={`/leads/${l.id}?tab=eligibility&req=${r.id}#clause`}>{r.requirement}</Link><div className="sub">{r.source_ref}</div></td><td>{d ? d.name : r.evidence || <span className="muted">—</span>}{d ? <div className="sub">{d.entity} · {d.approval}{d.expires_on ? ` · valid to ${fmtDate(d.expires_on)}` : ''}</div> : null}</td>
              <td>{ok ? <Badge tone="ok" icon="✓">Ready</Badge> : d && (daysLeft(d.expires_on) ?? 1) < 0 ? <Badge tone="bad" icon="!">Expired</Badge> : d ? <Badge tone="warn">Not approved</Badge> : <Badge tone="q" icon="?">Evidence missing</Badge>}</td></tr>;
          })}</tbody>
        </table></div>
      ) : <Empty title="No requirements yet">Record the eligibility clauses first; this checklist builds itself from them.</Empty>}
      <p className="hint-text" style={{ margin: 0 }}>{usable.length} approved, current evidence records available{expired.length ? ` · ${expired.length} expired record(s) in the Knowledge base` : ''}. Draft text must cite its source document; unsupported claims are not allowed in a submission. Automatic drafting is not switched on in this version.</p>
    </section>
    <section className="card">
      <header><div><h2>Pursuit</h2><p>{l.next_followup ? <>Next follow-up <FollowUp date={l.next_followup} /></> : 'Applied date, client contact, pitch and follow-ups.'}</p></div></header>
      {can(s, 'opp.edit') ? (
        <form action={pursuitAction} className="stack" key={l.updated_at}>
          {hid(l)}
          <div className="two">
            <label className="fld">RFP documents<select name="rfp_status" defaultValue={l.rfp_status || 'Unknown'}>{RFP_STATUSES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="fld">Applied / submitted on<input type="date" name="applied_on" defaultValue={l.applied_on || ''} /></label>
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
          <label className="fld">Pitch summary<textarea name="pitch_summary" rows={4} defaultValue={l.pitch_summary || ''} placeholder="What we proposed: solution, price, partners, differentiators" /></label>
          <div><button className="btn btn-primary" type="submit">Save</button></div>
        </form>
      ) : <Denied>Your role cannot edit the proposal details.</Denied>}
    </section>
  </>;
}

// ======================= Activity =======================
export async function ActivityTab({ lead: l, session: s, members = [], activity }: Base & { activity: Activity[] }) {
  const events = (await listEvents()).filter(e => e.lead_id === l.id);
  const inAWeek = new Date(Date.now() + 5.5 * 3600e3 + 2 * 864e5).toISOString().slice(0, 10) + 'T11:00';
  return <>
    <section className="card">
      <header><div><h2>Activity and audit history</h2><p>Every status, assignment, deadline, score, decision and document change, with who and when. Written by the database; it cannot be edited.</p></div></header>
      <form action={commentAction} style={{ display: 'grid', gap: 8 }}>
        {hid(l)}
        <label className="sr-only" htmlFor="cm">Add a note</label>
        <textarea id="cm" name="comment" placeholder="Add a note: who you spoke to, what the client said, what the RFP asks for…" required />
        <div><button className="btn btn-primary" type="submit">Add note</button></div>
      </form>
      <ol className="timeline">
        {activity.map(a => {
          const who = a.actor ? nameOf(members, a.actor) : 'Crawler / import';
          return (
            <li key={a.id}>
              <Avatar name={who} />
              <div>
                <div><b>{who}</b> <Badge tone="out">{a.action}</Badge><span className="when"> · {fmtDateTime(a.created_at)}</span></div>
                {a.action === 'comment' ? <div className="comment">{a.detail}</div> : <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
    {can(s, 'integrations.use') ? (
      <section className="card">
        <header><div><h2>Schedule a meeting</h2><p>Opens Google Calendar in your own account with these details. You are the organiser, you see every attendee before saving, and you can add a Google Meet link there.</p></div><Link href="/settings/integrations">How this works</Link></header>
        <form action={meetingAction} className="stack">
          <input type="hidden" name="lead_id" value={l.id} /><input type="hidden" name="return" value={`/leads/${l.id}?tab=activity`} />
          <label className="fld">Title <span className="req">*</span><input type="text" name="title" required defaultValue={`${l.ref_code}: ${l.title.slice(0, 80)}`} /></label>
          <div className="two"><label className="fld">Starts (IST) <span className="req">*</span><input type="datetime-local" name="start" required defaultValue={inAWeek} /></label><label className="fld">Minutes<input type="number" name="duration" defaultValue={30} min={15} max={480} step={15} /></label></div>
          <label className="fld">Attendees (emails, comma separated)<input type="text" name="attendees" placeholder="name@neurosynaptic.com, client@example.org" /></label>
          <label className="fld">Agenda<textarea name="details" rows={3} defaultValue={`Opportunity ${l.ref_code}\n${l.url || ''}`} /></label>
          <label className="chk"><input type="checkbox" name="confirm" /> I checked the attendees and details</label>
          <div><button className="btn btn-primary" type="submit">Open in Google Calendar</button></div>
        </form>
        {events.length ? <ul className="feed">{events.map(e => <li key={e.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span>{e.kind === 'calendar' ? 'Meeting' : 'Chat notice'}: {e.title}{e.error ? <div className="sub">{e.error}</div> : null}</span><Badge tone={e.status === 'Sent' || e.status === 'Opened in Google' ? 'ok' : e.status === 'Failed' ? 'bad' : 'neu'}>{e.status}</Badge></li>)}</ul> : null}
      </section>
    ) : null}
    <p className="legal">Deadline shown as <Due deadline={l.deadline} /> · CRM reference {l.ref_code} is permanent.</p>
  </>;
}

