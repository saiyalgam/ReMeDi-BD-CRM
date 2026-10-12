// All reads and writes go through here. Real mode uses Supabase as the signed-in person; demo mode uses memory.
import { cache } from 'react';
import { isDemo, supabaseConfig } from './env';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { demo, DEMO_ME, saveDemo } from './demo';
import { fetchFeeds } from './news';
import { normalizeIngestRow, planUpdate, sameNotice, titleKey, type IngestLead } from './leadtype';
import { todayIST } from './format';
import { LEAD_DEFAULTS } from './defaults';
import type { AccessRule, Activity, Decision, IngestRun, Lead, Member, NewsFeed, NewsItem, Relevance, Session, Stage, Verification } from './types';

export class NotAllowed extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ---------------- session ----------------
export const getSession = cache(async (): Promise<Session | null> => {
  if (isDemo()) return { user: demo().members.find(m => m.id === DEMO_ME)!, isMember: true, demo: true };
  if (!supabaseConfig()) return null;
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const [{ data: member }, { data: profile }] = await Promise.all([
    sb.rpc('is_team_member'),
    sb.from('profiles').select('id,email,full_name,role').eq('id', claims.sub).maybeSingle()
  ]);
  const email = String(claims.email || '');
  return {
    user: (profile as Member | null) || { id: claims.sub, email, full_name: email.split('@')[0] || email, role: 'member' },
    isMember: member === true,
    demo: false
  };
});

async function requireMember(): Promise<Session> {
  const s = await getSession();
  if (!s || !s.isMember) throw new NotAllowed('Sign in with an approved email first.');
  return s;
}
async function requireAdmin(): Promise<Session> {
  const s = await requireMember();
  if (s.user.role !== 'admin') throw new NotAllowed('Only an admin can do that.');
  return s;
}

// ---------------- reads ----------------
export const listMembers = cache(async (): Promise<Member[]> => {
  if (isDemo()) return demo().members;
  const sb = await supabaseServer();
  return check(await sb.from('profiles').select('id,email,full_name,role').order('full_name'));
});

