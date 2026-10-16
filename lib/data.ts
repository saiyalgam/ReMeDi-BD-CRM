// All reads and writes go through here. Real mode uses Supabase as the signed-in person (row-level security and
// triggers enforce permissions); demo mode uses memory and applies the same rules in code.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { isDemo, supabaseConfig } from './env';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { demo, DEMO_ME, nextSeq, saveDemo } from './demo';
import { fetchFeeds } from './news';
import { normalizeIngestRow, planUpdate, sameNotice, titleKey, type IngestLead } from './leadtype';
import { todayIST } from './format';
import { LEAD_DEFAULTS } from './defaults';
import { can, defaultRolePerms, effectivePerms } from './perm';
import { LEGACY_STAGE, ORG_ROLES } from './types';
import type { AccessRule, Activity, Decision, IngestRun, Lead, Member, NewsFeed, NewsItem, OrgRole, Relevance, RolePerm, Session, Stage, Verification } from './types';

export class NotAllowed extends Error {}

export function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendly(res.error.message));
  return res.data as T;
}
/** Database messages people can act on (row-level security failures read as a permission problem). */
function friendly(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return 'Your role does not allow this. Ask an admin if you need access.';
  return msg;
}

const fixStage = (l: Lead): Lead => (LEGACY_STAGE[l.stage] ? { ...l, stage: LEGACY_STAGE[l.stage]! } : l);

// ---------------- session ----------------
export const DEMO_AS_COOKIE = 'demo_as';

export const getSession = cache(async (): Promise<Session | null> => {
  if (isDemo()) {
    const st = demo();
    let as = DEMO_ME;
    try { as = (await cookies()).get(DEMO_AS_COOKIE)?.value || DEMO_ME; } catch { /* outside a request */ }
    const user = st.members.find(m => m.id === as) || st.members.find(m => m.id === DEMO_ME)!;
    const orgRole = (user.org_role || 'BD Executive') as OrgRole;
    return { user, isMember: true, demo: true, orgRole, perms: effectivePerms(st.rolePerms, orgRole, user.role === 'admin') };
  }
  if (!supabaseConfig()) return null;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const [{ data: member }, { data: profile }] = await Promise.all([
    sb.rpc('is_team_member'),
    sb.from('profiles').select('*').eq('id', claims.sub).maybeSingle()
  ]);
  const email = String(claims.email || '');
  const user = (profile as Member | null) || { id: claims.sub, email, full_name: email.split('@')[0] || email, role: 'member' as const, org_role: null };
  const orgRole = ((user.org_role && (ORG_ROLES as readonly string[]).includes(user.org_role)) ? user.org_role : 'BD Executive') as OrgRole;
  let rows: RolePerm[] = [];
  if (member === true) {
    const res = await sb.from('role_permissions').select('*').eq('org_role', orgRole);
    // Before update-3.sql is installed the table does not exist: fall back to the defaults so the app still runs.
    rows = res.error ? defaultRolePerms() : (res.data as RolePerm[]);
  }
  return { user, isMember: member === true, demo: false, orgRole, perms: effectivePerms(rows, orgRole, user.role === 'admin') };
});

export async function requireMember(): Promise<Session> {
  const s = await getSession();
  if (!s || !s.isMember) throw new NotAllowed('Sign in with an approved email first.');
  return s;
}
export async function requireAdmin(): Promise<Session> {
  const s = await requireMember();
  if (s.user.role !== 'admin') throw new NotAllowed('Only an admin can do that.');
  return s;
}
export async function requirePerm(p: string, what = 'do that'): Promise<Session> {
  const s = await requireMember();
  if (!can(s, p)) throw new NotAllowed(`Your role (${s.orgRole}) cannot ${what}. Ask an admin if you need access.`);
  return s;
}

// ---------------- reads ----------------
export const listMembers = cache(async (): Promise<Member[]> => {
  if (isDemo()) return demo().members;
  const sb = await supabaseServer();
  return check(await sb.from('profiles').select('*').order('full_name'));
});

