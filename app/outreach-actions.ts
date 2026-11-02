'use server';
// Server actions for the Lead Tracker board and the events / outreach screens (update 5).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as data from '@/lib/data';
import * as out from '@/lib/outreach';
import { TO_STAGE, TRACKER_STATUSES, type TrackerStatus } from '@/lib/tracker';
import type { ChecklistItem } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
function isRedirect(e: unknown) { return typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT'); }
function withMsg(path: string, k: 'msg' | 'err', v: string) {
  const [p, q] = path.split('#');
  return `${p}${p!.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}${q ? '#' + q : ''}`;
}
const back = (fd: FormData, dflt: string) => { const r = str(fd, 'return'); return r.startsWith('/') && !r.startsWith('//') ? r : dflt; };
async function run(path: string, fn: () => Promise<unknown>, ok: string | ((v: unknown) => string)) {
  let target: string;
  try { const v = await fn(); target = withMsg(path, 'msg', typeof ok === 'function' ? ok(v) : ok); }
  catch (e) { if (isRedirect(e)) { revalidatePath('/', 'layout'); throw e; } target = withMsg(path, 'err', msgOf(e)); }
  revalidatePath('/', 'layout');
  redirect(target);
}
/** Form fields that belong to the record (everything except the action plumbing). */
function fields(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (!['id', 'return', 'op'].includes(k) && !k.startsWith('$ACTION')) o[k] = typeof v === 'string' ? v : '';
  return o;
}

// ---------------- Lead Tracker board ----------------
export interface MoveResult { ok: boolean; message: string }
/** Drag-and-drop on the board. Closing statuses need a reason, which is kept on the lead's history. */
export async function trackerMoveAction(id: number, status: string, reason: string): Promise<MoveResult> {
  try {
    if (!(TRACKER_STATUSES as readonly string[]).includes(status)) throw new Error('Unknown status.');
    const st = status as TrackerStatus;
    const stage = TO_STAGE[st];
    const res = await data.getLead(id);
    if (!res) throw new Error('This lead no longer exists.');
    if (['Lost', 'No-Go', 'Tanked'].includes(st) && !reason.trim()) throw new Error('Give a reason for closing it.');
    if (stage === 'In preparation' && res.lead.decision !== 'Go') throw new Error('Record an approved Go decision on the lead before moving it to In Process.');
    await data.updateLead(id, { stage });
    if (reason.trim()) await data.addComment(id, `${st}: ${reason.trim()}`);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Moved to ${st}.` };
  } catch (e) { return { ok: false, message: msgOf(e) }; }
}

// ---------------- events ----------------
export async function eventSaveAction(fd: FormData) {
  const id = Number(str(fd, 'id')) || null;
  const row = fields(fd);
  if (fd.has('personnel_present')) row.personnel = fd.getAll('personnel').map(String).filter(Boolean); else delete row.personnel;
  let newId = id;
  await run(back(fd, id ? `/events/${id}` : '/events'), async () => { newId = await out.saveBdEvent(id, row); if (!id) redirect(withMsg(`/events/${newId}`, 'msg', 'Event added.')); }, 'Event saved.');
}

export async function eventChecklistAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const op = str(fd, 'op');
  await run(`/events/${id}`, async () => {
    const ev = (await out.listBdEvents()).find(e => e.id === id);
    if (!ev) throw new Error('Event not found.');
    const list: ChecklistItem[] = [...ev.checklist];
    if (op === 'add') { const item = str(fd, 'item'); if (!item) throw new Error('Write the checklist item.'); list.push({ item, done: false, owner: str(fd, 'owner') || null, due: str(fd, 'due') || null }); }
    else if (op === 'toggle') { const i = Number(str(fd, 'index')); if (list[i]) list[i] = { ...list[i]!, done: !list[i]!.done }; }
    else if (op === 'remove') { const i = Number(str(fd, 'index')); list.splice(i, 1); }
    await out.saveBdEvent(id, { checklist: list });
  }, 'Checklist updated.');
}

export async function learningAction(fd: FormData) {
  const eventId = Number(str(fd, 'event_id')) || null;
  await run(back(fd, eventId ? `/events/${eventId}?tab=learnings` : '/events'), () => out.addLearning(eventId, fields(fd)), 'Learning added.');
}

// ---------------- contacts ----------------
export async function contactSaveAction(fd: FormData) {
  const id = Number(str(fd, 'id')) || null;
  await run(back(fd, '/people'), () => out.saveContact(id, fields(fd)), id ? 'Contact saved.' : 'Contact added.');
}

export async function contactBulkAction(fd: FormData) {
  const ids = fd.getAll('ids').map(Number).filter(Boolean);
  const op = str(fd, 'op');
  await run(back(fd, '/people'), async () => {
    if (!ids.length) throw new Error('Select at least one contact.');
    const s = await data.getSession();
    if (op === 'assign') return out.bulkContacts(ids, { owner: str(fd, 'owner') || null });
    if (op === 'take') return out.bulkContacts(ids, { owner: s!.user.id });
    if (op === 'status') return out.bulkContacts(ids, { meeting_status: str(fd, 'meeting_status') });
    if (op === 'followup') return out.bulkContacts(ids, { followup_on: str(fd, 'followup_on') || null });
    if (op === 'roundrobin') {
      const people = fd.getAll('people').map(String).filter(Boolean);
      if (!people.length) throw new Error('Pick the people to share the contacts between.');
      let n = 0;
      for (let i = 0; i < ids.length; i++) n += await out.bulkContacts([ids[i]!], { owner: people[i % people.length]! });
      return n;
    }
    throw new Error('Pick an action.');
  }, v => `${v} contact${v === 1 ? '' : 's'} updated.`);
}

export async function contactConvertAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  const kind = (['CSR', 'Grant', 'Tender', 'RFP / EOI'].includes(str(fd, 'kind')) ? str(fd, 'kind') : 'CSR') as 'CSR' | 'Grant' | 'Tender' | 'RFP / EOI';
  let leadId = 0;
  try { leadId = await out.convertContact(id, kind); }
  catch (e) { revalidatePath('/', 'layout'); redirect(withMsg(back(fd, '/people'), 'err', msgOf(e))); }
  revalidatePath('/', 'layout');
  redirect(withMsg(`/leads/${leadId}`, 'msg', 'Lead created from the contact.'));
}

// ---------------- pre-leads ----------------
export async function preLeadSaveAction(fd: FormData) {
  const id = Number(str(fd, 'id')) || null;
  await run(back(fd, '/pre-leads'), () => out.savePreLead(id, fields(fd)), id ? 'Pre-lead saved.' : 'Pre-lead added.');
}
export async function preLeadConvertAction(fd: FormData) {
  const id = Number(str(fd, 'id'));
  let leadId = 0;
  try { leadId = await out.convertPreLead(id); }
  catch (e) { revalidatePath('/', 'layout'); redirect(withMsg('/pre-leads', 'err', msgOf(e))); }
  revalidatePath('/', 'layout');
  redirect(withMsg(`/leads/${leadId}`, 'msg', 'Lead created from the pre-lead.'));
}

// ---------------- cohorts ----------------
export async function cohortSaveAction(fd: FormData) {
  const id = Number(str(fd, 'id')) || null;
  await run(back(fd, '/cohorts'), () => out.saveCohort(id, fields(fd)), id ? 'Cohort saved.' : 'Cohort added.');
}

// ---------------- spreadsheet upload ----------------
export async function outreachImportAction(_prev: out.OutreachImportResult | null, fd: FormData): Promise<out.OutreachImportResult> {
  const target = str(fd, 'target') as out.ImportTarget;
  if (!['contacts', 'events', 'preleads', 'cohorts'].includes(target)) return { ok: false, created: 0, merged: 0, skipped: 0, errors: [], message: 'Unknown upload type.' };
  let rows: Record<string, unknown>[] = [];
  try { rows = JSON.parse(str(fd, 'rows') || '[]'); } catch { return { ok: false, created: 0, merged: 0, skipped: 0, errors: [], message: 'The rows could not be read. Try again.' }; }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, created: 0, merged: 0, skipped: 0, errors: [], message: 'Nothing to import.' };
  try {
    const res = await out.importOutreach(target, rows, { eventId: Number(str(fd, 'event_id')) || null, merge: str(fd, 'merge') === '1' });
    revalidatePath('/', 'layout');
    return res;
  } catch (e) { return { ok: false, created: 0, merged: 0, skipped: 0, errors: [], message: msgOf(e) }; }
}
