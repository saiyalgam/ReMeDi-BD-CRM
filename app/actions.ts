'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as data from '@/lib/data';
import * as ext from '@/lib/data-ext';
import * as kb from '@/lib/kb';
import * as drive from '@/lib/drive-data';
import { calendarTemplateUrl } from '@/lib/google';
import { isDemo } from '@/lib/env';
import { normalizeIngestRow, sameNotice, titleKey } from '@/lib/leadtype';
import { can, PERM_KEYS } from '@/lib/perm';
import { mapStage, type ImportRow } from '@/lib/import';
import { todayIST } from '@/lib/format';
import {
  DECISIONS, DOC_KINDS, DOC_STATUSES, ELIGIBILITY_STATUSES, GAP_TYPES, KB_ENTITIES, KB_TYPES, ORG_ROLES, PARTNER_NEEDS, PARTNER_RELATIONSHIP,
  KB_CONFIDENTIALITY, CLAIM_REVIEW, CLAIM_STATUSES, PARTNER_VERIFICATION, REL_STATUSES, REQ_STATUSES, RFP_STATUSES, RISK_FACTORS, RISK_LEVELS, SCORE_KINDS, STAGES, TASK_STATUSES, VALUE_BANDS, VERIFICATIONS,
  type Decision, type EligibilityStatus, type Lead, type OrgRole, type Relevance, type RiskLevel, type Stage, type Verification
} from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;
const oneOf = <T extends string>(v: string, list: readonly T[], dflt: T): T => ((list as readonly string[]).includes(v) ? v as T : dflt);
const done = () => revalidatePath('/', 'layout');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: string) => (ISO.test(v) ? v : null);
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
function isRedirect(e: unknown) { return typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT'); }

/** Run a change, then go back to `path` with a confirmation or the error message (form data is kept by the browser on errors shown inline). */
async function run(path: string, fn: () => Promise<unknown>, ok: string) {
  let target: string;
  try { await fn(); target = withMsg(path, 'msg', ok); }
  catch (e) { if (isRedirect(e)) throw e; target = withMsg(path, 'err', msgOf(e)); }
  done();
  redirect(target);
}
function withMsg(path: string, k: 'msg' | 'err', v: string) {
  const [p, q] = path.split('#');
  const sep = p!.includes('?') ? '&' : '?';
  return `${p}${sep}${k}=${encodeURIComponent(v)}${q ? '#' + q : ''}`;
}
const leadPath = (id: number, tab?: string) => `/leads/${id}${tab ? `?tab=${tab}` : ''}`;
const back = (fd: FormData, dflt: string) => { const r = str(fd, 'return'); return r.startsWith('/') && !r.startsWith('//') ? r : dflt; };

// ---------------- lead status ----------------
export async function verifyAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const v = str(fd, 'verification') as Verification;
  if (!id || !(VERIFICATIONS as string[]).includes(v)) return;
  const note = fd.has('note') ? str(fd, 'note') || null : undefined;
  if ((v === 'Incorrect' || v === 'Duplicate') && fd.has('note') && !note) return run(back(fd, leadPath(id)), async () => { throw new Error('Say why it is ' + (v === 'Incorrect' ? 'incorrect' : 'a duplicate') + '. The crawler learns from these notes.'); }, '');
  await run(back(fd, leadPath(id)), () => data.updateLead(id, { verification: v, ...(note !== undefined ? { verification_note: note } : {}) }), `Marked ${v === 'Incorrect' ? 'incorrect' : v.toLowerCase()}.`);
}

export async function assignAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  const to = str(fd, 'assigned_to') || null;
  await run(back(fd, leadPath(id)), async () => {
    await data.updateLead(id, { assigned_to: to });
    if (to) {
      const [members, res] = await Promise.all([data.listMembers(), data.getLead(id)]);
      const who = members.find(m => m.id === to);
      await notifyChat(`Opportunity ${res?.lead.ref_code || '#' + id} assigned to ${who?.full_name || who?.email}: ${res?.lead.title}`, { lead_id: id });
    }
  }, to ? 'Owner updated.' : 'Owner removed.');
}

export async function claimLeadAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const s = await data.getSession();
  if (!id || !s) return;
  await run(back(fd, leadPath(id)), () => data.updateLead(id, { assigned_to: s.user.id }), 'You now own this opportunity.');
}

export async function stageAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const stage = str(fd, 'stage') as Stage;
  if (!id || !(STAGES as string[]).includes(stage)) return;
  await run(back(fd, leadPath(id)), async () => {
    const res = await data.getLead(id);
    if (stage === 'In preparation' && res && res.lead.decision !== 'Go') throw new Error('Record an approved Go decision before moving to In preparation.');
    await data.updateLead(id, { stage });
  }, `Stage set to ${stage}.`);
}