export const listLeads = cache(async (): Promise<Lead[]> => {
  if (isDemo()) return demo().leads;
  const sb = await supabaseServer();
  const rows = check(await sb.from('leads').select('*').order('deadline', { ascending: true, nullsFirst: false }).limit(5000)) as Lead[];
  return rows.map(r => fixStage({ ...LEAD_DEFAULTS, ...r } as Lead));
});

export async function getLead(id: number): Promise<{ lead: Lead; activity: Activity[] } | null> {
  if (isDemo()) {
    const lead = demo().leads.find(l => l.id === id);
    return lead ? { lead, activity: demo().activity.filter(a => a.lead_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id) } : null;
  }
  const sb = await supabaseServer();
  const lead = check(await sb.from('leads').select('*').eq('id', id).maybeSingle()) as Lead | null;
  if (!lead) return null;
  const activity = check(await sb.from('lead_activity').select('*').eq('lead_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }));
  return { lead: fixStage({ ...LEAD_DEFAULTS, ...lead } as Lead), activity: activity as Activity[] };
}

/** Recent history across all leads (dashboard feed, team activity). */
export const listActivity = cache(async (limit = 400): Promise<Activity[]> => {
  if (isDemo()) return [...demo().activity].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, limit);
  const sb = await supabaseServer();
  return check(await sb.from('lead_activity').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)) as Activity[];
});

export const listNews = cache(async (): Promise<NewsItem[]> => {
  if (isDemo()) return [...demo().news].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const sb = await supabaseServer();
  return check(await sb.from('news_items').select('*').order('published_at', { ascending: false, nullsFirst: false }).limit(400));
});

export async function listFeeds(): Promise<NewsFeed[]> {
  if (isDemo()) return demo().feeds;
  const sb = await supabaseServer();
  return check(await sb.from('news_feeds').select('*').order('name'));
}

export async function listAccess(): Promise<AccessRule[]> {
  if (isDemo()) return demo().access;
  const sb = await supabaseServer();
  return check(await sb.from('access_list').select('pattern,note').order('pattern'));
}

export async function lastIngest(): Promise<IngestRun | null> {
  if (isDemo()) return demo().runs[0] || null;
  const sb = await supabaseServer();
  const rows = check(await sb.from('ingest_runs').select('*').order('run_at', { ascending: false }).limit(1)) as IngestRun[];
  return rows[0] || null;
}

// ---------------- writes (team) ----------------
// Fields a team member may edit on the lead page (history rows are written by the database trigger).
export const DETAIL_FIELDS = ['title', 'funder_buyer', 'country', 'deadline', 'deadline_note', 'amount', 'ref_no', 'url', 'summary', 'value_band'] as const;
export const PURSUIT_FIELDS = ['rfp_status', 'applied_on', 'pitch_summary', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'next_followup'] as const;
export const ASSESS_FIELDS = ['eligibility_status', 'eligibility_summary', 'partner_need'] as const;
export interface LeadPatch {
  verification?: Verification; verification_note?: string | null; stage?: Stage; assigned_to?: string | null;
  decision?: Decision; decision_reason?: string | null;
  [field: string]: unknown;
}

const LABEL: Record<string, string> = { title: 'title', funder_buyer: 'buyer', country: 'country', amount: 'value', ref_no: 'reference', url: 'link', summary: 'summary', deadline_note: 'deadline note', value_band: 'value band' };

