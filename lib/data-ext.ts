// Records added in update 3. Real mode: Supabase as the signed-in person; row-level security decides what each
// role sees and changes (supabase/update-3.sql). Demo mode: the same rules applied in code.
import { cache } from 'react';
import { isDemo } from './env';
import { supabaseServer } from './supabase/server';
import { demo, nextSeq, saveDemo, type DemoStore } from './demo';
import { check, getSession, NotAllowed, requireAdmin, requireMember, requirePerm } from './data';
import { can, PERM_KEYS } from './perm';
import type {
  AuditEntry, Criterion, DeadlineRec, DocRequest, IntegrationEvent, KbDoc, LeadDoc, LeadPartner, Partner, RelNote, Relationship,
  Requirement, Risk, RolePerm, SavedView, Score, Session, Task
} from './types';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

/** Tables that may not exist before update-3.sql is installed: read as empty instead of failing the page. */
async function readOrEmpty<T>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const res = await q;
  if (res.error) {
    if (/does not exist|schema cache|Could not find the table/i.test(res.error.message)) return [];
    throw new Error(res.error.message);
  }
  return (res.data || []) as T[];
}

function demoLog(st: DemoStore, s: Session, lead_id: number | null, action: string, detail: string) {
  if (!lead_id) return;
  st.activity.push({ id: st.activity.length + 1, lead_id, actor: s.user.id, action: action as never, detail: detail.slice(0, 600), created_at: now() });
}
function demoAudit(st: DemoStore, s: Session, table_name: string, row_id: string | number, op: string, changed: string[] | null = null) {
  st.audit.push({ id: nextSeq(st), table_name, row_id: String(row_id), op, actor: s.user.id, changed, created_at: now() });
}
function pick<T>(row: Row, keys: (keyof T)[]): Partial<T> {
  const out: Row = {};
  for (const k of keys) if ((k as string) in row) out[k as string] = row[k as string];
  return out as Partial<T>;
}

// ---------------- requirements (clause by clause) ----------------
const REQ_KEYS: (keyof Requirement)[] = ['requirement', 'excerpt', 'necessity', 'source_doc', 'source_ref', 'evidence', 'evidence_doc', 'status', 'confidence', 'question', 'partner_need', 'gap_type', 'reviewer', 'note', 'extracted', 'sort', 'evidence_claim'];

export async function listRequirements(leadId?: number): Promise<Requirement[]> {
  if (isDemo()) return demo().requirements.filter(r => leadId == null || r.lead_id === leadId).sort((a, b) => a.sort - b.sort || a.id - b.id);
  const sb = await supabaseServer();
  let q = sb.from('lead_requirements').select('*').order('sort').order('id');
  if (leadId != null) q = q.eq('lead_id', leadId);
  return readOrEmpty<Requirement>(q);
}

export async function saveRequirement(leadId: number, id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('assess.edit', 'edit requirements');
  const patch = { ...pick<Requirement>(row, REQ_KEYS), reviewer: s.user.id };
  if (!id && !String(patch.requirement || '').trim()) throw new Error('Describe the requirement.');
  if (isDemo()) {
    const st = demo();
    if (id) {
      const r = st.requirements.find(x => x.id === id && x.lead_id === leadId); if (!r) throw new Error('Requirement not found');
      Object.assign(r, patch, { updated_at: now() });
      demoLog(st, s, leadId, 'requirement', `update: ${r.requirement.slice(0, 120)} — ${r.status}`);
    } else {
      id = nextSeq(st);
      const r = { id, lead_id: leadId, requirement: '', excerpt: null, necessity: 'Unclear', source_doc: null, source_ref: null, evidence: null, evidence_doc: null, status: 'Not assessed', confidence: null, question: null, partner_need: 'Not indicated', gap_type: null, note: null, extracted: false, sort: st.requirements.filter(x => x.lead_id === leadId).length, created_at: now(), updated_at: now(), ...patch } as Requirement;
      st.requirements.push(r);
      demoLog(st, s, leadId, 'requirement', `insert: ${r.requirement.slice(0, 120)} — ${r.status}`);
    }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { check(await sb.from('lead_requirements').update({ ...patch, updated_at: now() }).eq('id', id).eq('lead_id', leadId).select('id')); return id; }
  const rows = check(await sb.from('lead_requirements').insert({ ...patch, lead_id: leadId }).select('id')) as { id: number }[];
  return rows[0]!.id;
}

export async function deleteRequirement(leadId: number, id: number): Promise<void> {
  const s = await requirePerm('assess.edit', 'remove requirements');
  if (isDemo()) {
    const st = demo(); const r = st.requirements.find(x => x.id === id && x.lead_id === leadId);
    if (r) { st.requirements = st.requirements.filter(x => x.id !== id); demoLog(st, s, leadId, 'requirement', `removed delete: ${r.requirement.slice(0, 120)}`); }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('lead_requirements').delete().eq('id', id).eq('lead_id', leadId).select('id'));
}

// ---------------- risk items ----------------
export async function listRisks(leadId: number): Promise<Risk[]> {
  if (isDemo()) return demo().risks.filter(r => r.lead_id === leadId);
  const sb = await supabaseServer();
  return readOrEmpty<Risk>(sb.from('lead_risks').select('*').eq('lead_id', leadId));
}

export async function saveRisk(leadId: number, factor: string, level: Risk['level'], note: string | null, source: string | null): Promise<void> {
  const s = await requirePerm('assess.edit', 'edit risks');
  if (isDemo()) {
    const st = demo(); let r = st.risks.find(x => x.lead_id === leadId && x.factor === factor);
    const changed = !r || r.level !== level || r.note !== note || r.source !== source;
    if (!r) { r = { id: nextSeq(st), lead_id: leadId, factor, level, note, source, updated_by: s.user.id, updated_at: now() }; st.risks.push(r); }
    else Object.assign(r, { level, note, source, updated_by: s.user.id, updated_at: now() });
    if (changed) demoLog(st, s, leadId, 'risk', `${factor}: ${level}`);
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('lead_risks').upsert({ lead_id: leadId, factor, level, note, source, updated_by: s.user.id, updated_at: now() }, { onConflict: 'lead_id,factor' }).select('id'));
}

// ---------------- scorecards ----------------
export const listCriteria = cache(async (): Promise<Criterion[]> => {
  if (isDemo()) return [...demo().criteria].sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort);
  const sb = await supabaseServer();
  return readOrEmpty<Criterion>(sb.from('scorecard_criteria').select('*').order('kind').order('sort'));
});

