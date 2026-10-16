// Google Drive for opportunity folders (update 4). Server-only.
//
// One organisation connection: an administrator (drive.admin) connects a Google account once. The refresh token is
// encrypted here with AES-256-GCM (key: GOOGLE_TOKEN_ENC_KEY, 32 bytes, base64) and stored in google_connections,
// a table only the service role can read. Access tokens are fetched per request and never stored, logged or sent
// to the browser.
//
// Scope: drive.file by default — the app can only see files and folders it created or that a person explicitly
// picked with the Google Picker. It cannot crawl anyone's Drive. GOOGLE_DRIVE_SCOPE=drive is possible but needs the
// Workspace admin's approval and is not recommended.
//
// The CRM never changes sharing: it does not call the permissions API. New folders inherit the sharing of the root
// folder the administrator chose (use a Shared Drive or a folder already shared with the team).
import crypto from 'node:crypto';
import { DRIVE_SUBFOLDERS, type DriveSubfolder } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

export interface DriveConfig { clientId: string; clientSecret: string; redirectUri: string; scope: string; encKey: Buffer }

/** Which settings are missing (names only — values are never shown). */
export function driveConfigProblems(): string[] {
  const p: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) p.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) p.push('GOOGLE_CLIENT_SECRET');
  const k = process.env.GOOGLE_TOKEN_ENC_KEY || '';
  if (!k) p.push('GOOGLE_TOKEN_ENC_KEY');
  else if (Buffer.from(k, 'base64').length !== 32) p.push('GOOGLE_TOKEN_ENC_KEY (must be 32 bytes, base64)');
  if (!process.env.NEXT_PUBLIC_SITE_URL) p.push('NEXT_PUBLIC_SITE_URL');
  if (!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) p.push('SUPABASE_SECRET_KEY');
  if (process.env.DEMO_MODE === '1') p.push('DEMO_MODE must be off');
  return p;
}

export function driveConfig(): DriveConfig | null {
  if (driveConfigProblems().length) return null;
  const scope = process.env.GOOGLE_DRIVE_SCOPE === 'drive' ? 'https://www.googleapis.com/auth/drive' : 'https://www.googleapis.com/auth/drive.file';
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/$/, '') + '/api/google/drive/callback',
    scope: `openid email ${scope}`, encKey: Buffer.from(process.env.GOOGLE_TOKEN_ENC_KEY!, 'base64')
  };
}

// ---------------- token encryption ----------------
export function encryptToken(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
export function decryptToken(blob: string, key: Buffer): string {
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Stored token has an unknown format. Reconnect Google Drive.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// ---------------- OAuth ----------------
export function authUrl(cfg: DriveConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: cfg.scope,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return `${AUTH_URL}?${p}`;
}

export async function exchangeCode(cfg: DriveConfig, code: string): Promise<{ refresh: string; email: string | null; scopes: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' })
  });
  const j = await res.json().catch(() => ({})) as { refresh_token?: string; id_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !j.refresh_token) throw new Error(j.error_description || j.error || `Google answered ${res.status} without a refresh token. Remove the app's access in the Google account and connect again.`);
  let email: string | null = null;
  try { email = JSON.parse(Buffer.from((j.id_token || '').split('.')[1] || '', 'base64url').toString()).email || null; } catch { /* email is informational */ }
  return { refresh: j.refresh_token, email, scopes: j.scope || cfg.scope };
}

export async function accessToken(cfg: DriveConfig, refresh: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ refresh_token: refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' })
  });
  const j = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new DriveError(j.error === 'invalid_grant' ? 'The Google Drive connection was revoked or expired. An administrator must reconnect it.' : (j.error_description || `Token refresh failed (${res.status}).`), j.error === 'invalid_grant');
  return j.access_token;
}

export async function revoke(refresh: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => undefined);
}

export class DriveError extends Error { constructor(msg: string, public revoked = false, public status = 0) { super(msg); } }