/** The same rules the database trigger applies (supabase/update-3.sql, leads_before_update). Throws NotAllowed. */
export function checkLeadPatch(s: Session, l: Lead, patch: LeadPatch): void {
  const changed = (k: string) => k in patch && (patch[k] ?? null) !== ((l as unknown as Record<string, unknown>)[k] ?? null);
  const deny = (what: string) => { throw new NotAllowed(`Your role (${s.orgRole}) cannot ${what}.`); };
  if (changed('verification') && !can(s, 'opp.verify')) deny('change lead verification');
  if (changed('assigned_to')) {
    const to = (patch.assigned_to ?? null) as string | null;
    const ok = (!l.assigned_to && to === s.user.id && can(s, 'opp.claim'))
      || (l.assigned_to === s.user.id && to === null)
      || (!l.assigned_to && can(s, 'opp.assign'))
      || (!!l.assigned_to && can(s, 'opp.reassign'));
    if (!ok) deny(l.assigned_to ? 'move this opportunity to someone else' : 'assign this opportunity');
  }
  if (changed('decision') && !can(s, 'decision.approve')) deny('approve a Go / No-go decision (you can recommend one)');
  if ((changed('recommended_decision') || changed('recommendation_reason')) && !can(s, 'decision.recommend')) deny('recommend a decision');
  if (changed('approval_status') && ['Approved', 'Returned'].includes(String(patch.approval_status)) && !can(s, 'decision.approve')) deny('approve decisions');
  if (changed('deadline') && !can(s, 'deadline.verify')) deny('change the active deadline (record an amendment instead)');
  if (ASSESS_FIELDS.some(changed) && !can(s, 'assess.edit')) deny('change the eligibility assessment');
  const editFields = ['title', 'funder_buyer', 'country', 'amount', 'ref_no', 'url', 'summary', 'stage', 'deadline_note', 'value_band', 'duplicate_of', ...PURSUIT_FIELDS];
  if (editFields.some(changed) && !can(s, 'opp.edit')) deny('edit this opportunity');
}

export async function updateLead(id: number, patch: LeadPatch): Promise<void> {
  const s = await requireMember();
  if (isDemo()) {
    const st = demo(); const l = st.leads.find(x => x.id === id); if (!l) return;
    Object.assign(l, { ...LEAD_DEFAULTS, ...l });
    checkLeadPatch(s, l, patch);
    const r = l as unknown as Record<string, unknown>;
    const now = new Date().toISOString();
    const log = (action: Activity['action'], detail: string) => st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: s.user.id, action, detail, created_at: now });
    if (patch.verification !== undefined && patch.verification !== l.verification) {
      l.verification = patch.verification; l.verified_by = s.user.id; l.verified_at = now;
      if (patch.verification_note !== undefined) l.verification_note = patch.verification_note;
      log('verified', l.verification + (l.verification_note ? ': ' + l.verification_note : ''));
    } else if (patch.verification_note !== undefined) l.verification_note = patch.verification_note;
    if (patch.assigned_to !== undefined && patch.assigned_to !== l.assigned_to) {
      l.assigned_to = patch.assigned_to; l.assigned_at = patch.assigned_to ? now : null;
      const who = st.members.find(m => m.id === patch.assigned_to);
      log('assigned', who ? 'Assigned to ' + (who.full_name || who.email) : 'Unassigned');
    }
    if (patch.stage !== undefined && patch.stage !== l.stage) { log('stage', `${l.stage} → ${patch.stage}`); l.stage = patch.stage; }
    if (patch.decision !== undefined && (patch.decision !== l.decision || (patch.decision_reason ?? null) !== l.decision_reason)) {
      l.decision = patch.decision; l.decision_reason = (patch.decision_reason as string | null) ?? null; l.decided_by = s.user.id; l.decided_at = patch.decision === 'Undecided' ? null : now;
      log('decision', l.decision + (l.decision_reason ? ': ' + l.decision_reason : ''));
    }
    if (('recommended_decision' in patch && patch.recommended_decision !== l.recommended_decision) || ('recommendation_reason' in patch && patch.recommendation_reason !== l.recommendation_reason)) {
      l.recommended_decision = (patch.recommended_decision ?? null) as Lead['recommended_decision'];
      l.recommendation_reason = (patch.recommendation_reason ?? null) as string | null; l.recommended_by = s.user.id; l.recommended_at = now;
      log('recommendation', (l.recommended_decision ? 'Recommended ' + l.recommended_decision : 'Recommendation withdrawn') + (l.recommendation_reason ? ': ' + l.recommendation_reason : ''));
    }
    if ('approval_status' in patch && patch.approval_status !== l.approval_status) {
      l.approval_status = patch.approval_status as Lead['approval_status'];
      if ('approval_note' in patch) l.approval_note = (patch.approval_note ?? null) as string | null;
      if (['Approved', 'Returned'].includes(l.approval_status)) log('approval', l.approval_status + (l.approval_note ? ': ' + l.approval_note : ''));
    }
    if (ASSESS_FIELDS.some(k => k in patch && (patch[k] ?? null) !== (r[k] ?? null))) {
      const elig = (k: string) => k in patch && (patch[k] ?? null) !== (r[k] ?? null);
      const eligChanged = elig('eligibility_status') || elig('eligibility_summary');
      const pnChanged = elig('partner_need');
      for (const k of ASSESS_FIELDS) if (k in patch) r[k] = patch[k] ?? null;
      if (eligChanged) { l.eligibility_by = s.user.id; l.eligibility_at = now; log('eligibility', l.eligibility_status + (l.eligibility_summary ? ': ' + l.eligibility_summary : '')); }
      if (pnChanged) log('partner', 'Partner need: ' + l.partner_need);
    }
    if ('duplicate_of' in patch && patch.duplicate_of !== l.duplicate_of) {
      l.duplicate_of = (patch.duplicate_of ?? null) as number | null;
      if (l.duplicate_of) log('merge', 'Marked duplicate of ' + (st.leads.find(x => x.id === l.duplicate_of)?.ref_code || '#' + l.duplicate_of));
    }
    const edits: string[] = [];
    for (const k of DETAIL_FIELDS) if (k in patch && (patch[k] ?? null) !== (r[k] ?? null)) {
      edits.push(k === 'deadline' ? `Deadline ${l.deadline || 'none'} → ${patch[k] || 'none'}` : LABEL[k]!);
      r[k] = patch[k] ?? null;
    }
    if (edits.length) log('edited', edits.join('; '));
    const pur: string[] = [];
    for (const k of PURSUIT_FIELDS) if (k in patch && (patch[k] ?? null) !== (r[k] ?? null)) { pur.push(k.replace(/_/g, ' ')); r[k] = patch[k] ?? null; }
    if (pur.length) log('pursuit', 'Updated ' + pur.join(', '));
    l.updated_at = now;
    saveDemo();
    return;
  }
  const sb = await supabaseServer();
  const cur = check(await sb.from('leads').select('*').eq('id', id).maybeSingle()) as Lead | null;
  if (!cur) throw new Error('This opportunity no longer exists.');
  checkLeadPatch(s, fixStage({ ...LEAD_DEFAULTS, ...cur } as Lead), patch);
  check(await sb.from('leads').update(patch).eq('id', id).select('id'));
}