/** Bulk actions from the pipeline table. */
export async function bulkAction(fd: FormData) {
  const ids = fd.getAll('ids').map(v => Number(v)).filter(Boolean).slice(0, 200);
  const op = str(fd, 'op');
  const path = back(fd, '/leads');
  if (!ids.length) return run(path, async () => { throw new Error('Select at least one opportunity.'); }, '');
  let okCount = 0; const errs: string[] = [];
  for (const id of ids) {
    try {
      if (op === 'assign') await data.updateLead(id, { assigned_to: str(fd, 'assigned_to') || null });
      else if (op === 'stage') { const st = str(fd, 'stage'); if (!(STAGES as string[]).includes(st)) throw new Error('Pick a stage'); await data.updateLead(id, { stage: st as Stage }); }
      else if (op === 'correct') await data.updateLead(id, { verification: 'Correct' });
      else throw new Error('Pick an action');
      okCount++;
    } catch (e) { errs.push(msgOf(e)); }
  }
  done();
  redirect(withMsg(path, errs.length ? 'err' : 'msg', errs.length ? `${okCount} updated; ${errs.length} not changed: ${[...new Set(errs)].join(' ')}` : `${okCount} opportunit${okCount === 1 ? 'y' : 'ies'} updated.`));
}

// ---------------- decision: recommend, approve, return ----------------
export async function recommendAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const rec = str(fd, 'recommendation');
  const reason = str(fd, 'reason').slice(0, 1500);
  if (!id) return;
  await run(leadPath(id, 'decision'), async () => {
    if (rec !== 'Go' && rec !== 'No-go') throw new Error('Choose Go or No-go.');
    if (reason.length < 15) throw new Error('Give the reason and the evidence it rests on (at least a sentence).');
    const res = await data.getLead(id);
    if (res?.lead.verification !== 'Correct') throw new Error('Verify the lead as Correct before recommending a decision.');
    await data.updateLead(id, { recommended_decision: rec, recommendation_reason: reason, approval_status: 'Pending', approval_note: null });
    await notifyChat(`Decision needed: ${res.lead.ref_code} — ${rec} recommended. ${res.lead.title}`, { lead_id: id });
  }, `Recommendation sent for approval (${rec}).`);
}

export async function approveAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const verdict = str(fd, 'verdict');
  const note = str(fd, 'note').slice(0, 1000) || null;
  if (!id) return;
  await run(leadPath(id, 'decision'), async () => {
    const res = await data.getLead(id); if (!res) throw new Error('Not found');
    const l = res.lead;
    if (verdict === 'approve') {
      if (!l.recommended_decision) throw new Error('There is no recommendation to approve.');
      await data.updateLead(id, { decision: l.recommended_decision, decision_reason: l.recommendation_reason, approval_status: 'Approved', approval_note: note,
        ...(l.recommended_decision === 'No-go' && !['Won', 'Lost', 'Dropped', 'Banked'].includes(l.stage) ? { stage: 'Dropped' as Stage } : {}) });
    } else if (verdict === 'return') {
      if (!note) throw new Error('Say what is missing so the recommender can fix it.');
      await data.updateLead(id, { approval_status: 'Returned', approval_note: note });
    } else throw new Error('Choose approve or return.');
  }, verdict === 'approve' ? 'Decision approved and recorded.' : 'Returned to the recommender with your note.');
}

/** Direct decision by someone who may approve (records who, when and why). */
export async function decisionAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const decision = str(fd, 'decision') as Decision;
  if (!id || !(DECISIONS as string[]).includes(decision)) return;
  const reason = str(fd, 'reason').slice(0, 1000) || null;
  await run(leadPath(id, 'decision'), async () => {
    if (decision !== 'Undecided' && (!reason || reason.length < 15)) throw new Error('Write why (at least a sentence). Reasons are kept as learning data and teach the crawler.');
    await data.updateLead(id, { decision, decision_reason: decision === 'Undecided' ? null : reason, approval_status: decision === 'Undecided' ? 'None' : 'Approved', approval_note: null });
  }, decision === 'Undecided' ? 'Decision cleared.' : `Saved: ${decision}.`);
}

// ---------------- details, pursuit, eligibility ----------------
export async function detailsAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'overview'), async () => {
    const title = str(fd, 'title').slice(0, 500);
    if (!title) throw new Error('The title cannot be empty.');
    const url = str(fd, 'url');
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('The link must start with https://');
    const vb = str(fd, 'value_band');
    await data.updateLead(id, {
      title, funder_buyer: opt(fd, 'funder_buyer'), country: opt(fd, 'country'),
      amount: opt(fd, 'amount'), ref_no: opt(fd, 'ref_no'), url: url || null, summary: str(fd, 'summary').slice(0, 2000) || null,
      value_band: (VALUE_BANDS as readonly string[]).includes(vb) ? vb : null
    });
  }, 'Details saved.');
}

export async function pursuitAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'proposal'), async () => {
    const rfp = str(fd, 'rfp_status');
    const email = str(fd, 'contact_email');
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('Check the contact email.');
    await data.updateLead(id, {
      rfp_status: RFP_STATUSES.includes(rfp) ? rfp : 'Unknown',
      applied_on: dateOrNull(str(fd, 'applied_on')), next_followup: dateOrNull(str(fd, 'next_followup')),
      contact_name: opt(fd, 'contact_name'), contact_role: opt(fd, 'contact_role'),
      contact_email: email || null, contact_phone: opt(fd, 'contact_phone'),
      pitch_summary: str(fd, 'pitch_summary').slice(0, 3000) || null
    });
  }, 'Proposal and pursuit details saved.');
}