export const listLeads = cache(async (): Promise<Lead[]> => {
  if (isDemo()) return demo().leads;
  const sb = await supabaseServer();
  return check(await sb.from('leads').select('*').order('deadline', { ascending: true, nullsFirst: false }).limit(5000));
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
  return { lead, activity: activity as Activity[] };
}

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
export const DETAIL_FIELDS = ['title', 'funder_buyer', 'country', 'deadline', 'deadline_note', 'amount', 'ref_no', 'url', 'summary'] as const;
export const PURSUIT_FIELDS = ['rfp_status', 'applied_on', 'pitch_summary', 'contact_name', 'contact_role', 'contact_email', 'contact_phone', 'next_followup'] as const;
export interface LeadPatch {
  verification?: Verification; verification_note?: string | null; stage?: Stage; assigned_to?: string | null;
  decision?: Decision; decision_reason?: string | null;
  [field: string]: unknown;
}

const LABEL: Record<string, string> = { title: 'title', funder_buyer: 'buyer', country: 'country', amount: 'value', ref_no: 'reference', url: 'link', summary: 'summary', deadline_note: 'deadline note' };

export async function updateLead(id: number, patch: LeadPatch): Promise<void> {
  const s = await requireMember();
  if (isDemo()) {
    const st = demo(); const l = st.leads.find(x => x.id === id); if (!l) return;
    Object.assign(l, { ...LEAD_DEFAULTS, ...l });
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
      l.decision = patch.decision; l.decision_reason = (patch.decision_reason as string | null) ?? null; l.decided_by = s.user.id; l.decided_at = now;
      log('decision', l.decision + (l.decision_reason ? ': ' + l.decision_reason : ''));
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
  check(await sb.from('leads').update(patch).eq('id', id).select('id'));
}

/** A lead someone heard about outside the crawler (WhatsApp, a client, GeM). */
export async function createLead(row: Record<string, unknown>): Promise<number> {
  const s = await requireMember();
  const uid = 'M-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const n = normalizeIngestRow({ ...row, uid, origin: 'manual', source: row.source || `Added by ${s.user.full_name || s.user.email}` }, todayIST());
  if (!n.ok) throw new Error(n.reason === 'missing title' ? 'Give the lead a title.' : n.reason);
  if (isDemo()) {
    const st = demo(); const now = new Date().toISOString(); const id = st.nextId++;
    st.leads.push({ ...LEAD_DEFAULTS, ...n.lead, id, created_at: now, updated_at: now } as Lead);
    st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: s.user.id, action: 'created', detail: 'Added by hand', created_at: now });
    saveDemo(st);
    return id;
  }
  const sb = await supabaseServer();
  const rows = check(await sb.from('leads').insert(n.lead).select('id')) as { id: number }[];
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
export interface IngestResult { received: number; valid: number; inserted: number; updated: number; unchanged: number; rejected: { index: number; reason: string }[] }

/**
 * Crawler deliveries and reviewed JSON files.
 * New uids are inserted. A lead that already exists (same uid, or the same title under another id) is never
 * duplicated; instead planUpdate() decides what may change, so the team's own fields are never overwritten.
 */
export async function ingestLeads(rows: unknown[], note?: string, mode: 'insert' | 'update' = 'insert'): Promise<IngestResult> {
  const today = todayIST();
  const valid: { lead: IngestLead; row: Record<string, unknown> }[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((r, i) => { const n = normalizeIngestRow(r as Record<string, unknown>, today); if (n.ok) valid.push({ lead: n.lead, row: r as Record<string, unknown> }); else rejected.push({ index: i, reason: n.reason }); });
  const unique = [...new Map(valid.map(v => [v.lead.uid, v])).values()];
  let inserted = 0, updated = 0, unchanged = 0;

  const existing: Record<string, unknown>[] = isDemo()
    ? (demo().leads as unknown as Record<string, unknown>[])
    : (check(await supabaseAdmin().from('leads').select('*').limit(20000)) as Record<string, unknown>[]);
  const byUid = new Map(existing.map(e => [String(e.uid), e]));
  const byTitle = new Map<string, Record<string, unknown>[]>();
  const addTitle = (e: Record<string, unknown>) => { const k = titleKey(e.title); if (k.length >= 25) byTitle.set(k, [...(byTitle.get(k) || []), e]); };
  existing.forEach(addTitle);

  const toInsert: IngestLead[] = [];
  const toUpdate: { id: number; patch: Record<string, unknown> }[] = [];
  for (const { lead, row } of unique) {
    const cand = byTitle.get(titleKey(lead.title)) || [];
    const match = byUid.get(lead.uid) || cand.find(e => sameNotice(e, lead as unknown as Record<string, unknown>));
    if (!match) { toInsert.push(lead); addTitle(lead as unknown as Record<string, unknown>); continue; }
    const patch = planUpdate(match, lead, row, mode);
    if (Object.keys(patch).length) toUpdate.push({ id: Number(match.id), patch }); else unchanged++;
  }

  if (isDemo()) {
    const st = demo(); const now = new Date().toISOString();
    for (const l of toInsert) {
      const id = st.nextId++;
      st.leads.push({ ...LEAD_DEFAULTS, ...l, id, created_at: now, updated_at: now } as Lead);
      st.activity.push({ id: st.activity.length + 1, lead_id: id, actor: null, action: 'created', detail: l.origin === 'manual' ? 'Added by hand' : `Found by the crawler (${l.source || 'unknown source'})`, created_at: now });
      inserted++;
    }
    for (const u of toUpdate) {
      const l = st.leads.find(x => x.id === u.id) as unknown as Record<string, unknown>; if (!l) continue;
      const bits = Object.keys(u.patch).filter(k => k !== 'deadline_note').map(k => k === 'deadline' ? `Deadline ${l.deadline || 'none'} → ${u.patch.deadline}` : k.replace(/_/g, ' '));
      Object.assign(l, u.patch, { updated_at: now });
      if (u.patch.decision) st.activity.push({ id: st.activity.length + 1, lead_id: u.id, actor: null, action: 'decision', detail: `${u.patch.decision}${u.patch.decision_reason ? ': ' + u.patch.decision_reason : ''}`, created_at: now });
      st.activity.push({ id: st.activity.length + 1, lead_id: u.id, actor: null, action: 'updated', detail: bits.filter(b => !b.startsWith('decision')).join('; ') || 'Assessment refreshed', created_at: now });
      updated++;
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
    await sb.from('ingest_runs').insert({ received: rows.length, inserted, updated, note: note || null });
  }
  return { received: rows.length, valid: unique.length, inserted, updated, unchanged, rejected };
}

export interface Lesson { title: string; category: string; verdict: string; reason: string }

/** What the crawler needs before it scores: leads already known (to skip) and the team's verdicts (to learn from). */
export async function knownLeadKeys(): Promise<{ uids: string[]; titles: string[]; deadlines: Record<string, string>; lessons: Lesson[] }> {
  const rows = (isDemo() ? demo().leads : check(await supabaseAdmin().from('leads').select('uid,title,category,deadline,verification,verification_note,decision,decision_reason,updated_at').limit(20000))) as Lead[];
  const lessons: Lesson[] = rows
    .map(l => (l.decision && l.decision !== 'Undecided' && l.decision_reason) ? { l, verdict: l.decision === 'Go' ? 'Team said GO' : 'Team said NO-GO', reason: l.decision_reason }
      : (l.verification === 'Incorrect' || l.verification === 'Duplicate') && l.verification_note ? { l, verdict: l.verification === 'Incorrect' ? 'Team marked WRONG LEAD' : 'Team marked DUPLICATE', reason: l.verification_note } : null)
    .filter((x): x is { l: Lead; verdict: string; reason: string } => !!x)
    .sort((a, b) => String(b.l.updated_at || '').localeCompare(String(a.l.updated_at || '')))
    .slice(0, 40)
    .map(x => ({ title: x.l.title, category: x.l.category, verdict: x.verdict, reason: x.reason }));
  return {
    uids: rows.map(r => r.uid),
    titles: rows.map(r => r.title),
    deadlines: Object.fromEntries(rows.filter(r => r.deadline).map(r => [r.uid, String(r.deadline).slice(0, 10)])),
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