/** A lead someone heard about outside the crawler (WhatsApp, a client, GeM) or a row from a spreadsheet import. */
export async function createLead(row: Record<string, unknown>, extra: Partial<Lead> = {}): Promise<number> {
  const s = await requirePerm('opp.create', 'add opportunities');
  const uid = String(row.uid || '') || 'M-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const n = normalizeIngestRow({ ...row, uid, origin: 'manual', source: row.source || `Added by ${s.user.full_name || s.user.email}` }, todayIST());
  if (!n.ok) throw new Error(n.reason === 'missing title' ? 'Give the lead a title.' : n.reason);
  if (isDemo()) {
    const st = demo(); const now = new Date().toISOString(); const id = st.nextId++;
    const lead = { ...LEAD_DEFAULTS, ...n.lead, ...extra, id, ref_code: `OPP-${todayIST().slice(0, 4)}-${String(st.refSeq++).padStart(4, '0')}`, created_at: now, updated_at: now } as Lead;
    st.leads.push(lead);
    st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: s.user.id, action: 'created', detail: String(row.import_note || 'Added by hand'), created_at: now });
    if (lead.deadline) st.deadlines.push({ id: nextSeq(st), lead_id: id, kind: 'Original', deadline: lead.deadline, previous: null, source: lead.source, source_url: lead.url, verified: true, verified_by: s.user.id, verified_at: now, rejected: false, note: null, created_by: s.user.id, created_at: now });
    saveDemo(st);
    return id;
  }
  const sb = await supabaseServer();
  const rows = check(await sb.from('leads').insert({ ...n.lead, ...extra }).select('id')) as { id: number }[];
  return rows[0]!.id;
}

