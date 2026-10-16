// Google Drive records and actions (update 4). Permission checks happen here (server) and again in the database
// (row-level security on opportunity_drive_folders / opportunity_drive_files / integration_settings).
// The encrypted refresh token is read and written only with the service-role client.
import { cache } from 'react';
import { isDemo } from './env';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';
import { check, getLead, getSession, NotAllowed, requirePerm } from './data';
import { can } from './perm';
import {
  accessToken, copyInto, decryptToken, driveConfig, driveConfigProblems, DriveError, encryptToken, ensureOpportunityTree, ensureRoot,
  getItem, parseDriveId, revoke
} from './drive';
import { DRIVE_SUBFOLDERS, type DriveConnectionStatus, type DriveFile, type DriveFolder, type DriveSubfolder, type IntegrationSettings, type KbConfidentiality } from './types';

const missing = (m: string) => /does not exist|schema cache|Could not find/i.test(m);
const DEMO_MSG = 'Google Drive is not available in demo mode. Configure it on a real deployment (see README, "Google Drive").';

export interface DriveStatus {
  installed: boolean;                 // update-4.sql has been run
  problems: string[];                 // missing environment settings (names only)
  connection: DriveConnectionStatus | null;
  settings: IntegrationSettings | null;
  ready: boolean;                     // configured + connected + root folder set
}

export const driveStatus = cache(async (): Promise<DriveStatus> => {
  const problems = driveConfigProblems();
  if (isDemo()) return { installed: true, problems, connection: null, settings: null, ready: false };
  const s = await getSession();
  if (!s?.isMember) return { installed: true, problems, connection: null, settings: null, ready: false };
  const sb = await supabaseServer();
  const [c, st] = await Promise.all([sb.rpc('google_connection_status'), sb.from('integration_settings').select('*').eq('id', 1).maybeSingle()]);
  if ((c.error && missing(c.error.message)) || (st.error && missing(st.error.message))) return { installed: false, problems, connection: null, settings: null, ready: false };
  const connection = ((c.data || []) as DriveConnectionStatus[])[0] || null;
  const settings = (st.data || null) as IntegrationSettings | null;
  return { installed: true, problems, connection, settings, ready: !problems.length && connection?.status === 'Connected' && !!settings?.drive_root_id };
});

// ---------------- organisation connection (service role only) ----------------
export async function saveConnection(refresh: string, email: string | null, scopes: string, by: string): Promise<void> {
  const cfg = driveConfig(); if (!cfg) throw new Error('Google Drive is not configured.');
  const admin = supabaseAdmin();
  check(await admin.from('google_connections').upsert({
    provider: 'google_drive', account_email: email, scopes, refresh_token_enc: encryptToken(refresh, cfg.encKey), status: 'Connected',
    last_error: null, connected_by: by, connected_at: new Date().toISOString(), revoked_at: null, updated_at: new Date().toISOString()
  }, { onConflict: 'provider' }).select('id'));
}

async function markConnection(status: 'Error' | 'Revoked', error: string | null) {
  try { await supabaseAdmin().from('google_connections').update({ status, last_error: error, updated_at: new Date().toISOString(), ...(status === 'Revoked' ? { refresh_token_enc: null, revoked_at: new Date().toISOString() } : {}) }).eq('provider', 'google_drive'); } catch { /* status only */ }
}

/** A short-lived access token for the organisation connection. Never returned to the browser. */
async function orgToken(): Promise<string> {
  if (isDemo()) throw new Error(DEMO_MSG);
  const cfg = driveConfig(); if (!cfg) throw new Error('Google Drive is not configured: ' + driveConfigProblems().join(', ') + '.');
  const res = await supabaseAdmin().from('google_connections').select('refresh_token_enc,status').eq('provider', 'google_drive').maybeSingle();
  if (res.error) throw new Error(missing(res.error.message) ? 'Run supabase/update-4.sql first.' : res.error.message);
  const row = res.data as { refresh_token_enc: string | null; status: string } | null;
  if (!row?.refresh_token_enc || row.status !== 'Connected') throw new Error('Google Drive is not connected. An administrator connects it on Settings > Integrations.');
  try { return await accessToken(cfg, decryptToken(row.refresh_token_enc, cfg.encKey)); }
  catch (e) { if (e instanceof DriveError && e.revoked) await markConnection('Error', e.message); throw e; }
}