export async function eligibilityAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'eligibility'), async () => {
    const status = oneOf(str(fd, 'eligibility_status'), ELIGIBILITY_STATUSES, 'Not assessed') as EligibilityStatus;
    const reqs = await ext.listRequirements(id);
    const openMandatory = reqs.filter(r => r.necessity !== 'Optional' && (r.status === 'Needs clarification' || r.status === 'Not assessed'));
    if (status === 'Meets directly' && openMandatory.length) throw new Error(`${openMandatory.length} mandatory or unclear requirement(s) are still open (${openMandatory.map(r => r.requirement).slice(0, 3).join('; ')}). Resolve them or choose “Needs clarification”.`);
    if (status === 'Meets directly' && !reqs.length) throw new Error('Record the eligibility clauses first, so the result rests on the tender wording.');
    if (status === 'Potentially eligible with partner' && !reqs.some(r => r.status === 'Partner may cover')) throw new Error('Mark which requirement a partner covers before choosing “eligible with partner”.');
    if (status !== 'Not assessed' && !str(fd, 'eligibility_summary')) throw new Error('Summarise the result in a sentence.');
    await data.updateLead(id, { eligibility_status: status, eligibility_summary: str(fd, 'eligibility_summary').slice(0, 1000) || null, partner_need: oneOf(str(fd, 'partner_need'), PARTNER_NEEDS, 'Not indicated') });
  }, 'Eligibility result saved.');
}

export async function requirementAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const rid = Number(str(fd, 'rid')) || null;
  if (!id) return;
  if (str(fd, 'op') === 'delete' && rid) return run(leadPath(id, 'eligibility'), () => ext.deleteRequirement(id, rid), 'Requirement removed.');
  await run(leadPath(id, 'eligibility') + (rid ? `&req=${rid}` : ''), async () => {
    const status = oneOf(str(fd, 'status'), REQ_STATUSES, 'Not assessed');
    const question = opt(fd, 'question');
    if (status === 'Needs clarification' && !question) throw new Error('Write the exact question that needs an answer.');
    if (status === 'Meets' && !opt(fd, 'evidence') && !opt(fd, 'evidence_doc') && !opt(fd, 'evidence_claim')) throw new Error('“Meets” needs evidence: name the document, link an evidence record or a cited claim.');
    await ext.saveRequirement(id, rid, {
      requirement: str(fd, 'requirement').slice(0, 300), excerpt: opt(fd, 'excerpt'), necessity: oneOf(str(fd, 'necessity'), ['Mandatory', 'Optional', 'Unclear'] as const, 'Unclear'),
      source_doc: opt(fd, 'source_doc'), source_ref: opt(fd, 'source_ref'), evidence: opt(fd, 'evidence'), evidence_doc: Number(str(fd, 'evidence_doc')) || null,
      status, confidence: (['High', 'Medium', 'Low'] as const).find(c => c === str(fd, 'confidence')) || null, question,
      partner_need: oneOf(str(fd, 'partner_need'), ['Not indicated', 'Required by tender', 'Recommended for delivery'] as const, 'Not indicated'),
      gap_type: (GAP_TYPES as readonly string[]).includes(str(fd, 'gap_type')) ? str(fd, 'gap_type') : null, note: opt(fd, 'note'),
      ...(fd.has('evidence_claim') ? { evidence_claim: Number(str(fd, 'evidence_claim')) || null } : {})
    });
  }, rid ? 'Requirement updated.' : 'Requirement added.');
}

export async function risksAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'assessment'), async () => {
    for (const [i, factor] of RISK_FACTORS.entries()) {
      const level = str(fd, `level_${i}`);
      if (!level) continue;
      await ext.saveRisk(id, factor, oneOf(level, RISK_LEVELS, 'Unclear') as RiskLevel, opt(fd, `note_${i}`), opt(fd, `source_${i}`));
    }
  }, 'Risk assessment saved.');
}

export async function scoresAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'assessment'), async () => {
    const ids = fd.getAll('criterion').map(Number).filter(Boolean);
    const items = ids.map(cid => {
      const raw = str(fd, `score_${cid}`);
      const score = raw === '' ? null : Math.max(0, Math.min(5, Math.round(Number(raw))));
      return { criterion_id: cid, score: Number.isFinite(score as number) ? score : null, rationale: opt(fd, `why_${cid}`), evidence: opt(fd, `ev_${cid}`) };
    });
    const missing = items.filter(it => it.score !== null && !it.rationale);
    if (missing.length) throw new Error('Give a short rationale for every score you enter.');
    await ext.saveScores(id, items);
  }, 'Scorecard saved. Scores support the review; they do not make the decision.');
}