export async function addComment(id: number, textIn: string): Promise<void> {
  const s = await requireMember();
  const detail = textIn.trim().slice(0, 2000);
  if (!detail) return;
  if (isDemo()) { const st = demo(); st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: s.user.id, action: 'comment', detail, created_at: new Date().toISOString() }); saveDemo(); return; }
  const sb = await supabaseServer();
  check(await sb.from('lead_activity').insert({ lead_id: id, actor: s.user.id, action: 'comment', detail }).select('id'));
}

export async function markNews(id: number, relevance: Relevance): Promise<void> {
  const s = await requireMember();
  if (isDemo()) { const n = demo().news.find(x => x.id === id); if (n) { n.relevance = relevance; n.marked_by = s.user.id; n.marked_at = new Date().toISOString(); } saveDemo(); return; }
  const sb = await supabaseServer();
  check(await sb.from('news_items').update({ relevance, marked_by: s.user.id, marked_at: new Date().toISOString() }).eq('id', id).select('id'));
}

export async function updateMyName(name: string): Promise<void> {
  const s = await requireMember();
  const full_name = name.trim().slice(0, 80);
  if (!full_name) return;
  if (isDemo()) { const m = demo().members.find(x => x.id === s.user.id); if (m) m.full_name = full_name; saveDemo(); return; }
  const sb = await supabaseServer();
  check(await sb.from('profiles').update({ full_name }).eq('id', s.user.id).select('id'));
}

// ---------------- writes (admin) ----------------
export async function setRole(memberId: string, role: 'member' | 'admin'): Promise<void> {
  await requireAdmin();
  if (isDemo()) { const m = demo().members.find(x => x.id === memberId); if (m) m.role = role; saveDemo(); return; }
  const sb = await supabaseServer();
  check(await sb.from('profiles').update({ role }).eq('id', memberId).select('id'));
}

export async function setOrgRole(memberId: string, orgRole: OrgRole | null): Promise<void> {
  await requireAdmin();
  if (orgRole && !(ORG_ROLES as readonly string[]).includes(orgRole)) throw new Error('Unknown role');
  if (isDemo()) {
    const st = demo(); const m = st.members.find(x => x.id === memberId);
    if (m) { m.org_role = orgRole; st.audit.push({ id: nextSeq(st), table_name: 'profiles', row_id: memberId, op: 'UPDATE', actor: (await getSession())!.user.id, changed: ['org_role'], created_at: new Date().toISOString() }); }
    saveDemo(); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('profiles').update({ org_role: orgRole }).eq('id', memberId).select('id'));
}

export async function addAccess(pattern: string, note: string): Promise<void> {
  await requireAdmin();
  const p = pattern.trim().toLowerCase();
  if (!/^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$/.test(p)) throw new Error('Enter a full email (name@company.com) or a domain starting with @ (@company.com).');
  if (isDemo()) { if (!demo().access.some(a => a.pattern === p)) demo().access.push({ pattern: p, note: note || null }); saveDemo(); return; }
  const sb = await supabaseServer();
  check(await sb.from('access_list').upsert({ pattern: p, note: note || null }).select('pattern'));
}

export async function removeAccess(pattern: string): Promise<void> {
  await requireAdmin();
  if (isDemo()) { const st = demo(); st.access = st.access.filter(a => a.pattern !== pattern); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('access_list').delete().eq('pattern', pattern).select('pattern'));
}

export async function addFeed(name: string, url: string, topic: string): Promise<void> {
  await requireAdmin();
  if (!/^https?:\/\/\S+$/i.test(url.trim())) throw new Error('Enter a full feed URL starting with https://');
  const row = { name: name.trim().slice(0, 100) || url, url: url.trim(), topic: topic.trim().slice(0, 40) || null, active: true };
  if (isDemo()) { const st = demo(); st.feeds.push({ id: Math.max(0, ...st.feeds.map(f => f.id)) + 1, ...row }); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('news_feeds').upsert(row, { onConflict: 'url' }).select('id'));
}