export async function saveCriterion(id: number | null, row: { kind: Criterion['kind']; criterion: string; weight: number; guidance: string | null; active: boolean }): Promise<void> {
  const s = await requireAdmin();
  if (!row.criterion.trim()) throw new Error('Name the criterion.');
  if (isDemo()) {
    const st = demo();
    if (id) { const c = st.criteria.find(x => x.id === id); if (c) Object.assign(c, row); demoAudit(st, s, 'scorecard_criteria', id, 'UPDATE', Object.keys(row)); }
    else { const nid = nextSeq(st); st.criteria.push({ id: nid, sort: 99, ...row }); demoAudit(st, s, 'scorecard_criteria', nid, 'INSERT'); }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  if (id) check(await sb.from('scorecard_criteria').update(row).eq('id', id).select('id'));
  else check(await sb.from('scorecard_criteria').insert({ ...row, sort: 99 }).select('id'));
}

export async function listScores(leadId: number): Promise<Score[]> {
  if (isDemo()) return demo().scores.filter(x => x.lead_id === leadId);
  const sb = await supabaseServer();
  return readOrEmpty<Score>(sb.from('lead_scores').select('*').eq('lead_id', leadId));
}

export async function saveScores(leadId: number, items: { criterion_id: number; score: number | null; rationale: string | null; evidence: string | null }[]): Promise<void> {
  const s = await requirePerm('assess.edit', 'score opportunities');
  if (isDemo()) {
    const st = demo();
    for (const it of items) {
      let r = st.scores.find(x => x.lead_id === leadId && x.criterion_id === it.criterion_id);
      const changed = !r || r.score !== it.score || r.rationale !== it.rationale || r.evidence !== it.evidence;
      if (!changed) continue;
      if (!r) { r = { lead_id: leadId, ...it, scored_by: s.user.id, scored_at: now() }; st.scores.push(r); } else Object.assign(r, it, { scored_by: s.user.id, scored_at: now() });
      demoLog(st, s, leadId, 'score', `${st.criteria.find(c => c.id === it.criterion_id)?.criterion || 'criterion'}: ${it.score ?? '–'}/5`);
    }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  const cur = await listScores(leadId);
  const rows = items.filter(it => { const c = cur.find(x => x.criterion_id === it.criterion_id); return !c || c.score !== it.score || c.rationale !== it.rationale || c.evidence !== it.evidence; })
    .map(it => ({ lead_id: leadId, ...it, scored_by: s.user.id, scored_at: now() }));
  if (rows.length) check(await sb.from('lead_scores').upsert(rows, { onConflict: 'lead_id,criterion_id' }).select('lead_id'));
}

// ---------------- deadlines and amendments ----------------
export const listDeadlines = cache(async (leadId?: number): Promise<DeadlineRec[]> => {
  if (isDemo()) return demo().deadlines.filter(d => leadId == null || d.lead_id === leadId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sb = await supabaseServer();
  let q = sb.from('lead_deadlines').select('*').order('created_at', { ascending: false });
  if (leadId != null) q = q.eq('lead_id', leadId);
  return readOrEmpty<DeadlineRec>(q);
});

export async function addAmendment(leadId: number, row: { deadline: string; source: string | null; source_url: string | null; note: string | null; verifyNow: boolean }): Promise<void> {
  const s = await requirePerm('opp.edit', 'record amendments');
  if (row.verifyNow && !can(s, 'deadline.verify')) throw new NotAllowed(`Your role (${s.orgRole}) can record an amendment but not verify it. It will wait in the Review queue.`);
  if (!row.source?.trim()) throw new Error('Say where the new date comes from (corrigendum number, portal, email).');
  if (isDemo()) {
    const st = demo(); const l = st.leads.find(x => x.id === leadId); if (!l) throw new Error('Not found');
    const rec: DeadlineRec = { id: nextSeq(st), lead_id: leadId, kind: 'Amendment', deadline: row.deadline, previous: l.deadline, source: row.source, source_url: row.source_url, verified: row.verifyNow, verified_by: row.verifyNow ? s.user.id : null, verified_at: row.verifyNow ? now() : null, rejected: false, note: row.note, created_by: s.user.id, created_at: now() };
    st.deadlines.push(rec);
    demoLog(st, s, leadId, 'deadline', `Amendment ${rec.deadline} ${rec.verified ? '(verified)' : '(awaiting verification)'} · ${rec.source}`);
    if (rec.verified) applyDemoDeadline(st, s, rec);
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  const cur = check(await sb.from('leads').select('deadline').eq('id', leadId).maybeSingle()) as { deadline: string | null } | null;
  check(await sb.from('lead_deadlines').insert({ lead_id: leadId, kind: 'Amendment', deadline: row.deadline, previous: cur?.deadline ?? null, source: row.source, source_url: row.source_url, note: row.note, verified: row.verifyNow, created_by: s.user.id }).select('id'));
}

function applyDemoDeadline(st: DemoStore, s: Session, rec: DeadlineRec) {
  const l = st.leads.find(x => x.id === rec.lead_id); if (!l) return;
  const before = l.deadline;
  l.deadline = rec.deadline;
  l.deadline_note = `Amended ${rec.previous || ''} → ${rec.deadline}${rec.source ? ' (' + rec.source + ')' : ''}`;
  demoLog(st, s, rec.lead_id, 'deadline', `Verified amendment: deadline ${before || 'none'} → ${rec.deadline}`);
}

export async function reviewAmendment(id: number, verdict: 'verify' | 'reject', note: string | null): Promise<number> {
  const s = await requirePerm('deadline.verify', 'verify deadline amendments');
  if (isDemo()) {
    const st = demo(); const rec = st.deadlines.find(x => x.id === id); if (!rec) throw new Error('Amendment not found');
    if (verdict === 'verify') { rec.verified = true; rec.verified_by = s.user.id; rec.verified_at = now(); rec.note = note || rec.note; applyDemoDeadline(st, s, rec); }
    else { rec.rejected = true; rec.note = note || rec.note; demoLog(st, s, rec.lead_id, 'deadline', `Rejected unverified date ${rec.deadline}${note ? ': ' + note : ''}`); }
    saveDemo(st); return rec.lead_id;
  }
  const sb = await supabaseServer();
  const rows = check(await sb.from('lead_deadlines').update(verdict === 'verify' ? { verified: true, note } : { rejected: true, note }).eq('id', id).select('lead_id')) as { lead_id: number }[];
  if (!rows.length) throw new NotAllowed('Your role cannot verify deadline amendments.');
  return rows[0]!.lead_id;
}

// ---------------- tender documents and requests ----------------
const DOC_KEYS: (keyof LeadDoc)[] = ['name', 'kind', 'version', 'url', 'status', 'review_status', 'issued_on', 'expires_on', 'restricted', 'note'];

export const listDocs = cache(async (leadId?: number): Promise<LeadDoc[]> => {
  if (isDemo()) {
    const s = await getSession();
    if (!can(s, 'docs.read')) return [];
    return demo().docs.filter(d => (leadId == null || d.lead_id === leadId) && (!d.restricted || can(s, 'docs.read_restricted')));
  }
  const sb = await supabaseServer();
  let q = sb.from('lead_documents').select('*').order('created_at');
  if (leadId != null) q = q.eq('lead_id', leadId);
  return readOrEmpty<LeadDoc>(q);
});

export async function saveDoc(leadId: number, id: number | null, row: Row): Promise<void> {
  const s = await requirePerm('docs.edit', 'edit tender documents');
  const patch = pick<LeadDoc>(row, DOC_KEYS);
  if (patch.restricted && !can(s, 'docs.read_restricted')) throw new NotAllowed('Only roles that can see restricted documents can mark one restricted.');
  if (!id && !String(patch.name || '').trim()) throw new Error('Name the document.');
  if (isDemo()) {
    const st = demo();
    if (id) { const d = st.docs.find(x => x.id === id && x.lead_id === leadId); if (!d) throw new Error('Not found'); Object.assign(d, patch, { updated_at: now() }); demoLog(st, s, leadId, 'document', `${d.name} — ${d.status} / ${d.review_status}`); }
    else {
      const d = { id: nextSeq(st), lead_id: leadId, name: '', kind: 'Other', version: null, url: null, status: 'Available', review_status: 'Not reviewed', issued_on: null, expires_on: null, restricted: false, note: null, added_by: s.user.id, created_at: now(), updated_at: now(), ...patch } as LeadDoc;
      st.docs.push(d); demoLog(st, s, leadId, 'document', `${d.name} — ${d.status} / ${d.review_status}`);
    }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  if (id) check(await sb.from('lead_documents').update({ ...patch, updated_at: now() }).eq('id', id).eq('lead_id', leadId).select('id'));
  else check(await sb.from('lead_documents').insert({ ...patch, lead_id: leadId, added_by: s.user.id }).select('id'));
}

export const listDocRequests = cache(async (leadId?: number): Promise<DocRequest[]> => {
  if (isDemo()) { const s = await getSession(); if (!can(s, 'docs.read')) return []; return demo().docRequests.filter(d => leadId == null || d.lead_id === leadId); }
  const sb = await supabaseServer();
  let q = sb.from('doc_requests').select('*').order('created_at', { ascending: false });
  if (leadId != null) q = q.eq('lead_id', leadId);
  return readOrEmpty<DocRequest>(q);
});

/** Draft a request. It is never sent by the CRM: a person reviews it and sends it from their own mailbox or the portal. */
export async function saveDocRequest(leadId: number, id: number | null, row: Row): Promise<void> {
  const s = await requirePerm('docs.edit', 'draft document requests');
  const patch = pick<DocRequest>(row, ['document', 'to_name', 'to_email', 'subject', 'body', 'remind_on', 'status']);
  if (patch.status === 'Reviewed' || patch.status === 'Sent by a person') (patch as Row).reviewed_by = s.user.id;
  if (isDemo()) {
    const st = demo();
    if (id) { const d = st.docRequests.find(x => x.id === id && x.lead_id === leadId); if (!d) throw new Error('Not found'); Object.assign(d, patch, { updated_at: now() }); demoLog(st, s, leadId, 'request', `Request for ${d.document} — ${d.status}`); }
    else {
      if (!String(patch.document || '').trim()) throw new Error('Which document is missing?');
      const d = { id: nextSeq(st), lead_id: leadId, document: '', to_name: null, to_email: null, subject: null, body: null, remind_on: null, status: 'Draft', drafted_by: s.user.id, reviewed_by: null, created_at: now(), updated_at: now(), ...patch } as DocRequest;
      st.docRequests.push(d); demoLog(st, s, leadId, 'request', `Request for ${d.document} — Draft`);
    }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  if (id) check(await sb.from('doc_requests').update({ ...patch, updated_at: now() }).eq('id', id).eq('lead_id', leadId).select('id'));
  else check(await sb.from('doc_requests').insert({ ...patch, lead_id: leadId, drafted_by: s.user.id }).select('id'));
}

// ---------------- tasks ----------------
export const listTasks = cache(async (): Promise<Task[]> => {
  if (isDemo()) {
    const s = await getSession();
    return demo().tasks.filter(t => !t.personal || t.assignee === s?.user.id || t.created_by === s?.user.id);
  }
  const sb = await supabaseServer();
  return readOrEmpty<Task>(sb.from('tasks').select('*').order('due_on', { ascending: true, nullsFirst: false }).limit(3000));
});

export async function createTask(row: { lead_id: number | null; title: string; detail: string | null; assignee: string | null; due_on: string | null; personal: boolean }): Promise<void> {
  const s = await requirePerm('tasks.create', 'create tasks');
  if (!row.title.trim()) throw new Error('Give the task a title.');
  if (row.assignee && row.assignee !== s.user.id && !can(s, 'tasks.assign')) throw new NotAllowed(`Your role (${s.orgRole}) cannot assign tasks to other people. Leave it unassigned so someone can take it.`);
  if (row.personal) row.assignee = s.user.id;
  if (isDemo()) {
    const st = demo();
    const t: Task = { id: nextSeq(st), ...row, status: 'Open', created_by: s.user.id, done_note: null, done_at: null, created_at: now(), updated_at: now() };
    st.tasks.push(t);
    if (!t.personal) demoLog(st, s, t.lead_id, 'task', `${t.title} — Open${t.assignee ? ' · ' + (st.members.find(m => m.id === t.assignee)?.full_name || '') : ''}`);
    demoAudit(st, s, 'tasks', t.id, 'INSERT');
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('tasks').insert({ ...row, created_by: s.user.id }).select('id'));
}

export type TaskChange = { kind: 'claim' } | { kind: 'release' } | { kind: 'assign'; assignee: string | null } | { kind: 'status'; status: Task['status']; done_note?: string | null } | { kind: 'due'; due_on: string | null };

export async function changeTask(id: number, ch: TaskChange): Promise<Task | null> {
  const s = await requireMember();
  const all = await listTasks();
  const t = all.find(x => x.id === id);
  if (!t) throw new Error('Task not found');
  const mine = t.assignee === s.user.id || t.created_by === s.user.id;
  let patch: Partial<Task> = {};
  if (ch.kind === 'claim') {
    if (t.assignee) throw new Error('Someone already has this task.');
    if (!can(s, 'tasks.claim')) throw new NotAllowed(`Your role (${s.orgRole}) cannot take available tasks.`);
    patch = { assignee: s.user.id };
  } else if (ch.kind === 'release') {
    if (t.assignee !== s.user.id) throw new NotAllowed('You can only give back your own task.');
    patch = { assignee: null };
  } else if (ch.kind === 'assign') {
    if (!can(s, 'tasks.assign')) throw new NotAllowed(`Your role (${s.orgRole}) cannot assign tasks.`);
    patch = { assignee: ch.assignee };
  } else if (ch.kind === 'status') {
    if (!mine && !can(s, 'tasks.assign')) throw new NotAllowed('Only the assignee, the creator or someone who assigns tasks can change it.');
    if (ch.status === 'Done' && !String(ch.done_note || '').trim()) throw new Error('Add a short completion note (what was done, where the evidence is).');
    patch = { status: ch.status, done_note: ch.status === 'Done' ? (ch.done_note || null) : t.done_note, done_at: ch.status === 'Done' ? now() : null };
  } else if (ch.kind === 'due') {
    if (!mine && !can(s, 'tasks.assign')) throw new NotAllowed('Only the assignee or creator can change the due date.');
    patch = { due_on: ch.due_on };
  }
  if (isDemo()) {
    const st = demo(); const dt = st.tasks.find(x => x.id === id)!;
    Object.assign(dt, patch, { updated_at: now() });
    if (!dt.personal) demoLog(st, s, dt.lead_id, 'task', `${dt.title} — ${dt.status}${dt.assignee ? ' · ' + (st.members.find(m => m.id === dt.assignee)?.full_name || '') : ' · unassigned'}`);
    demoAudit(st, s, 'tasks', id, 'UPDATE', Object.keys(patch));
    saveDemo(st); return dt;
  }
  const sb = await supabaseServer();
  const rows = check(await sb.from('tasks').update({ ...patch, updated_at: now() }).eq('id', id).select('*')) as Task[];
  if (!rows.length) throw new NotAllowed('Your role does not allow this change.');
  return rows[0]!;
}

// ---------------- partners ----------------
const PARTNER_KEYS: (keyof Partner)[] = ['name', 'aliases', 'kind', 'category', 'capabilities', 'geography', 'health_domains', 'contact_name', 'contact_email', 'contact_phone', 'owner', 'prior_collaboration', 'verification', 'relationship', 'due_diligence', 'restrictions', 'source_note'];
const SENSITIVE_PARTNER: (keyof Partner)[] = ['contact_name', 'contact_email', 'contact_phone', 'due_diligence', 'restrictions'];

/** Partners as this person may see them: contacts, due diligence and restrictions only with partners.read_sensitive. */
export const listPartners = cache(async (): Promise<Partner[]> => {
  const s = await getSession();
  let rows: Partner[];
  if (isDemo()) { if (!can(s, 'partners.read')) return []; rows = demo().partners.map(p => ({ ...p })); }
  else {
    const sb = await supabaseServer();
    rows = await readOrEmpty<Partner>(sb.from('partners').select('*').order('name'));
    const priv = can(s, 'partners.read_sensitive') ? await readOrEmpty<Row>(sb.from('partner_private').select('*')) : [];
    const byId = new Map(priv.map(p => [Number(p.partner_id), p]));
    rows = rows.map(p => ({ ...p, contact_name: null, contact_email: null, contact_phone: null, due_diligence: null, restrictions: null, ...(byId.has(p.id) ? pick<Partner>(byId.get(p.id)!, SENSITIVE_PARTNER) : {}) }));
    return rows.sort((a, b) => a.name.localeCompare(b.name));   // the database already withheld what this role may not see
  }
  if (!can(s, 'partners.read_sensitive')) rows = rows.map(p => { const c = { ...p } as Row; for (const k of SENSITIVE_PARTNER) if (c[k]) c[k] = '__hidden__'; return c as unknown as Partner; });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

export async function savePartner(id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('partners.edit', 'edit partners');
  const patch = pick<Partner>(row, PARTNER_KEYS);
  if (!can(s, 'partners.read_sensitive')) for (const k of SENSITIVE_PARTNER) delete (patch as Row)[k];
  if (!id && !String(patch.name || '').trim()) throw new Error('Name the partner.');
  if (patch.verification === 'Verified' && !String(row.source_note || '').trim() && !id) throw new Error('Say how this partner was verified.');
  if (isDemo()) {
    const st = demo();
    if (id) { const p = st.partners.find(x => x.id === id); if (!p) throw new Error('Not found'); Object.assign(p, patch, { updated_at: now() }); demoAudit(st, s, 'partners', id, 'UPDATE', Object.keys(patch)); }
    else {
      if (st.partners.some(p => p.name.toLowerCase() === String(patch.name).trim().toLowerCase())) throw new Error('A partner with this name already exists.');
      id = nextSeq(st);
      st.partners.push({ id, name: '', aliases: null, kind: 'Organisation', category: null, capabilities: null, geography: null, health_domains: null, contact_name: null, contact_email: null, contact_phone: null, owner: null, prior_collaboration: null, verification: 'Needs confirmation', relationship: 'To confirm', due_diligence: null, restrictions: null, source_note: null, created_at: now(), updated_at: now(), ...patch } as Partner);
      demoAudit(st, s, 'partners', id, 'INSERT');
    }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  const priv: Row = {}; const pub: Row = { ...patch };
  for (const k of SENSITIVE_PARTNER) if (k in pub) { priv[k] = pub[k]; delete pub[k]; }
  if (id) { if (Object.keys(pub).length) check(await sb.from('partners').update({ ...pub, updated_at: now() }).eq('id', id).select('id')); }
  else { const rows = check(await sb.from('partners').insert(pub).select('id')) as { id: number }[]; id = rows[0]!.id; }
  if (Object.keys(priv).length) check(await sb.from('partner_private').upsert({ partner_id: id, ...priv, updated_at: now() }).select('partner_id'));
  return id;
}

export const listLeadPartners = cache(async (): Promise<LeadPartner[]> => {
  if (isDemo()) { const s = await getSession(); return can(s, 'partners.read') ? demo().leadPartners : []; }
  const sb = await supabaseServer();
  return readOrEmpty<LeadPartner>(sb.from('lead_partners').select('*'));
});

export async function linkPartner(leadId: number, partnerId: number, row: { need: LeadPartner['need']; gap_type: string | null; gap_note: string | null; evidence: string | null; status: LeadPartner['status'] }, id: number | null = null): Promise<void> {
  const s = await requirePerm('assess.edit', 'link partners to opportunities');
  if (!id && !String(row.gap_note || '').trim()) throw new Error('Explain which requirement or delivery gap this partner covers.');
  if (isDemo()) {
    const st = demo(); const name = st.partners.find(p => p.id === partnerId)?.name || 'partner';
    if (id) { const lp = st.leadPartners.find(x => x.id === id && x.lead_id === leadId); if (!lp) throw new Error('Not found'); Object.assign(lp, row); demoLog(st, s, leadId, 'partner', `${name} — ${lp.need} / ${lp.status}`); }
    else {
      if (st.leadPartners.some(x => x.lead_id === leadId && x.partner_id === partnerId)) throw new Error('This partner is already linked.');
      st.leadPartners.push({ id: nextSeq(st), lead_id: leadId, partner_id: partnerId, ...row, added_by: s.user.id, created_at: now() });
      demoLog(st, s, leadId, 'partner', `${name} — ${row.need} / ${row.status}`);
    }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  if (id) check(await sb.from('lead_partners').update(row).eq('id', id).eq('lead_id', leadId).select('id'));
  else check(await sb.from('lead_partners').insert({ lead_id: leadId, partner_id: partnerId, ...row, added_by: s.user.id }).select('id'));
}

export async function unlinkPartner(leadId: number, id: number): Promise<void> {
  const s = await requirePerm('assess.edit', 'remove partner links');
  if (isDemo()) {
    const st = demo(); const lp = st.leadPartners.find(x => x.id === id && x.lead_id === leadId);
    if (lp) { st.leadPartners = st.leadPartners.filter(x => x.id !== id); demoLog(st, s, leadId, 'partner', `removed ${st.partners.find(p => p.id === lp.partner_id)?.name || 'partner'}`); }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('lead_partners').delete().eq('id', id).eq('lead_id', leadId).select('id'));
}

// ---------------- knowledge base (company evidence) ----------------
const KB_KEYS: (keyof KbDoc)[] = ['name', 'entity', 'doc_type', 'owner', 'doc_date', 'expires_on', 'version', 'confidentiality', 'approval', 'tags', 'location', 'summary'];

export const listKb = cache(async (): Promise<{ docs: KbDoc[]; hiddenRestricted: number }> => {
  const s = await getSession();
  if (isDemo()) {
    if (!can(s, 'kb.read')) return { docs: [], hiddenRestricted: 0 };
    const all = demo().kb; const ok = can(s, 'kb.read_restricted');
    return { docs: all.filter(d => ok || d.confidentiality !== 'Restricted'), hiddenRestricted: ok ? 0 : all.filter(d => d.confidentiality === 'Restricted').length };
  }
  const sb = await supabaseServer();
  // Supabase returns at most 1000 rows per request: read in pages (the ingest can load a few thousand documents).
  const docs: KbDoc[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const part = await readOrEmpty<KbDoc>(sb.from('kb_documents').select('*').order('entity').order('name').order('id').range(from, from + 999));
    docs.push(...part);
    if (part.length < 1000) break;
  }
  return { docs, hiddenRestricted: 0 };
});

export async function saveKb(id: number | null, row: Row): Promise<void> {
  const s = await requirePerm('kb.edit', 'edit the knowledge base');
  const patch = pick<KbDoc>(row, KB_KEYS);
  if (patch.confidentiality === 'Restricted' && !can(s, 'kb.read_restricted')) throw new NotAllowed('Only roles that can see restricted documents can add or edit one.');
  if (patch.approval === 'Approved' && !can(s, 'kb.approve')) throw new NotAllowed(`Your role (${s.orgRole}) cannot approve evidence. Save it as Draft for review.`);
  if (/patient|password|private key|secret|api key/i.test(`${patch.name || ''} ${patch.summary || ''} ${patch.tags || ''}`)) throw new Error('Do not store patient data, credentials or secrets in the knowledge base.');
  if (!id && !String(patch.name || '').trim()) throw new Error('Name the document.');
  if (isDemo()) {
    const st = demo();
    if (id) { const d = st.kb.find(x => x.id === id); if (!d) throw new Error('Not found'); if (d.confidentiality === 'Restricted' && !can(s, 'kb.read_restricted')) throw new NotAllowed('Restricted document.'); Object.assign(d, patch, { updated_at: now() }); demoAudit(st, s, 'kb_documents', id, 'UPDATE', Object.keys(patch)); }
    else { const nid = nextSeq(st); st.kb.push({ id: nid, name: '', entity: 'NCPL', doc_type: 'Other', owner: s.user.id, doc_date: null, expires_on: null, version: null, confidentiality: 'Internal', approval: 'Draft', tags: null, location: null, summary: null, created_at: now(), updated_at: now(), ...patch } as KbDoc); demoAudit(st, s, 'kb_documents', nid, 'INSERT'); }
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  if (id) check(await sb.from('kb_documents').update({ ...patch, updated_at: now() }).eq('id', id).select('id'));
  else check(await sb.from('kb_documents').insert({ owner: s.user.id, ...patch }).select('id'));
}

// ---------------- relationships (personal leads) ----------------
const REL_KEYS: (keyof Relationship)[] = ['organisation', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'status', 'last_touch', 'next_followup', 'next_action', 'visibility', 'linked_lead'];

/** Your own relationships, plus ones others shared with leadership if your role may see them (contacts masked). */
export const listRelationships = cache(async (): Promise<Relationship[]> => {
  const s = await getSession(); if (!s) return [];
  let rows: Relationship[];
  if (isDemo()) rows = demo().relationships.filter(r => r.owner === s.user.id || (r.visibility === 'Shared with leadership' && can(s, 'relationships.read_shared')));
  else {
    const sb = await supabaseServer();
    rows = await readOrEmpty<Relationship>(sb.from('relationships').select('*').order('next_followup', { ascending: true, nullsFirst: false }));
    if (can(s, 'relationships.read_shared')) {
      const shared = await sb.rpc('shared_relationships');
      if (!shared.error) rows = rows.concat(((shared.data || []) as Row[]).map(r => ({ contact_name: null, contact_email: null, contact_phone: null, visibility: 'Shared with leadership', created_at: '', updated_at: '', ...r }) as unknown as Relationship));
    }
  }
  return rows.map(r => r.owner === s.user.id ? r : { ...r, contact_email: r.contact_email ? '__hidden__' : null, contact_phone: r.contact_phone ? '__hidden__' : null });
});

export async function saveRelationship(id: number | null, row: Row): Promise<number> {
  const s = await requireMember();
  const patch = pick<Relationship>(row, REL_KEYS);
  if (!id && !String(patch.organisation || '').trim()) throw new Error('Name the organisation.');
  if (isDemo()) {
    const st = demo();
    if (id) { const r = st.relationships.find(x => x.id === id); if (!r || r.owner !== s.user.id) throw new NotAllowed('Only the owner can change this relationship.'); Object.assign(r, patch, { updated_at: now() }); }
    else { id = nextSeq(st); st.relationships.push({ id, owner: s.user.id, organisation: '', contact_name: null, contact_role: null, contact_email: null, contact_phone: null, status: 'New', last_touch: null, next_followup: null, next_action: null, visibility: 'Private', linked_lead: null, created_at: now(), updated_at: now(), ...patch } as Relationship); }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { const rows = check(await sb.from('relationships').update({ ...patch, updated_at: now() }).eq('id', id).eq('owner', s.user.id).select('id')) as unknown[]; if (!rows.length) throw new NotAllowed('Only the owner can change this relationship.'); return id; }
  const rows = check(await sb.from('relationships').insert({ ...patch, owner: s.user.id }).select('id')) as { id: number }[];
  return rows[0]!.id;
}

export async function listRelNotes(): Promise<RelNote[]> {
  const s = await getSession(); if (!s) return [];
  if (isDemo()) { const mine = new Set(demo().relationships.filter(r => r.owner === s.user.id).map(r => r.id)); return demo().relNotes.filter(n => mine.has(n.relationship_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  const sb = await supabaseServer();
  return readOrEmpty<RelNote>(sb.from('relationship_notes').select('*').order('created_at', { ascending: false }));
}

export async function addRelNote(relationshipId: number, body: string): Promise<void> {
  const s = await requireMember();
  const text = body.trim().slice(0, 3000); if (!text) return;
  if (isDemo()) {
    const st = demo(); const r = st.relationships.find(x => x.id === relationshipId);
    if (!r || r.owner !== s.user.id) throw new NotAllowed('Only the owner can add private notes.');
    st.relNotes.push({ id: nextSeq(st), relationship_id: relationshipId, author: s.user.id, body: text, created_at: now() });
    r.last_touch = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('relationship_notes').insert({ relationship_id: relationshipId, author: s.user.id, body: text }).select('id'));
}

// ---------------- integration events (meetings, Chat notifications) ----------------
export const listEvents = cache(async (): Promise<IntegrationEvent[]> => {
  const s = await getSession(); if (!s) return [];
  if (isDemo()) return demo().events.filter(e => e.created_by === s.user.id || can(s, 'audit.read')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sb = await supabaseServer();
  return readOrEmpty<IntegrationEvent>(sb.from('integration_events').select('*').order('created_at', { ascending: false }).limit(300));
});

export async function recordEvent(row: Omit<IntegrationEvent, 'id' | 'created_by' | 'created_at'>, system = false): Promise<number> {
  const s = system ? await requireMember() : await requirePerm('integrations.use', 'prepare meetings or notifications');
  if (isDemo()) {
    const st = demo(); const id = nextSeq(st);
    st.events.push({ ...row, id, created_by: s.user.id, created_at: now() });
    if (row.kind === 'calendar' && row.lead_id) demoLog(st, s, row.lead_id, 'meeting', `Meeting prepared: ${row.title}`);
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  const res = await sb.from('integration_events').insert({ ...row, created_by: s.user.id }).select('id');
  if (res.error) return 0;            // never block the main action because the log failed
  return (res.data as { id: number }[])[0]?.id || 0;
}

export async function setEventStatus(id: number, status: IntegrationEvent['status'], error: string | null = null): Promise<void> {
  const s = await requireMember();
  if (isDemo()) { const e = demo().events.find(x => x.id === id && x.created_by === s.user.id); if (e) { e.status = status; e.error = error; } saveDemo(); return; }
  const sb = await supabaseServer();
  await sb.from('integration_events').update({ status, error }).eq('id', id);
}

// ---------------- saved views ----------------
export async function listViews(): Promise<SavedView[]> {
  const s = await getSession(); if (!s) return [];
  if (isDemo()) return demo().views.filter(v => v.owner === s.user.id);
  const sb = await supabaseServer();
  return readOrEmpty<SavedView>(sb.from('saved_views').select('*').eq('owner', s.user.id).order('name'));
}
export async function saveView(name: string, query: string): Promise<void> {
  const s = await requireMember();
  const n = name.trim().slice(0, 60); if (!n) throw new Error('Name the view.');
  const q = query.replace(/^\?/, '').slice(0, 1000);
  if (isDemo()) { const st = demo(); st.views.push({ id: nextSeq(st), owner: s.user.id, name: n, query: q, created_at: now() }); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('saved_views').insert({ owner: s.user.id, name: n, query: q }).select('id'));
}
export async function deleteView(id: number): Promise<void> {
  const s = await requireMember();
  if (isDemo()) { const st = demo(); st.views = st.views.filter(v => !(v.id === id && v.owner === s.user.id)); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('saved_views').delete().eq('id', id).eq('owner', s.user.id).select('id'));
}

// ---------------- audit, permissions ----------------
export async function listAudit(): Promise<AuditEntry[]> {
  const s = await getSession(); if (!can(s, 'audit.read')) return [];
  if (isDemo()) return [...demo().audit].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300);
  const sb = await supabaseServer();
  return readOrEmpty<AuditEntry>(sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300));
}

export const listRolePerms = cache(async (): Promise<RolePerm[]> => {
  if (isDemo()) return demo().rolePerms;
  const sb = await supabaseServer();
  return readOrEmpty<RolePerm>(sb.from('role_permissions').select('*'));
});

export async function setRolePerm(orgRole: RolePerm['org_role'], permission: string, allowed: boolean, status: RolePerm['status'], note: string | null): Promise<void> {
  const s = await requireAdmin();
  if (!PERM_KEYS.includes(permission)) throw new Error('Unknown permission');
  if (isDemo()) {
    const st = demo(); const r = st.rolePerms.find(x => x.org_role === orgRole && x.permission === permission);
    if (r) Object.assign(r, { allowed, status, note, updated_by: s.user.id, updated_at: now() });
    else st.rolePerms.push({ org_role: orgRole, permission, allowed, status, note, updated_by: s.user.id, updated_at: now() });
    demoAudit(st, s, 'role_permissions', `${orgRole}:${permission}`, 'UPDATE', ['allowed', 'status']);
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('role_permissions').upsert({ org_role: orgRole, permission, allowed, status, note, updated_by: s.user.id, updated_at: now() }).select('permission'));
}