// ---------------- deadlines ----------------
export async function amendmentAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'source'), async () => {
    const d = dateOrNull(str(fd, 'deadline')); if (!d) throw new Error('Enter the new deadline date.');
    const url = str(fd, 'source_url'); if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('The source link must start with https://');
    await ext.addAmendment(id, { deadline: d, source: opt(fd, 'source'), source_url: url || null, note: opt(fd, 'note'), verifyNow: str(fd, 'verify_now') === 'yes' });
  }, str(fd, 'verify_now') === 'yes' ? 'Amendment verified; the active deadline is updated.' : 'Amendment recorded. It changes the deadline once someone verifies it.');
}

export async function reviewAmendmentAction(fd: FormData) {
  const aid = Number(str(fd, 'aid'));
  const verdict = str(fd, 'verdict') === 'reject' ? 'reject' : 'verify';
  if (!aid) return;
  const path = back(fd, '/review?tab=amendments');
  await run(path, () => ext.reviewAmendment(aid, verdict, opt(fd, 'note')), verdict === 'verify' ? 'Amendment verified; the active deadline is updated.' : 'Date rejected; the deadline is unchanged.');
}

// ---------------- documents and requests ----------------
export async function docAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const did = Number(str(fd, 'did')) || null;
  if (!id) return;
  await run(leadPath(id, 'documents'), async () => {
    const url = str(fd, 'url'); if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error('The link must start with https://');
    await ext.saveDoc(id, did, {
      ...(did && !fd.has('name') ? {} : { name: str(fd, 'name').slice(0, 200), kind: oneOf(str(fd, 'kind'), DOC_KINDS, 'Other'), version: opt(fd, 'version'), url: url || null, issued_on: dateOrNull(str(fd, 'issued_on')), expires_on: dateOrNull(str(fd, 'expires_on')), restricted: str(fd, 'restricted') === 'on', note: opt(fd, 'note') }),
      ...(fd.has('status') ? { status: oneOf(str(fd, 'status'), DOC_STATUSES, 'Available') } : {}),
      ...(fd.has('review_status') ? { review_status: oneOf(str(fd, 'review_status'), ['Not reviewed', 'Reviewed', 'Superseded'] as const, 'Not reviewed') } : {})
    });
  }, did ? 'Document updated.' : 'Document added.');
}

export async function docRequestAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const rid = Number(str(fd, 'rid')) || null;
  if (!id) return;
  const status = str(fd, 'status');
  await run(leadPath(id, 'documents'), async () => {
    const email = str(fd, 'to_email'); if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('Check the email address.');
    await ext.saveDocRequest(id, rid, {
      ...(fd.has('document') ? { document: str(fd, 'document').slice(0, 200), to_name: opt(fd, 'to_name'), to_email: email || null, subject: opt(fd, 'subject'), body: str(fd, 'body').slice(0, 5000) || null, remind_on: dateOrNull(str(fd, 'remind_on')) } : {}),
      ...(status ? { status: oneOf(status, ['Draft', 'Reviewed', 'Sent by a person', 'Cancelled'] as const, 'Draft') } : {})
    });
  }, status === 'Sent by a person' ? 'Marked as sent. The CRM did not send anything.' : rid ? 'Request updated.' : 'Draft saved. Review it, then send it yourself.');
}

// ---------------- tasks ----------------
export async function taskCreateAction(fd: FormData) {
  const leadId = Number(str(fd, 'lead_id')) || null;
  const path = back(fd, leadId ? leadPath(leadId, 'tasks') : '/tasks');
  await run(path, async () => {
    await ext.createTask({ lead_id: leadId, title: str(fd, 'title').slice(0, 200), detail: opt(fd, 'detail'), assignee: opt(fd, 'assignee'), due_on: dateOrNull(str(fd, 'due_on')), personal: str(fd, 'personal') === 'on' });
    const a = opt(fd, 'assignee');
    if (a && str(fd, 'personal') !== 'on') { const who = (await data.listMembers()).find(m => m.id === a); await notifyChat(`New task for ${who?.full_name || who?.email}: ${str(fd, 'title')}`, { lead_id: leadId }); }
  }, 'Task created.');
}

export async function taskChangeAction(fd: FormData) {
  const tid = Number(str(fd, 'tid'));
  const op = str(fd, 'op');
  if (!tid) return;
  const path = back(fd, '/tasks');
  await run(path, async () => {
    if (op === 'claim') await ext.changeTask(tid, { kind: 'claim' });
    else if (op === 'release') await ext.changeTask(tid, { kind: 'release' });
    else if (op === 'assign') { const t = await ext.changeTask(tid, { kind: 'assign', assignee: opt(fd, 'assignee') }); if (t?.assignee) { const who = (await data.listMembers()).find(m => m.id === t.assignee); await notifyChat(`Task reassigned to ${who?.full_name || who?.email}: ${t.title}`, { lead_id: t.lead_id, task_id: t.id }); } }
    else if (op === 'status') await ext.changeTask(tid, { kind: 'status', status: oneOf(str(fd, 'status'), TASK_STATUSES, 'Open'), done_note: opt(fd, 'done_note') });
    else if (op === 'due') await ext.changeTask(tid, { kind: 'due', due_on: dateOrNull(str(fd, 'due_on')) });
    else throw new Error('Unknown change');
  }, op === 'claim' ? 'Task taken — it is yours now.' : 'Task updated.');
}