export async function removeFeed(id: number): Promise<void> {
  await requireAdmin();
  if (isDemo()) { const st = demo(); st.feeds = st.feeds.filter(f => f.id !== id); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('news_feeds').delete().eq('id', id).select('id'));
}

// ---------------- jobs (crawler ingest, daily news) ----------------
export interface IngestResult { received: number; valid: number; inserted: number; updated: number; unchanged: number; amendments: number; rejected: { index: number; reason: string }[] }

/**
 * Crawler deliveries and reviewed JSON files.
 * New uids are inserted. A lead that already exists (same uid, or the same title under another id) is never
 * duplicated; instead planUpdate() decides what may change, so the team's own fields are never overwritten.
 * A later closing date from the daily crawler is NOT applied directly: it is recorded as an unverified amendment
 * for the Review queue, and moves the active deadline only when someone verifies it. A reviewed JSON file
 * (mode "update") is treated as verified and recorded as a verified amendment.
 */
export async function ingestLeads(rows: unknown[], note?: string, mode: 'insert' | 'update' = 'insert'): Promise<IngestResult> {
  const today = todayIST();
  const valid: { lead: IngestLead; row: Record<string, unknown> }[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((r, i) => { const n = normalizeIngestRow(r as Record<string, unknown>, today); if (n.ok) valid.push({ lead: n.lead, row: r as Record<string, unknown> }); else rejected.push({ index: i, reason: n.reason }); });
  const unique = [...new Map(valid.map(v => [v.lead.uid, v])).values()];
  let inserted = 0, updated = 0, unchanged = 0, amendments = 0;

  const existing: Record<string, unknown>[] = isDemo()
    ? (demo().leads as unknown as Record<string, unknown>[])
    : (check(await supabaseAdmin().from('leads').select('*').limit(20000)) as Record<string, unknown>[]);
  const known = await knownAmendments();
  const byUid = new Map(existing.map(e => [String(e.uid), e]));
  const byTitle = new Map<string, Record<string, unknown>[]>();
  const addTitle = (e: Record<string, unknown>) => { const k = titleKey(e.title); if (k.length >= 25) byTitle.set(k, [...(byTitle.get(k) || []), e]); };
  existing.forEach(addTitle);

  const toInsert: IngestLead[] = [];
  const toUpdate: { id: number; patch: Record<string, unknown> }[] = [];
  const toAmend: { lead_id: number; deadline: string; previous: string | null; source: string; verified: boolean }[] = [];
  for (const { lead, row } of unique) {
    const cand = byTitle.get(titleKey(lead.title)) || [];
    const match = byUid.get(lead.uid) || cand.find(e => sameNotice(e, lead as unknown as Record<string, unknown>));
    if (!match) { toInsert.push(lead); addTitle(lead as unknown as Record<string, unknown>); continue; }
    const patch = planUpdate(match, lead, row, mode);
    if (patch.deadline) {
      const leadId = Number(match.id); const d = String(patch.deadline);
      const prev = match.deadline ? String(match.deadline).slice(0, 10) : null;
      const src = String(patch.deadline_note || (mode === 'update' ? `Reviewed import file${note ? ' (' + note + ')' : ''}` : `Crawler: ${lead.source || 'unknown source'}`)).slice(0, 300);
      if (mode === 'update') toAmend.push({ lead_id: leadId, deadline: d, previous: prev, source: src, verified: true });
      else if (!known.has(`${leadId}|${d}`)) { toAmend.push({ lead_id: leadId, deadline: d, previous: prev, source: src, verified: false }); }
      known.add(`${leadId}|${d}`);
      delete patch.deadline; delete patch.deadline_note;     // the amendment record moves the deadline once verified
    }
    if (Object.keys(patch).length) toUpdate.push({ id: Number(match.id), patch }); else unchanged++;
  }

  if (isDemo()) {
    const st = demo(); const now = new Date().toISOString();
    for (const l of toInsert) {
      const id = st.nextId++;
      st.leads.push({ ...LEAD_DEFAULTS, ...l, id, ref_code: `OPP-${today.slice(0, 4)}-${String(st.refSeq++).padStart(4, '0')}`, created_at: now, updated_at: now } as Lead);
      st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: null, action: 'created', detail: l.origin === 'manual' ? 'Added by hand' : `Found by the crawler (${l.source || 'unknown source'})`, created_at: now });
      if (l.deadline) st.deadlines.push({ id: nextSeq(st), lead_id: id, kind: 'Original', deadline: l.deadline, previous: null, source: l.source, source_url: l.url, verified: true, verified_by: null, verified_at: now, rejected: false, note: null, created_by: null, created_at: now });
      inserted++;
    }
    for (const u of toUpdate) {
      const l = st.leads.find(x => x.id === u.id) as unknown as Record<string, unknown>; if (!l) continue;
      const bits = Object.keys(u.patch).map(k => k.replace(/_/g, ' '));
      Object.assign(l, u.patch, { updated_at: now });
      if (u.patch.decision) st.activity.push({ id: st.activity.length + 1, lead_id: u.id, actor: null, action: 'decision', detail: `${u.patch.decision}${u.patch.decision_reason ? ': ' + u.patch.decision_reason : ''}`, created_at: now });
      st.activity.push({ id: st.activity.length + 1, lead_id: u.id, actor: null, action: 'updated', detail: bits.filter(b => !b.startsWith('decision')).join('; ') || 'Assessment refreshed', created_at: now });
      updated++;
    }
    for (const a of toAmend) {
      st.deadlines.push({ id: nextSeq(st), lead_id: a.lead_id, kind: 'Amendment', deadline: a.deadline, previous: a.previous, source: a.source, source_url: null, verified: a.verified, verified_by: null, verified_at: a.verified ? now : null, rejected: false, note: null, created_by: null, created_at: now });
      st.activity.push({ id: st.activity.length + 1, lead_id: a.lead_id, actor: null, action: 'deadline', detail: `Amendment ${a.deadline} ${a.verified ? '(verified, reviewed file)' : '(awaiting verification)'} · ${a.source}`, created_at: now });
      if (a.verified) { const l = st.leads.find(x => x.id === a.lead_id); if (l) { l.deadline = a.deadline; l.deadline_note = `Amended ${a.previous || ''} → ${a.deadline} (${a.source})`; } }
      amendments++;
    }
    st.runs.unshift({ id: st.runs.length + 1, run_at: now, received: rows.length, inserted, updated, note: note || null });
    saveDemo(st);
  } else {
    const sb = supabaseAdmin();
    for (let i = 0; i < toInsert.length; i += 200) {
      const res = await sb.from('leads').upsert(toInsert.slice(i, i + 200), { onConflict: 'uid', ignoreDuplicates: true }).select('id');
      inserted += check(res)?.length || 0;
    }
    for (const u of toUpdate) { check(await sb.from('leads').update(u.patch).eq('id', u.id).select('id')); updated++; }
    for (const a of toAmend) {
      const res = await sb.from('lead_deadlines').insert({ lead_id: a.lead_id, kind: 'Amendment', deadline: a.deadline, previous: a.previous, source: a.source, verified: a.verified });
      if (res.error) {
        // update-3.sql not installed yet: fall back to the old behaviour (move the deadline, note where it came from)
        check(await sb.from('leads').update({ deadline: a.deadline, deadline_note: a.source }).eq('id', a.lead_id).select('id'));
      }
      amendments++;
    }
    await sb.from('ingest_runs').insert({ received: rows.length, inserted, updated, note: note || null });
  }
  return { received: rows.length, valid: unique.length, inserted, updated, unchanged, amendments, rejected };
}