// ---------------- Drive API ----------------
export interface DriveItem { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string; parents?: string[]; driveId?: string; trashed?: boolean; appProperties?: Record<string, string> }
const FIELDS = 'id,name,mimeType,webViewLink,modifiedTime,parents,driveId,trashed,appProperties';

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}supportsAllDrives=true`, {
    ...init, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const m = j.error?.message || `Drive answered ${res.status}`;
    if (res.status === 404) throw new DriveError(`Not found or not accessible to the connected account (${m}). With the drive.file scope the CRM only sees folders it created or that were picked with the Google Picker.`, false, 404);
    if (res.status === 403) throw new DriveError(`Google Drive refused this (${m}). Check the connected account's access to the folder.`, false, 403);
    if (res.status === 429) throw new DriveError('Google Drive rate limit reached. Try again in a minute.', false, 429);
    throw new DriveError(m, false, res.status);
  }
  return res.json() as Promise<T>;
}

export const getItem = (token: string, id: string) => call<DriveItem>(token, `/files/${encodeURIComponent(id)}?fields=${FIELDS}`);

/** Find a folder the CRM created earlier (by appProperties), or create it. Idempotent. */
export async function findOrCreateFolder(token: string, parentId: string, name: string, props: Record<string, string>): Promise<DriveItem> {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const conds = [`'${esc(parentId)}' in parents`, `mimeType='${FOLDER}'`, 'trashed=false',
    ...Object.entries(props).map(([k, v]) => `appProperties has { key='${esc(k)}' and value='${esc(v)}' }`)];
  const q = encodeURIComponent(conds.join(' and '));
  const found = await call<{ files: DriveItem[] }>(token, `/files?q=${q}&fields=files(${FIELDS})&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=5`);
  if (found.files?.length) return found.files[0]!;
  return call<DriveItem>(token, `/files?fields=${FIELDS}`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId], appProperties: props }) });
}

export function folderName(ref: string, title: string): string {
  const short = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return `${ref} - ${short || 'Opportunity'}`;
}

/** Build CRM Opportunities/<OPP-ref - title>/{six subfolders}. Safe to call again: existing folders are reused. */
export async function ensureOpportunityTree(token: string, rootId: string, ref: string, title: string): Promise<{ folder: DriveItem; subfolders: Record<DriveSubfolder, string> }> {
  const folder = await findOrCreateFolder(token, rootId, folderName(ref, title), { crmRef: ref, crmKind: 'opportunity' });
  const subs = {} as Record<DriveSubfolder, string>;
  for (const s of DRIVE_SUBFOLDERS) {
    const f = await findOrCreateFolder(token, folder.id, s, { crmRef: ref, crmSub: s.slice(0, 2) });
    subs[s] = f.id;
  }
  return { folder, subfolders: subs };
}

/** Create the "CRM Opportunities" root under a parent folder (or My Drive when parent is omitted). */
export async function ensureRoot(token: string, parentId?: string): Promise<DriveItem> {
  if (parentId) return findOrCreateFolder(token, parentId, 'CRM Opportunities', { crmKind: 'root' });
  const q = encodeURIComponent(`mimeType='${FOLDER}' and trashed=false and appProperties has { key='crmKind' and value='root' }`);
  const found = await call<{ files: DriveItem[] }>(token, `/files?q=${q}&fields=files(${FIELDS})&pageSize=5`);
  if (found.files?.length) return found.files[0]!;
  return call<DriveItem>(token, `/files?fields=${FIELDS}`, { method: 'POST', body: JSON.stringify({ name: 'CRM Opportunities', mimeType: FOLDER, appProperties: { crmKind: 'root' } }) });
}

/** Copy a file into a folder. The copy inherits the folder's sharing; no permission is changed. */
export const copyInto = (token: string, fileId: string, parentId: string, name: string) =>
  call<DriveItem>(token, `/files/${encodeURIComponent(fileId)}/copy?fields=${FIELDS}`, { method: 'POST', body: JSON.stringify({ name, parents: [parentId] }) });

/** Accepts a Drive/Docs URL or a bare file ID. */
export function parseDriveId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || s.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}