// ---------------- partners ----------------
export async function partnerAction(fd: FormData) {
  const pid = Number(str(fd, 'pid')) || null;
  let newId = 0;
  const path = pid ? `/partners/${pid}` : '/partners';
  await run(path, async () => {
    const email = str(fd, 'contact_email'); if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('Check the email address.');
    const row: Record<string, unknown> = {};
    for (const k of ['name', 'aliases', 'category', 'capabilities', 'geography', 'health_domains', 'prior_collaboration', 'source_note', 'contact_name', 'contact_phone', 'due_diligence', 'restrictions']) if (fd.has(k)) row[k] = opt(fd, k);
    if (fd.has('contact_email')) row.contact_email = email || null;
    if (fd.has('kind')) row.kind = oneOf(str(fd, 'kind'), ['Organisation', 'Person'] as const, 'Organisation');
    if (fd.has('verification')) row.verification = oneOf(str(fd, 'verification'), PARTNER_VERIFICATION, 'Needs confirmation');
    if (fd.has('relationship')) row.relationship = oneOf(str(fd, 'relationship'), PARTNER_RELATIONSHIP, 'To confirm');
    if (fd.has('owner')) row.owner = opt(fd, 'owner');
    if (row.verification === 'Verified' && !row.source_note) throw new Error('Say how the partner was verified (document, meeting, registration).');
    if (row.relationship === 'Current' && row.verification !== 'Verified') throw new Error('Only a verified partner can be marked Current.');
    newId = await ext.savePartner(pid, row);
  }, pid ? 'Partner saved.' : 'Partner added (needs confirmation until verified).');
  void newId;
}

export async function leadPartnerAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  const lpid = Number(str(fd, 'lpid')) || null;
  if (str(fd, 'op') === 'remove' && lpid) return run(leadPath(id, 'partners'), () => ext.unlinkPartner(id, lpid), 'Partner removed from this opportunity.');
  await run(leadPath(id, 'partners'), () => ext.linkPartner(id, Number(str(fd, 'partner_id')), {
    need: oneOf(str(fd, 'need'), ['Required by tender', 'Recommended for delivery'] as const, 'Recommended for delivery'),
    gap_type: (GAP_TYPES as readonly string[]).includes(str(fd, 'gap_type')) ? str(fd, 'gap_type') : null,
    gap_note: opt(fd, 'gap_note'), evidence: opt(fd, 'evidence'),
    status: oneOf(str(fd, 'status'), ['Suggested', 'Contacted', 'Committed', 'Declined'] as const, 'Suggested')
  }, lpid), lpid ? 'Partner link updated.' : 'Partner linked with the gap it covers.');
}

// ---------------- knowledge base ----------------
export async function kbAction(fd: FormData) {
  const kid = Number(str(fd, 'kid')) || null;
  await run('/knowledge', () => ext.saveKb(kid, {
    name: str(fd, 'name').slice(0, 200), entity: oneOf(str(fd, 'entity'), KB_ENTITIES, 'NCPL'), doc_type: oneOf(str(fd, 'doc_type'), KB_TYPES, 'Other'),
    owner: opt(fd, 'owner'), doc_date: dateOrNull(str(fd, 'doc_date')), expires_on: dateOrNull(str(fd, 'expires_on')), version: opt(fd, 'version'),
    confidentiality: oneOf(str(fd, 'confidentiality'), KB_CONFIDENTIALITY, 'Internal'), approval: oneOf(str(fd, 'approval'), ['Draft', 'Approved', 'Superseded'] as const, 'Draft'),
    tags: opt(fd, 'tags'), location: opt(fd, 'location'), summary: opt(fd, 'summary')
  }), kid ? 'Evidence record saved.' : 'Evidence record added.');
}

// ---------------- relationships and meetings ----------------
export async function relationshipAction(fd: FormData) {
  const rid = Number(str(fd, 'rid')) || null;
  await run('/my' + (rid ? `?rel=${rid}` : ''), async () => {
    const email = str(fd, 'contact_email'); if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Error('Check the email address.');
    const row: Record<string, unknown> = {};
    for (const k of ['organisation', 'contact_name', 'contact_role', 'contact_phone', 'next_action']) if (fd.has(k)) row[k] = opt(fd, k);
    if (fd.has('contact_email')) row.contact_email = email || null;
    if (fd.has('status')) row.status = oneOf(str(fd, 'status'), REL_STATUSES, 'Active');
    if (fd.has('visibility')) row.visibility = str(fd, 'visibility') === 'Shared with leadership' ? 'Shared with leadership' : 'Private';
    if (fd.has('last_touch')) row.last_touch = dateOrNull(str(fd, 'last_touch'));
    if (fd.has('next_followup')) row.next_followup = dateOrNull(str(fd, 'next_followup'));
    if (fd.has('linked_lead')) row.linked_lead = Number(str(fd, 'linked_lead')) || null;
    await ext.saveRelationship(rid, row);
  }, rid ? 'Relationship saved.' : 'Personal lead added. Only you can see it until you share it.');
}

