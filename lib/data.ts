// All reads and writes go through here. Real mode uses Supabase as the signed-in person; demo mode uses memory.
import { cache } from 'react';
import { isDemo, supabaseConfig } from './env';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { demo, DEMO_ME, saveDemo } from './demo';
import { fetchFeeds } from './news';
import { normalizeIngestRow, type IngestLead } from './leadtype';
import { todayIST } from './format';
import type { AccessRule, Activity, IngestRun, Lead, Member, NewsFeed, NewsItem, Relevance, Session, Stage, Verification } from './types';

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
export interface LeadPatch { verification?: Verification; verification_note?: string | null; stage?: Stage; assigned_to?: string | null }

export async function updateLead(id: number, patch: LeadPatch): Promise<void> {
  const s = await requireMember();
  if (isDemo()) {
    const st = demo(); const l = st.leads.find(x => x.id === id); if (!l) return;
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
    l.updated_at = now;
    saveDemo();
    return;
  }
  const sb = await supabaseServer();
  check(await sb.from('leads').update(patch).eq('id', id).select('id'));
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
/** Insert new crawler leads; existing uids are left untouched so the team's edits are never overwritten. */
export async function ingestLeads(rows: unknown[], note?: string): Promise<{ received: number; valid: number; inserted: number; rejected: { index: number; reason: string }[] }> {
  const today = todayIST();
  const valid: IngestLead[] = [];
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((r, i) => { const n = normalizeIngestRow(r as Record<string, unknown>, today); if (n.ok) valid.push(n.lead); else rejected.push({ index: i, reason: n.reason }); });
  const unique = [...new Map(valid.map(l => [l.uid, l])).values()];
  let inserted = 0;
  if (isDemo()) {
    const st = demo();
    for (const l of unique) {
      if (st.leads.some(x => x.uid === l.uid)) continue;
      const now = new Date().toISOString();
      st.leads.push({ ...l, id: st.nextId++, verification: 'Unverified', verification_note: null, verified_by: null, verified_at: null, stage: 'New', assigned_to: null, assigned_at: null, created_at: now, updated_at: now });
      st.activity.push({ id: st.activity.length + 1, lead_id: st.nextId - 1, actor: null, action: 'created', detail: `Found by the crawler (${l.source || 'unknown source'})`, created_at: now });
      inserted++;
    }
    st.runs.unshift({ id: st.runs.length + 1, run_at: new Date().toISOString(), received: rows.length, inserted, note: note || null });
    saveDemo(st);
  } else {
    const sb = supabaseAdmin();
    for (let i = 0; i < unique.length; i += 200) {
      const res = await sb.from('leads').upsert(unique.slice(i, i + 200), { onConflict: 'uid', ignoreDuplicates: true }).select('id');
      inserted += check(res)?.length || 0;
    }
    await sb.from('ingest_runs').insert({ received: rows.length, inserted, note: note || null });
  }
  return { received: rows.length, valid: unique.length, inserted, rejected };
}

export async function knownLeadKeys(): Promise<{ uids: string[]; titles: string[] }> {
  if (isDemo()) return { uids: demo().leads.map(l => l.uid), titles: demo().leads.map(l => l.title) };
  const sb = supabaseAdmin();
  const rows = check(await sb.from('leads').select('uid,title').limit(20000)) as { uid: string; title: string }[];
  return { uids: rows.map(r => r.uid), titles: rows.map(r => r.title) };
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