/** "leadId|date" for every amendment already recorded (so the daily crawler does not file the same one twice). */
async function knownAmendments(): Promise<Set<string>> {
  if (isDemo()) return new Set(demo().deadlines.filter(d => d.kind === 'Amendment').map(d => `${d.lead_id}|${d.deadline}`));
  const res = await supabaseAdmin().from('lead_deadlines').select('lead_id,deadline').eq('kind', 'Amendment').limit(50000);
  return new Set(((res.data || []) as { lead_id: number; deadline: string }[]).map(d => `${d.lead_id}|${String(d.deadline).slice(0, 10)}`));
}

export interface Lesson { title: string; category: string; verdict: string; reason: string }

/** What the crawler needs before it scores: leads already known (to skip) and the team's verdicts (to learn from). */
export async function knownLeadKeys(): Promise<{ uids: string[]; titles: string[]; deadlines: Record<string, string>; lessons: Lesson[] }> {
  const rows = (isDemo() ? demo().leads : check(await supabaseAdmin().from('leads').select('id,uid,title,category,deadline,verification,verification_note,decision,decision_reason,updated_at').limit(20000))) as Lead[];
  const lessons: Lesson[] = rows
    .map(l => (l.decision && l.decision !== 'Undecided' && l.decision_reason) ? { l, verdict: l.decision === 'Go' ? 'Team said GO' : 'Team said NO-GO', reason: l.decision_reason }
      : (l.verification === 'Incorrect' || l.verification === 'Duplicate') && l.verification_note ? { l, verdict: l.verification === 'Incorrect' ? 'Team marked WRONG LEAD' : 'Team marked DUPLICATE', reason: l.verification_note } : null)
    .filter((x): x is { l: Lead; verdict: string; reason: string } => !!x)
    .sort((a, b) => String(b.l.updated_at || '').localeCompare(String(a.l.updated_at || '')))
    .slice(0, 40)
    .map(x => ({ title: x.l.title, category: x.l.category, verdict: x.verdict, reason: x.reason }));
  // The latest date we know about (active or awaiting verification), so the crawler does not keep resending it.
  const pending = new Map<number, string>();
  for (const k of await knownAmendments()) { const [lid, d] = k.split('|'); const n = Number(lid); if (!pending.has(n) || d! > pending.get(n)!) pending.set(n, d!); }
  return {
    uids: rows.map(r => r.uid),
    titles: rows.map(r => r.title),
    deadlines: Object.fromEntries(rows.filter(r => r.deadline || pending.has(r.id)).map(r => {
      const a = r.deadline ? String(r.deadline).slice(0, 10) : ''; const p = pending.get(r.id) || '';
      return [r.uid, a > p ? a : p];
    })),
    lessons
  };
}