export async function relNoteAction(fd: FormData) {
  const rid = Number(str(fd, 'rid'));
  if (!rid) return;
  await run(`/my?rel=${rid}`, () => ext.addRelNote(rid, str(fd, 'body')), 'Private note added.');
}

/** Prepare a meeting: record it, then open Google Calendar's create page in the person's own account. */
export async function meetingAction(fd: FormData) {
  const title = str(fd, 'title').slice(0, 200);
  const start = str(fd, 'start');
  const duration = Math.max(15, Math.min(480, Number(str(fd, 'duration')) || 30));
  const attendees = str(fd, 'attendees').split(/[,;\s]+/).filter(x => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)).slice(0, 30);
  const leadId = Number(str(fd, 'lead_id')) || null;
  const relId = Number(str(fd, 'relationship_id')) || null;
  const path = back(fd, relId ? `/my?rel=${relId}` : leadId ? leadPath(leadId, 'activity') : '/my');
  let url = '';
  try {
    if (!title) throw new Error('Give the meeting a title.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) throw new Error('Pick the date and start time.');
    if (str(fd, 'confirm') !== 'on') throw new Error('Tick the box to confirm you checked the attendees and details.');
    url = calendarTemplateUrl({ title, start, durationMin: duration, attendees, details: str(fd, 'details').slice(0, 1500) });
    await ext.recordEvent({ kind: 'calendar', lead_id: leadId, relationship_id: relId, task_id: null, title, payload: { start, duration, attendees, details: str(fd, 'details').slice(0, 1500) }, status: 'Opened in Google', error: null });
  } catch (e) {
    if (isRedirect(e)) throw e;
    done(); redirect(withMsg(path, 'err', msgOf(e)));
  }
  done();
  redirect(url);
}

/** Google Chat notifications are planned, not part of this release: nothing is posted and nothing is logged.
 *  Call sites are kept so the feature can be switched on later without touching every action. */
async function notifyChat(_text: string, _link: { lead_id?: number | null; task_id?: number | null }): Promise<void> { /* planned */ }

// ---------------- intake: duplicates ----------------
export async function mergeAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const into = Number(str(fd, 'into'));
  if (!id) return;
  await run('/intake', async () => {
    if (str(fd, 'op') === 'keep') { await data.updateLead(id, { verification: 'Correct', verification_note: 'Checked: not a duplicate' }); return; }
    if (!into || into === id) throw new Error('Choose the original opportunity.');
    const leads = await data.listLeads();
    const orig = leads.find(l => l.id === into);
    if (!orig) throw new Error('Original not found');
    await data.updateLead(id, { verification: 'Duplicate', verification_note: `Duplicate of ${orig.ref_code}`, duplicate_of: into });
  }, str(fd, 'op') === 'keep' ? 'Kept as a separate opportunity.' : 'Marked as duplicate. Its reference number stays reserved and is never reused.');
}

// ---------------- create / import ----------------
export async function createLeadAction(fd: FormData) {
  let id = 0, err = '';
  try {
    id = await data.createLead({
      title: str(fd, 'title'), lead_type: str(fd, 'lead_type'), category: str(fd, 'category'),
      funder_buyer: str(fd, 'funder_buyer'), country: str(fd, 'country'), deadline: str(fd, 'deadline'),
      amount: str(fd, 'amount'), ref_no: str(fd, 'ref_no'), url: str(fd, 'url'), summary: str(fd, 'summary'),
      source: str(fd, 'source'), rfp_status: str(fd, 'url') ? 'Available' : 'Unknown'
    });
  } catch (e) { err = msgOf(e); }
  done();
  if (err) redirect('/leads/new?err=' + encodeURIComponent(err));
  redirect(`/leads/${id}?msg=` + encodeURIComponent('Opportunity added. Check it and pick an owner.'));
}

export interface ImportResult { ok: boolean; message: string; created: number; skipped: { line: number; title: string; reason: string }[] }

