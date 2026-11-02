'use server';
// Upload a reviewed JSON lead file (for example crm-update-2026-11-02b.json) from Settings → Import,
// instead of posting it to /api/ingest with the ingest token. Same rules as the crawler endpoint:
// new uids are added, existing leads are never duplicated and the team's own fields are never overwritten.
import { revalidatePath } from 'next/cache';
import { getSession, ingestLeads } from '@/lib/data';
import { can } from '@/lib/perm';

export interface JsonImportState { ok?: boolean; message?: string }

export async function jsonImportAction(_prev: JsonImportState, fd: FormData): Promise<JsonImportState> {
  const session = await getSession();
  if (!session || !can(session, 'opp.create')) return { ok: false, message: 'Your role cannot add opportunities.' };
  const text = String(fd.get('json') || '');
  if (!text) return { ok: false, message: 'Choose a .json file first.' };
  if (text.length > 5_000_000) return { ok: false, message: 'The file is larger than 5 MB. Split it into smaller files.' };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return { ok: false, message: 'This is not valid JSON.' }; }
  const b = body as { leads?: unknown; note?: unknown; mode?: unknown };
  const rows = Array.isArray(body) ? body : Array.isArray(b?.leads) ? (b.leads as unknown[]) : null;
  if (!rows) return { ok: false, message: 'Expected { "leads": [ … ] } or a list of leads.' };
  if (rows.length > 2000) return { ok: false, message: 'At most 2000 leads per file.' };
  // "update" files are treated as reviewed: their deadline changes are recorded as verified. That needs the verify permission.
  const wantUpdate = String(fd.get('mode') || (b?.mode === 'update' ? 'update' : 'insert')) === 'update';
  if (wantUpdate && !can(session, 'opp.verify')) return { ok: false, message: 'Updating existing leads from a reviewed file needs the “Verify leads” permission. Import as new leads only, or ask an admin.' };
  const note = (typeof b?.note === 'string' ? b.note : `JSON upload by ${session.user.email}`).slice(0, 200);
  try {
    const r = await ingestLeads(rows, note, wantUpdate ? 'update' : 'insert');
    revalidatePath('/', 'layout');
    return { ok: true, message: `${r.received} in the file: ${r.inserted} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.amendments} deadline change${r.amendments === 1 ? '' : 's'}${r.rejected.length ? `, ${r.rejected.length} rejected (${r.rejected.slice(0, 3).map(x => `#${x.index + 1}: ${x.reason}`).join('; ')})` : ''}. New leads appear in the Lead Tracker and Crawler intake.` };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