export async function disconnectDrive(): Promise<void> {
  await requirePerm('drive.admin', 'disconnect Google Drive');
  if (isDemo()) throw new Error(DEMO_MSG);
  const cfg = driveConfig();
  const res = await supabaseAdmin().from('google_connections').select('refresh_token_enc').eq('provider', 'google_drive').maybeSingle();
  const enc = (res.data as { refresh_token_enc: string | null } | null)?.refresh_token_enc;
  if (enc && cfg) { try { await revoke(decryptToken(enc, cfg.encKey)); } catch { /* revoke is best effort; the token is deleted below anyway */ } }
  await markConnection('Revoked', null);
}

// ---------------- settings ----------------
async function updateSettings(patch: Partial<IntegrationSettings>): Promise<void> {
  const s = await requirePerm('drive.admin', 'change Google Drive settings');
  const sb = await supabaseServer();
  check(await sb.from('integration_settings').update({ ...patch, updated_by: s.user.id, updated_at: new Date().toISOString() }).eq('id', 1).select('id'));
}

/** Use an existing folder (link or ID, e.g. one picked with the Google Picker) or create "CRM Opportunities". */
export async function setDriveRoot(input: string, createUnder: boolean): Promise<string> {
  await requirePerm('drive.admin', 'choose the Drive root folder');
  const token = await orgToken();
  let item;
  if (!input.trim()) item = await ensureRoot(token);
  else {
    const id = parseDriveId(input); if (!id) throw new Error('Paste a Google Drive folder link or ID.');
    const parent = await getItem(token, id);
    if (parent.mimeType !== 'application/vnd.google-apps.folder') throw new Error(`"${parent.name}" is not a folder.`);
    item = createUnder ? await ensureRoot(token, parent.id) : parent;
  }
  await updateSettings({ drive_root_id: item.id, drive_root_name: item.name, drive_root_url: item.webViewLink || `https://drive.google.com/drive/folders/${item.id}`, drive_root_verified: new Date().toISOString(), shared_drive_id: item.driveId || null });
  return item.name;
}

export async function setCopyPolicy(policy: IntegrationSettings['copy_policy']): Promise<void> {
  if (!['link_only', 'copy_internal'].includes(policy)) throw new Error('Unknown copy policy.');
  await updateSettings({ copy_policy: policy });
}

// ---------------- per opportunity ----------------
export const leadDrive = cache(async (leadId: number): Promise<{ folder: DriveFolder | null; files: DriveFile[]; installed: boolean }> => {
  const s = await getSession();
  if (isDemo() || !can(s, 'opp.read')) return { folder: null, files: [], installed: true };
  const sb = await supabaseServer();
  const [f, fl] = await Promise.all([
    sb.from('opportunity_drive_folders').select('*').eq('lead_id', leadId).maybeSingle(),
    sb.from('opportunity_drive_files').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
  ]);
  if (f.error && missing(f.error.message)) return { folder: null, files: [], installed: false };
  return { folder: (f.data || null) as DriveFolder | null, files: fl.error ? [] : (fl.data as DriveFile[]), installed: true };
});