/** Import mapped spreadsheet rows. dryRun only reports what would happen. Duplicates (same title) are skipped. */
export async function importRowsAction(_prev: ImportResult | null, fd: FormData): Promise<ImportResult> {
  try {
    const s = await data.requirePerm('opp.create', 'import opportunities');
    const rows = JSON.parse(str(fd, 'rows') || '[]') as ImportRow[];
    const dry = str(fd, 'mode') !== 'import';
    const markCorrect = str(fd, 'verified') === 'on';
    if (markCorrect && !can(s, 'opp.verify')) throw new Error('Your role cannot mark imported rows as verified. Untick that box.');
    if (!Array.isArray(rows) || !rows.length) throw new Error('No rows to import.');
    if (rows.length > 1000) throw new Error('Import at most 1000 rows at a time.');
    const [leads, members] = await Promise.all([data.listLeads(), data.listMembers()]);
    const skipped: ImportResult['skipped'] = [];
    const seen = new Set<string>();
    let created = 0;
    const source = `Spreadsheet import: ${str(fd, 'file').slice(0, 80) || 'file'}`;
    for (const r of rows) {
      const title = String(r.title || '').trim().slice(0, 500);
      if (!title) { skipped.push({ line: r.line, title: '', reason: 'No title' }); continue; }
      const key = titleKey(title);
      const dup = leads.find(l => titleKey(l.title) === key || sameNotice(l as unknown as Record<string, unknown>, { title, funder_buyer: r.funder_buyer, ref_no: r.ref_no }));
      if (dup) { skipped.push({ line: r.line, title, reason: `Already in the CRM as ${dup.ref_code}` }); continue; }
      if (seen.has(key)) { skipped.push({ line: r.line, title, reason: 'Repeated in this file' }); continue; }
      seen.add(key);
      const n = normalizeIngestRow({ uid: 'X', title, category: r.category, lead_type: r.lead_type, deadline: r.deadline, amount: r.amount, country: r.country, funder_buyer: r.funder_buyer, url: r.url, ref_no: r.ref_no, summary: r.summary }, todayIST());
      if (!n.ok) { skipped.push({ line: r.line, title, reason: n.reason }); continue; }
      if (dry) { created++; continue; }
      const owner = r.owner ? members.find(m => (m.full_name || '').toLowerCase().split(/\s+/)[0] === r.owner!.toLowerCase().split(/\s+/)[0]) : undefined;
      const extra: Partial<Lead> = {
        stage: (r.stage && mapStage(r.stage) ? r.stage : 'Identified') as Stage,
        value_band: r.value_band, suggested_partner: r.partners,
        ...(markCorrect ? { verification: 'Correct' as const, verified_by: s.user.id, verified_at: new Date().toISOString(), verification_note: 'Imported from the team pipeline workbook' } : {}),
        ...(owner && (can(s, 'opp.assign') || owner.id === s.user.id) ? { assigned_to: owner.id, assigned_at: new Date().toISOString() } : {})
      };
      await data.createLead({ ...n.lead, uid: 'IMP-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), source, import_note: `Imported from ${source.replace('Spreadsheet import: ', '')} (row ${r.line})${r.owner && !owner ? ` · workbook owner “${r.owner}” not matched to a CRM user` : ''}${r.partners ? ` · partners named: ${r.partners}` : ''}` }, extra);
      created++;
    }
    if (!dry) done();
    return { ok: true, created, skipped, message: dry ? `${created} row(s) would be added; ${skipped.length} skipped.` : `${created} opportunit${created === 1 ? 'y' : 'ies'} added; ${skipped.length} skipped.` };
  } catch (e) {
    return { ok: false, created: 0, skipped: [], message: msgOf(e) };
  }
}

// ---------------- comments, news ----------------
export async function commentAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  if (!id) return;
  await run(leadPath(id, 'activity'), () => data.addComment(id, str(fd, 'comment')), 'Note added.');
}

export async function newsAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const r = str(fd, 'relevance') as Relevance;
  if (!id || !['Unreviewed', 'Relevant', 'Not relevant'].includes(r)) return;
  await data.markNews(id, r);
  done();
}

export async function refreshNewsAction() {
  let msg: string;
  try {
    const r = await data.refreshNewsAsAdmin();
    msg = `Checked ${r.feeds} feeds: ${r.inserted} new stories.` + (r.errors.length ? ` ${r.errors.length} feed(s) failed: ${r.errors.join('; ')}` : '');
  } catch (e) { msg = msgOf(e); }
  done();
  redirect('/news?msg=' + encodeURIComponent(msg));
}

// ---------------- saved views ----------------
export async function saveViewAction(fd: FormData) {
  await run('/leads?' + str(fd, 'query'), () => ext.saveView(str(fd, 'name'), str(fd, 'query')), 'View saved.');
}
export async function deleteViewAction(fd: FormData) {
  await run('/leads', () => ext.deleteView(Number(str(fd, 'vid'))), 'View removed.');
}

// ---------------- settings (admin) ----------------
async function teamAction(fn: () => Promise<void>, ok: string, path = '/team') { await run(path, fn, ok); }

export async function nameAction(fd: FormData) { await teamAction(() => data.updateMyName(str(fd, 'full_name')), 'Name saved.'); }
export async function roleAction(fd: FormData) {
  const role = str(fd, 'role') === 'admin' ? 'admin' : 'member';
  await teamAction(() => data.setRole(str(fd, 'id'), role), 'Admin access updated.');
}
export async function orgRoleAction(fd: FormData) {
  const r = str(fd, 'org_role');
  await teamAction(() => data.setOrgRole(str(fd, 'id'), (ORG_ROLES as readonly string[]).includes(r) ? r as OrgRole : null), 'Organisation role updated.', back(fd, '/team'));
}
export async function accessAddAction(fd: FormData) { await teamAction(() => data.addAccess(str(fd, 'pattern'), str(fd, 'note')), 'Access added.'); }
export async function accessRemoveAction(fd: FormData) { await teamAction(() => data.removeAccess(str(fd, 'pattern')), 'Access removed.'); }
export async function feedAddAction(fd: FormData) { await teamAction(() => data.addFeed(str(fd, 'name'), str(fd, 'url'), str(fd, 'topic')), 'Feed added.'); }
export async function feedRemoveAction(fd: FormData) { await teamAction(() => data.removeFeed(Number(str(fd, 'id'))), 'Feed removed.'); }