/** Pull every active feed into news_items. Used by the daily cron and the "Fetch news now" button. */
export async function refreshNews(): Promise<{ feeds: number; fetched: number; inserted: number; errors: string[] }> {
  if (isDemo()) {
    const st = demo();
    const { items, errors } = await fetchFeeds(st.feeds);
    let inserted = 0;
    for (const it of items) {
      if (st.news.some(n => n.guid === it.guid)) continue;
      st.news.push({ ...it, id: st.news.length + 1, relevance: 'Unreviewed', marked_by: null, marked_at: null });
      inserted++;
    }
    saveDemo(st);
    return { feeds: st.feeds.length, fetched: items.length, inserted, errors };
  }
  const sb = supabaseAdmin();
  const feeds = check(await sb.from('news_feeds').select('*').eq('active', true)) as NewsFeed[];
  const { items, errors } = await fetchFeeds(feeds);
  let inserted = 0;
  for (let i = 0; i < items.length; i += 200) {
    const res = await sb.from('news_items').upsert(items.slice(i, i + 200), { onConflict: 'guid', ignoreDuplicates: true }).select('id');
    inserted += check(res)?.length || 0;
  }
  // keep the table small: drop old items nobody marked relevant
  await sb.from('news_items').delete().lt('published_at', new Date(Date.now() - 90 * 864e5).toISOString()).neq('relevance', 'Relevant');
  return { feeds: feeds.length, fetched: items.length, inserted, errors };
}

export async function refreshNewsAsAdmin() { await requireAdmin(); return refreshNews(); }