/** Create (or repair) the opportunity's folder tree. Allowed before the Go / No-go decision. Idempotent. */
export async function createLeadFolder(leadId: number): Promise<string> {
  const s = await requirePerm('drive.folder', 'create Drive folders');
  if (isDemo()) throw new Error(DEMO_MSG);
  const got = await getLead(leadId); if (!got) throw new Error('Opportunity not found.');
  const ref = got.lead.ref_code; if (!ref) throw new Error('This opportunity has no reference number yet (run update-3.sql).');
  const st = await driveStatus();
  if (!st.settings?.drive_root_id) throw new Error('No Drive root folder is set. An administrator sets it on Settings > Integrations.');
  const sb = await supabaseServer();
  const existing = (await sb.from('opportunity_drive_folders').select('id').eq('lead_id', leadId).maybeSingle()).data as { id: number } | null;
  if (!existing) check(await sb.from('opportunity_drive_folders').insert({ lead_id: leadId, status: 'Creating', created_by: s.user.id, parent_id: st.settings.drive_root_id }).select('id'));
  try {
    const token = await orgToken();
    const { folder, subfolders } = await ensureOpportunityTree(token, st.settings.drive_root_id, ref, got.lead.title);
    check(await sb.from('opportunity_drive_folders').update({
      folder_id: folder.id, folder_url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`, folder_name: folder.name,
      parent_id: st.settings.drive_root_id, subfolders, status: 'Ready', error: null, last_synced_at: new Date().toISOString()
    }).eq('lead_id', leadId).select('id'));
    return folder.name;
  } catch (e) {
    await sb.from('opportunity_drive_folders').update({ status: 'Error', error: (e as Error).message.slice(0, 500) }).eq('lead_id', leadId);
    throw e;
  }
}

export interface LinkInput { input: string; name: string | null; subfolder: string | null; sensitivity: KbConfidentiality; note: string | null; mode: 'Link' | 'Copy'; kbDocumentId: number | null }

/** Link a Drive file to the opportunity, or copy it into the opportunity folder when the copy policy allows. */
export async function linkDriveFile(leadId: number, inp: LinkInput): Promise<string> {
  const s = await requirePerm('drive.link', 'link Drive files');
  if (isDemo()) throw new Error(DEMO_MSG);
  if (inp.sensitivity === 'Restricted' && !can(s, 'kb.read_restricted')) throw new NotAllowed('Only roles that can see restricted documents can link a restricted file.');
  const id = parseDriveId(inp.input); if (!id) throw new Error('Paste a Google Drive file link or ID.');
  const sub = inp.subfolder && (DRIVE_SUBFOLDERS as readonly string[]).includes(inp.subfolder) ? inp.subfolder as DriveSubfolder : null;
  const sb = await supabaseServer();
  let meta: { name: string; mime: string | null; modified: string | null; url: string | null; verified: boolean } = { name: inp.name || '', mime: null, modified: null, url: `https://drive.google.com/open?id=${id}`, verified: false };
  let token: string | null = null;
  try {
    token = await orgToken();
    const it = await getItem(token, id);
    meta = { name: it.name, mime: it.mimeType, modified: it.modifiedTime || null, url: it.webViewLink || meta.url, verified: true };
  } catch (e) {
    if (inp.mode === 'Copy') throw e;                 // a copy needs read access through the connection
    if (!meta.name) throw new Error('The CRM could not read this file through the Drive connection (' + (e as Error).message + '). Type the file name to record it as an unverified link.');
  }
  let fileId = id, mode: 'Link' | 'Copy' = 'Link';
  if (inp.mode === 'Copy') {
    const st = await driveStatus();
    if (st.settings?.copy_policy !== 'copy_internal') throw new Error('The copy policy is "link only". An administrator can allow copies of internal files on Settings > Integrations.');
    if (inp.sensitivity === 'Restricted') throw new Error('Restricted files are never copied automatically. Link it instead, or ask the document owner to place it.');
    const { folder } = await leadDrive(leadId);
    if (folder?.status !== 'Ready' || !sub || !folder.subfolders[sub]) throw new Error('Create the opportunity folder and choose a subfolder first.');
    const copy = await copyInto(token!, id, folder.subfolders[sub]!, meta.name);
    fileId = copy.id; mode = 'Copy';
    meta = { ...meta, url: copy.webViewLink || `https://drive.google.com/open?id=${copy.id}`, modified: copy.modifiedTime || meta.modified };
  }
  check(await sb.from('opportunity_drive_files').upsert({
    lead_id: leadId, drive_file_id: fileId, name: meta.name.slice(0, 300), mime_type: meta.mime, modified_time: meta.modified, web_url: meta.url,
    subfolder: sub, sensitivity: inp.sensitivity, kb_document_id: inp.kbDocumentId, mode, verified: meta.verified, note: inp.note, linked_by: s.user.id
  }, { onConflict: 'lead_id,drive_file_id,mode' }).select('id'));
  return meta.verified ? (mode === 'Copy' ? 'Copied into the opportunity folder.' : 'Linked (checked in Drive).') : 'Linked — not verified: the Drive connection cannot see this file, so name and date were not checked.';
}

export async function unlinkDriveFile(leadId: number, id: number): Promise<void> {
  await requirePerm('drive.link', 'remove Drive links');
  if (isDemo()) throw new Error(DEMO_MSG);
  const sb = await supabaseServer();
  // Removes the CRM link only. The file in Google Drive is not touched.
  check(await sb.from('opportunity_drive_files').delete().eq('id', id).eq('lead_id', leadId).select('id'));
}