export async function permAction(fd: FormData) {
  const role = str(fd, 'org_role'); const perm = str(fd, 'permission');
  await run('/settings/permissions#' + encodeURIComponent(perm), async () => {
    if (!(ORG_ROLES as readonly string[]).includes(role) || !PERM_KEYS.includes(perm)) throw new Error('Unknown role or permission');
    await ext.setRolePerm(role as OrgRole, perm, str(fd, 'allowed') === 'on', oneOf(str(fd, 'status'), ['Confirmed', 'Proposed', 'Open question'] as const, 'Proposed'), opt(fd, 'note'));
  }, `${role}: ${perm} saved.`);
}

export async function criterionAction(fd: FormData) {
  const cid = Number(str(fd, 'cid')) || null;
  await run('/settings/scoring', () => ext.saveCriterion(cid, {
    kind: oneOf(str(fd, 'kind'), SCORE_KINDS, 'Government / PSU tender'), criterion: str(fd, 'criterion').slice(0, 200),
    weight: Math.max(0, Math.min(10, Number(str(fd, 'weight')) || 0)), guidance: opt(fd, 'guidance'), active: str(fd, 'active') === 'on'
  }), 'Scorecard updated.');
}

/** Demo mode only: act as another sample user to see how permissions change the screens. */
export async function demoActAsAction(fd: FormData) {
  if (!isDemo()) return;
  (await cookies()).set(data.DEMO_AS_COOKIE, str(fd, 'as'), { path: '/', httpOnly: true, sameSite: 'lax' });
  done();
  redirect(back(fd, '/'));
}

// ---------------- knowledge base: claim review (update 4) ----------------
export async function claimReviewAction(fd: FormData) {
  const id = Number(str(fd, 'claim')); if (!id) return;
  const review = oneOf(str(fd, 'review'), CLAIM_REVIEW, 'pending');
  const status = (CLAIM_STATUSES as readonly string[]).includes(str(fd, 'status')) ? str(fd, 'status') as (typeof CLAIM_STATUSES)[number] : null;
  await run(back(fd, '/knowledge?view=claims'), () => kb.reviewClaim(id, review, status, opt(fd, 'note')),
    review === 'confirmed' ? 'Claim confirmed.' : review === 'rejected' ? 'Claim rejected.' : review === 'needs_info' ? 'Marked as needing information.' : 'Claim reset to pending.');
}

// ---------------- Google Drive (update 4) ----------------
export async function driveDisconnectAction() {
  await run('/settings/integrations', () => drive.disconnectDrive(), 'Google Drive disconnected and the stored token deleted.');
}
export async function driveRootAction(fd: FormData) {
  let name = '';
  await run('/settings/integrations', async () => { name = await drive.setDriveRoot(str(fd, 'folder'), str(fd, 'mode') === 'create_under'); }, 'Root folder set.');
  void name;
}
export async function driveCopyPolicyAction(fd: FormData) {
  await run('/settings/integrations', () => drive.setCopyPolicy(str(fd, 'copy_policy') === 'copy_internal' ? 'copy_internal' : 'link_only'), 'Copy policy saved.');
}
export async function driveFolderAction(fd: FormData) {
  const id = Number(str(fd, 'id')); if (!id) return;
  let msg = 'Drive folder ready.';
  await run(back(fd, leadPath(id, 'documents')), async () => { const n = await drive.createLeadFolder(id); msg = `Drive folder ready: ${n}`; }, msg);
}
export async function driveLinkAction(fd: FormData) {
  const id = Number(str(fd, 'id')); if (!id) return;
  const path = back(fd, leadPath(id, 'documents'));
  let msg = 'Linked.';
  try {
    msg = await drive.linkDriveFile(id, {
      input: str(fd, 'file'), name: opt(fd, 'name'), subfolder: opt(fd, 'subfolder'), note: opt(fd, 'note'),
      sensitivity: oneOf(str(fd, 'sensitivity'), KB_CONFIDENTIALITY, 'Internal'), mode: str(fd, 'mode') === 'Copy' ? 'Copy' : 'Link',
      kbDocumentId: Number(str(fd, 'kb_document_id')) || null
    });
  } catch (e) { if (isRedirect(e)) throw e; done(); redirect(withMsg(path, 'err', msgOf(e))); }
  done(); redirect(withMsg(path, 'msg', msg));
}
export async function driveUnlinkAction(fd: FormData) {
  const id = Number(str(fd, 'id')); const fid = Number(str(fd, 'fid')); if (!id || !fid) return;
  await run(back(fd, leadPath(id, 'documents')), () => drive.unlinkDriveFile(id, fid), 'Link removed (the file in Google Drive was not changed).');
}
