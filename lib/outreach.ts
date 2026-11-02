// Events, contacts met, pre-leads and cohorts (update 5). Real mode: Supabase as the signed-in person; row-level
// security and the owner-guard trigger (supabase/update-5.sql) decide what each role may do. Demo mode applies the
// same rules in code.
import { cache } from 'react';
import { isDemo } from './env';
import { supabaseServer } from './supabase/server';
import { demo, ensureOutreach, nextSeq, saveDemo } from './demo';
import { check, createLead, getSession, NotAllowed, requirePerm } from './data';
import { can } from './perm';
import { todayIST } from './format';
import {
  COHORT_STATUSES, EVENT_IMPORTANCE, EVENT_STATUSES, MEETING_STATUSES, PRELEAD_STATUSES,
  type BdContact, type BdEvent, type BdLearning, type ChecklistItem, type Cohort, type PreLead, type Session
} from './types';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function readOrEmpty<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const res = await q;
  if (res.error) {
    if (/does not exist|schema cache|Could not find the table/i.test(res.error.message)) return [];
    throw new Error(res.error.message);
  }
  return (res.data || []) as T[];
}

const txt = (v: unknown, max = 2000): string | null => { const s = String(v ?? '').replace(/\s+\n/g, '\n').trim(); return s ? s.slice(0, max) : null; };
const date = (v: unknown): string | null => { const s = String(v ?? '').trim(); return ISO.test(s) ? s : null; };
const num = (v: unknown): number | null => { const s = String(v ?? '').replace(/[,₹\s]/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : null; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => ((list as readonly string[]).includes(String(v)) ? String(v) as T : dflt);

/** The same owner rule the database trigger applies: take it yourself, or hold outreach.assign to give it to someone else. */
function checkOwner(s: Session, from: string | null, to: string | null) {
  if (from === to) return;
  if (can(s, 'outreach.assign')) return;
  if (to === s.user.id) return;
  if (from === s.user.id && to === null) return;
  throw new NotAllowed(`Your role (${s.orgRole}) cannot give this to someone else. Leave it unassigned or take it yourself.`);
}

// ---------------- events ----------------
export const listBdEvents = cache(async (): Promise<BdEvent[]> => {
  const s = await getSession(); if (!s || !can(s, 'outreach.read')) return [];
  if (isDemo()) return [...ensureOutreach(demo()).bdEvents].sort((a, b) => String(b.starts_on || '').localeCompare(String(a.starts_on || '')));
  const sb = await supabaseServer();
  return readOrEmpty<BdEvent>(sb.from('bd_events').select('*').order('starts_on', { ascending: false, nullsFirst: false }));
});

export function eventFields(row: Row): Partial<BdEvent> {
  const out: Partial<BdEvent> = {};
  if ('name' in row) out.name = txt(row.name, 300) || '';
  for (const k of ['dates_text', 'apply_by_text', 'location', 'purpose', 'participation', 'personnel_text', 'actual_output'] as const) if (k in row) out[k] = txt(row[k]);
  for (const k of ['starts_on', 'ends_on', 'apply_by'] as const) if (k in row) out[k] = date(row[k]);
  for (const k of ['cost_estimate', 'cost_actual'] as const) if (k in row) out[k] = num(row[k]);
  if ('importance' in row) out.importance = oneOf(row.importance, EVENT_IMPORTANCE, 'Medium');
  if ('status' in row) out.status = oneOf(row.status, EVENT_STATUSES, 'Planned');
  if ('effectiveness' in row) { const e = Number(row.effectiveness); out.effectiveness = Number.isInteger(e) && e >= 1 && e <= 5 ? e : null; }
  if ('personnel' in row && Array.isArray(row.personnel)) out.personnel = (row.personnel as unknown[]).map(String).filter(Boolean).slice(0, 20);
  if ('checklist' in row && Array.isArray(row.checklist)) out.checklist = (row.checklist as ChecklistItem[]).slice(0, 60).map(c => ({ item: String(c.item || '').slice(0, 200), done: !!c.done, owner: c.owner || null, due: date(c.due) })).filter(c => c.item);
  return out;
}

export async function saveBdEvent(id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('outreach.edit', 'add or edit events');
  const patch = eventFields(row);
  if (!id && !patch.name) throw new Error('Name the event.');
  if (isDemo()) {
    const st = demo(); const o = ensureOutreach(st);
    if (id) { const e = o.bdEvents.find(x => x.id === id); if (!e) throw new Error('Event not found.'); Object.assign(e, patch, { updated_at: now() }); }
    else {
      id = nextSeq(st);
      o.bdEvents.push({ id, name: '', dates_text: null, starts_on: null, ends_on: null, apply_by: null, apply_by_text: null, importance: 'Medium', location: null, purpose: null, participation: null, personnel: [], personnel_text: null, cost_estimate: null, cost_actual: null, checklist: [], actual_output: null, effectiveness: null, status: 'Planned', created_by: s.user.id, created_at: now(), updated_at: now(), ...patch } as BdEvent);
    }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { check(await sb.from('bd_events').update(patch).eq('id', id).select('id')); return id; }
  const rows = check(await sb.from('bd_events').insert(patch).select('id')) as { id: number }[];
  return rows[0]!.id;
}

// ---------------- contacts ----------------
export const listContacts = cache(async (): Promise<BdContact[]> => {
  const s = await getSession(); if (!s || !can(s, 'outreach.read')) return [];
  if (isDemo()) return [...ensureOutreach(demo()).contacts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sb = await supabaseServer();
  return readOrEmpty<BdContact>(sb.from('bd_contacts').select('*').order('created_at', { ascending: false }).limit(5000));
});

export function contactFields(row: Row): Partial<BdContact> {
  const out: Partial<BdContact> = {};
  for (const k of ['organisation', 'name', 'title', 'phone', 'email', 'details', 'next_action', 'source', 'introducer'] as const) if (k in row) out[k] = txt(row[k], k === 'details' ? 4000 : 300);
  if (out.email) out.email = out.email.toLowerCase();
  for (const k of ['met_on', 'followup_on'] as const) if (k in row) out[k] = date(row[k]);
  if ('meeting_status' in row) out.meeting_status = oneOf(row.meeting_status, MEETING_STATUSES, 'To contact');
  if ('event_id' in row) { const e = Number(row.event_id); out.event_id = Number.isInteger(e) && e > 0 ? e : null; }
  if ('owner' in row) out.owner = txt(row.owner, 60);
  return out;
}

export async function saveContact(id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('outreach.edit', 'add or edit contacts');
  const patch = contactFields(row);
  if (isDemo()) {
    const st = demo(); const o = ensureOutreach(st);
    if (id) {
      const c = o.contacts.find(x => x.id === id); if (!c) throw new Error('Contact not found.');
      if ('owner' in patch) checkOwner(s, c.owner, patch.owner ?? null);
      Object.assign(c, patch, { updated_at: now() });
    } else {
      if (!patch.name && !patch.organisation) throw new Error('Give a name or an organisation.');
      checkOwner(s, null, patch.owner ?? null);
      id = nextSeq(st);
      o.contacts.push({ id, event_id: null, organisation: null, name: null, title: null, phone: null, email: null, met_on: null, meeting_status: 'To contact', details: null, next_action: null, owner: null, followup_on: null, source: null, introducer: null, converted_lead: null, created_by: s.user.id, created_at: now(), updated_at: now(), ...patch } as BdContact);
    }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { check(await sb.from('bd_contacts').update(patch).eq('id', id).select('id')); return id; }
  if (!patch.name && !patch.organisation) throw new Error('Give a name or an organisation.');
  const rows = check(await sb.from('bd_contacts').insert(patch).select('id')) as { id: number }[];
  return rows[0]!.id;
}

/** Bulk owner / status / follow-up change from a table selection. Returns how many rows changed. */
export async function bulkContacts(ids: number[], patch: { owner?: string | null; meeting_status?: string; followup_on?: string | null }): Promise<number> {
  const s = await requirePerm('outreach.edit', 'change contacts');
  const p = contactFields(patch as Row);
  if (isDemo()) {
    const st = demo(); const o = ensureOutreach(st); let n = 0;
    for (const c of o.contacts) if (ids.includes(c.id)) { if ('owner' in p) checkOwner(s, c.owner, p.owner ?? null); Object.assign(c, p, { updated_at: now() }); n++; }
    saveDemo(st); return n;
  }
  const sb = await supabaseServer();
  const rows = check(await sb.from('bd_contacts').update(p).in('id', ids.slice(0, 500)).select('id')) as unknown[];
  return rows.length;
}

/** Turn a contact into a CRM lead (stage Identified, owned by the contact's owner) and link the two. */
export async function convertContact(id: number, kind: 'CSR' | 'Grant' | 'Tender' | 'RFP / EOI'): Promise<number> {
  const s = await requirePerm('outreach.edit', 'convert contacts');
  const c = (await listContacts()).find(x => x.id === id);
  if (!c) throw new Error('Contact not found.');
  if (c.converted_lead) return c.converted_lead;
  const category = kind === 'CSR' ? 'CSR - India' : kind === 'Grant' ? 'Innovation Grant - India' : kind === 'RFP / EOI' ? 'Govt Tender - India' : 'Govt Tender - India';
  const leadId = await createLead({
    title: `${c.organisation || c.name} — relationship lead`, category, lead_type: kind, funder_buyer: c.organisation, summary: [c.details, c.next_action && `Next: ${c.next_action}`].filter(Boolean).join(' · ') || null,
    source: c.event_id ? 'Event contact' : 'Personal network', import_note: `Converted from contact ${c.name || c.organisation}`
  }, { contact_name: c.name, contact_role: c.title, contact_email: c.email, contact_phone: c.phone, next_followup: c.followup_on, assigned_to: c.owner && (c.owner === s.user.id || can(s, 'opp.assign')) ? c.owner : null });
  if (isDemo()) { const st = demo(); const x = ensureOutreach(st).contacts.find(y => y.id === id); if (x) { x.converted_lead = leadId; saveDemo(st); } }
  else { const sb = await supabaseServer(); check(await sb.from('bd_contacts').update({ converted_lead: leadId, meeting_status: c.meeting_status }).eq('id', id).select('id')); }
  return leadId;
}

// ---------------- learnings ----------------
export const listLearnings = cache(async (): Promise<BdLearning[]> => {
  const s = await getSession(); if (!s || !can(s, 'outreach.read')) return [];
  if (isDemo()) return ensureOutreach(demo()).learnings;
  const sb = await supabaseServer();
  return readOrEmpty<BdLearning>(sb.from('bd_learnings').select('*').order('created_at', { ascending: false }));
});

export async function addLearning(eventId: number | null, row: Row): Promise<void> {
  const s = await requirePerm('outreach.edit', 'add learnings');
  const rec = { event_id: eventId, year: txt(row.year, 20), winners: txt(row.winners, 500), model: txt(row.model, 500), learnings: txt(row.learnings, 2000) };
  if (!rec.winners && !rec.learnings && !rec.model) throw new Error('Write at least the learning or the model.');
  if (isDemo()) { const st = demo(); ensureOutreach(st).learnings.push({ id: nextSeq(st), ...rec, created_by: s.user.id, created_at: now() }); saveDemo(st); return; }
  const sb = await supabaseServer();
  check(await sb.from('bd_learnings').insert(rec).select('id'));
}

// ---------------- pre-leads ----------------
export const listPreLeads = cache(async (): Promise<PreLead[]> => {
  const s = await getSession(); if (!s || !can(s, 'outreach.read')) return [];
  if (isDemo()) return ensureOutreach(demo()).preLeads;
  const sb = await supabaseServer();
  return readOrEmpty<PreLead>(sb.from('pre_leads').select('*').order('created_at', { ascending: true }));
});

export function preLeadFields(row: Row): Partial<PreLead> {
  const out: Partial<PreLead> = {};
  if ('task' in row) out.task = txt(row.task, 300) || '';
  for (const k of ['opportunity', 'steps', 'source'] as const) if (k in row) out[k] = txt(row[k]);
  if ('status' in row) out.status = oneOf(row.status, PRELEAD_STATUSES, 'Assigned');
  if ('due_on' in row) out.due_on = date(row.due_on);
  if ('owner' in row) out.owner = txt(row.owner, 60);
  return out;
}

export async function savePreLead(id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('outreach.edit', 'add or edit pre-leads');
  const patch = preLeadFields(row);
  if (!id && !patch.task) throw new Error('Describe the task.');
  if (isDemo()) {
    const st = demo(); const o = ensureOutreach(st);
    if (id) { const p = o.preLeads.find(x => x.id === id); if (!p) throw new Error('Not found.'); if ('owner' in patch) checkOwner(s, p.owner, patch.owner ?? null); Object.assign(p, patch, { updated_at: now() }); }
    else { checkOwner(s, null, patch.owner ?? null); id = nextSeq(st); o.preLeads.push({ id, task: '', opportunity: null, status: 'Assigned', steps: null, owner: null, due_on: null, source: null, converted_lead: null, created_by: s.user.id, created_at: now(), updated_at: now(), ...patch } as PreLead); }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { check(await sb.from('pre_leads').update(patch).eq('id', id).select('id')); return id; }
  const rows = check(await sb.from('pre_leads').insert(patch).select('id')) as { id: number }[];
  return rows[0]!.id;
}

export async function convertPreLead(id: number): Promise<number> {
  const s = await requirePerm('outreach.edit', 'convert pre-leads');
  const p = (await listPreLeads()).find(x => x.id === id);
  if (!p) throw new Error('Pre-lead not found.');
  if (p.converted_lead) return p.converted_lead;
  const leadId = await createLead({ title: p.task, category: 'Govt Tender - India', summary: [p.opportunity, p.steps && `Steps: ${p.steps}`].filter(Boolean).join(' · ') || null, source: 'Pre-lead', import_note: 'Converted from a pre-lead' },
    { assigned_to: p.owner && (p.owner === s.user.id || can(s, 'opp.assign')) ? p.owner : null });
  if (isDemo()) { const st = demo(); const x = ensureOutreach(st).preLeads.find(y => y.id === id); if (x) { x.converted_lead = leadId; x.status = 'Converted'; saveDemo(st); } }
  else { const sb = await supabaseServer(); check(await sb.from('pre_leads').update({ converted_lead: leadId, status: 'Converted' }).eq('id', id).select('id')); }
  return leadId;
}

// ---------------- cohorts ----------------
export const listCohorts = cache(async (): Promise<Cohort[]> => {
  const s = await getSession(); if (!s || !can(s, 'outreach.read')) return [];
  if (isDemo()) return ensureOutreach(demo()).cohorts;
  const sb = await supabaseServer();
  return readOrEmpty<Cohort>(sb.from('cohorts').select('*').order('created_at', { ascending: true }));
});

export function cohortFields(row: Row): Partial<Cohort> {
  const out: Partial<Cohort> = {};
  if ('name' in row) out.name = txt(row.name, 200) || '';
  for (const k of ['contact', 'next_step', 'updates'] as const) if (k in row) out[k] = txt(row[k]);
  if ('status' in row) out.status = oneOf(row.status, COHORT_STATUSES, 'Conversation initiated');
  if ('deadline' in row) out.deadline = date(row.deadline);
  if ('owner' in row) out.owner = txt(row.owner, 60);
  return out;
}

export async function saveCohort(id: number | null, row: Row): Promise<number> {
  const s = await requirePerm('outreach.edit', 'add or edit cohorts');
  const patch = cohortFields(row);
  if (!id && !patch.name) throw new Error('Name the cohort.');
  if (isDemo()) {
    const st = demo(); const o = ensureOutreach(st);
    if (id) { const c = o.cohorts.find(x => x.id === id); if (!c) throw new Error('Not found.'); if ('owner' in patch) checkOwner(s, c.owner, patch.owner ?? null); Object.assign(c, patch, { updated_at: now() }); }
    else { checkOwner(s, null, patch.owner ?? null); id = nextSeq(st); o.cohorts.push({ id, name: '', status: 'Conversation initiated', contact: null, next_step: null, updates: null, deadline: null, owner: null, created_by: s.user.id, created_at: now(), updated_at: now(), ...patch } as Cohort); }
    saveDemo(st); return id;
  }
  const sb = await supabaseServer();
  if (id) { check(await sb.from('cohorts').update(patch).eq('id', id).select('id')); return id; }
  const rows = check(await sb.from('cohorts').insert(patch).select('id')) as { id: number }[];
  return rows[0]!.id;
}

// ---------------- bulk import (spreadsheet upload with assignment) ----------------
export type ImportTarget = 'contacts' | 'events' | 'preleads' | 'cohorts';
export interface OutreachImportResult { ok: boolean; created: number; merged: number; skipped: number; errors: { line: number; reason: string }[]; message: string; eventId?: number | null }

/** Insert rows already cleaned in the browser. Duplicates (same email, or same organisation + name) are merged into the
 *  existing contact when `merge` is set, otherwise skipped. Owners are applied with the same rule as a single change. */
export async function importOutreach(target: ImportTarget, rows: Row[], opts: { eventId: number | null; merge: boolean }): Promise<OutreachImportResult> {
  const s = await requirePerm('outreach.edit', 'upload spreadsheets');
  const res: OutreachImportResult = { ok: true, created: 0, merged: 0, skipped: 0, errors: [], message: '' };
  const list = rows.slice(0, 2000);
  if (target === 'contacts') {
    const existing = await listContacts();
    const key = (c: { email?: string | null; organisation?: string | null; name?: string | null }) => (c.email ? 'e:' + c.email.toLowerCase() : 'o:' + String(c.organisation || '').toLowerCase().trim() + '|' + String(c.name || '').toLowerCase().trim());
    const byKey = new Map(existing.map(c => [key(c), c]));
    for (const r of list) {
      const line = Number(r.line) || 0;
      try {
        const f = contactFields({ ...r, event_id: opts.eventId ?? r.event_id });
        if (!f.name && !f.organisation) { res.skipped++; res.errors.push({ line, reason: 'No name or organisation' }); continue; }
        const hit = byKey.get(key(f));
        if (hit) {
          if (!opts.merge) { res.skipped++; continue; }
          const patch: Row = {};
          for (const [k, v] of Object.entries(f)) if (v != null && v !== '' && (hit as unknown as Row)[k] == null) patch[k] = v;
          if (f.details && hit.details && !hit.details.includes(f.details)) patch.details = hit.details + '\n' + f.details;
          if ('owner' in patch && !can(s, 'outreach.assign') && patch.owner !== s.user.id) delete patch.owner;
          if (Object.keys(patch).length) await saveContact(hit.id, patch);
          res.merged++; continue;
        }
        if (f.owner && f.owner !== s.user.id && !can(s, 'outreach.assign')) f.owner = null;
        const id = await saveContact(null, f as Row);
        byKey.set(key(f), { ...f, id } as BdContact);
        res.created++;
      } catch (e) { res.errors.push({ line, reason: e instanceof Error ? e.message : String(e) }); }
    }
  } else {
    for (const r of list) {
      const line = Number(r.line) || 0;
      try {
        if (target === 'events') await saveBdEvent(null, r);
        else if (target === 'preleads') { const f = preLeadFields(r); if (f.owner && f.owner !== s.user.id && !can(s, 'outreach.assign')) f.owner = null; await savePreLead(null, f as Row); }
        else { const f = cohortFields(r); if (f.owner && f.owner !== s.user.id && !can(s, 'outreach.assign')) f.owner = null; await saveCohort(null, f as Row); }
        res.created++;
      } catch (e) { res.errors.push({ line, reason: e instanceof Error ? e.message : String(e) }); }
    }
  }
  res.ok = res.errors.length === 0 || res.created + res.merged > 0;
  res.message = `${res.created} added${res.merged ? `, ${res.merged} merged into existing records` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}${res.errors.length ? `, ${res.errors.length} with problems` : ''}.`;
  return res;
}

/** Follow-ups due for a person across contacts and pre-leads (today and overdue first). */
export async function myFollowups(userId: string): Promise<{ contacts: BdContact[]; preLeads: PreLead[] }> {
  const [contacts, preLeads] = await Promise.all([listContacts(), listPreLeads()]);
  const open = (d: string | null) => d != null;
  return {
    contacts: contacts.filter(c => c.owner === userId && !['Closed'].includes(c.meeting_status) && !c.converted_lead && open(c.followup_on)).sort((a, b) => String(a.followup_on).localeCompare(String(b.followup_on))),
    preLeads: preLeads.filter(p => p.owner === userId && !['Lost', 'Converted'].includes(p.status)).sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')))
  };
}

export const todayStr = () => todayIST();
