// Permission catalogue. The database (supabase/update-3.sql: role_permissions + has_perm()) is the source of truth
// and enforces these; the app reads the same table to show or hide controls and to give clear messages.
import { ORG_ROLES, type OrgRole, type RolePerm, type Session } from './types';

export interface PermDef { key: string; area: string; column: MatrixColumn; label: string; sensitive?: boolean }
export const MATRIX_COLUMNS = ['Read', 'Create', 'Edit', 'Assign', 'Approve', 'Export', 'Administer'] as const;
export type MatrixColumn = typeof MATRIX_COLUMNS[number];

export const PERMISSIONS: PermDef[] = [
  { key: 'opp.read', area: 'Opportunities', column: 'Read', label: 'See opportunities' },
  { key: 'opp.create', area: 'Opportunities', column: 'Create', label: 'Add opportunities and import spreadsheets' },
  { key: 'opp.edit', area: 'Opportunities', column: 'Edit', label: 'Edit details, stage and pursuit' },
  { key: 'opp.verify', area: 'Opportunities', column: 'Edit', label: 'Mark leads Correct / Incorrect / Duplicate' },
  { key: 'opp.assign', area: 'Opportunities', column: 'Assign', label: 'Give an unassigned opportunity an owner' },
  { key: 'opp.reassign', area: 'Opportunities', column: 'Assign', label: 'Move an opportunity from one owner to another' },
  { key: 'opp.claim', area: 'Opportunities', column: 'Assign', label: 'Take an unassigned opportunity for yourself' },
  { key: 'opp.export', area: 'Opportunities', column: 'Export', label: 'Export lists' },
  { key: 'opp.delete', area: 'Opportunities', column: 'Administer', label: 'Delete opportunities (references are never reused)' },
  { key: 'deadline.verify', area: 'Deadlines', column: 'Approve', label: 'Verify amendments and change the active deadline' },
  { key: 'decision.recommend', area: 'Pursuit decision', column: 'Edit', label: 'Recommend Go / No-go' },
  { key: 'decision.approve', area: 'Pursuit decision', column: 'Approve', label: 'Approve Go / No-go' },
  { key: 'assess.edit', area: 'Eligibility & assessment', column: 'Edit', label: 'Edit requirements, risks, scores, partner gaps' },
  { key: 'docs.read', area: 'Tender documents', column: 'Read', label: 'See tender documents' },
  { key: 'docs.edit', area: 'Tender documents', column: 'Edit', label: 'Add documents and draft requests' },
  { key: 'docs.read_restricted', area: 'Tender documents', column: 'Read', label: 'See restricted tender documents', sensitive: true },
  { key: 'tasks.create', area: 'Tasks', column: 'Create', label: 'Create tasks' },
  { key: 'tasks.assign', area: 'Tasks', column: 'Assign', label: 'Assign tasks to others' },
  { key: 'tasks.claim', area: 'Tasks', column: 'Assign', label: 'Take available shared tasks' },
  { key: 'kb.read', area: 'Knowledge base', column: 'Read', label: 'See company evidence' },
  { key: 'kb.edit', area: 'Knowledge base', column: 'Edit', label: 'Add and edit evidence records' },
  { key: 'kb.approve', area: 'Knowledge base', column: 'Approve', label: 'Approve evidence for use in bids' },
  { key: 'kb.read_restricted', area: 'Knowledge base', column: 'Read', label: 'See financial, statutory, banking and personal documents', sensitive: true },
  { key: 'partners.read', area: 'Partners', column: 'Read', label: 'See the partner directory' },
  { key: 'partners.edit', area: 'Partners', column: 'Edit', label: 'Edit partners' },
  { key: 'partners.read_sensitive', area: 'Partners', column: 'Read', label: 'See partner contacts, due diligence and restrictions', sensitive: true },
  { key: 'relationships.read_shared', area: 'Relationships', column: 'Read', label: 'See relationships others shared with leadership' },
  { key: 'reports.read', area: 'Reports & audit', column: 'Read', label: 'See reports' },
  { key: 'audit.read', area: 'Reports & audit', column: 'Read', label: 'See the audit log and integration history' },
  { key: 'integrations.use', area: 'Integrations', column: 'Create', label: 'Prepare meetings and notifications' },
  // update 4
  { key: 'kb.review_claims', area: 'Knowledge base', column: 'Approve', label: 'Confirm or reject extracted company claims' },
  { key: 'drive.admin', area: 'Google Drive', column: 'Administer', label: 'Connect Google Drive, choose the root folder and copy policy' },
  { key: 'drive.folder', area: 'Google Drive', column: 'Create', label: 'Create the Drive folder for an opportunity' },
  { key: 'drive.link', area: 'Google Drive', column: 'Edit', label: 'Link or copy Drive files to an opportunity' }
];
export const PERM_KEYS = PERMISSIONS.map(p => p.key);

const GM_ALLOWED = ['opp.read', 'opp.create', 'opp.edit', 'opp.verify', 'opp.assign', 'opp.claim', 'opp.export', 'deadline.verify', 'decision.recommend', 'assess.edit',
  'docs.read', 'docs.edit', 'tasks.create', 'tasks.assign', 'tasks.claim', 'kb.read', 'kb.edit', 'partners.read', 'partners.edit', 'reports.read', 'integrations.use', 'audit.read'];
const BD_ALLOWED = ['opp.read', 'opp.create', 'opp.edit', 'opp.verify', 'opp.claim', 'decision.recommend', 'assess.edit', 'docs.read', 'docs.edit',
  'tasks.create', 'tasks.claim', 'kb.read', 'partners.read', 'integrations.use'];
const RESTRICTED = ['docs.read_restricted', 'kb.read_restricted', 'partners.read_sensitive'];

/** The same defaults update-3.sql seeds (used by demo mode and as a reference on the settings screen). */
export function defaultRolePerms(): RolePerm[] {
  const out: RolePerm[] = [];
  for (const role of ORG_ROLES) for (const p of PERM_KEYS) {
    let allowed: boolean;
    if (role === 'CEO' || role === 'CTO') allowed = p !== 'opp.delete';
    else if (role === 'VP') allowed = !RESTRICTED.includes(p) && p !== 'opp.delete';
    else if (role === 'GM') allowed = GM_ALLOWED.includes(p);
    else allowed = BD_ALLOWED.includes(p);
    // update-4 permissions (same defaults as update-4.sql)
    if (p === 'drive.admin') allowed = role === 'CEO' || role === 'CTO';
    if (p === 'drive.folder') allowed = ['CEO', 'CTO', 'VP', 'GM'].includes(role);
    if (p === 'drive.link') allowed = true;
    if (p === 'kb.review_claims') allowed = ['CEO', 'CTO', 'VP'].includes(role);
    let status: RolePerm['status'] = 'Proposed', note: string | null = null;
    if (role === 'VP' && [...RESTRICTED, 'decision.approve', 'opp.reassign'].includes(p)) status = 'Open question';
    if (role === 'GM' && ['decision.approve', 'opp.reassign'].includes(p)) status = 'Open question';
    if (role === 'BD Executive' && ['opp.reassign', 'opp.claim', 'tasks.claim', 'drive.folder'].includes(p)) status = 'Open question';
    if (p === 'decision.approve' && role === 'VP') note = 'VP approval authority relative to CEO/CTO not settled.';
    if (p === 'decision.approve' && role === 'GM') note = 'GM approval authority not settled.';
    if (p === 'opp.reassign' && ['GM', 'BD Executive', 'VP'].includes(role)) note = 'Who may move work between people is not settled.';
    if (role === 'BD Executive' && ['opp.claim', 'tasks.claim'].includes(p)) note = 'Whether executives may take available work themselves is not settled.';
    if (p === 'drive.admin') note = 'Connect/disconnect the organisation Google account, choose the root folder and copy policy.';
    if (role === 'BD Executive' && p === 'drive.folder') note = 'Whether executives may create opportunity folders is not settled.';
    out.push({ org_role: role, permission: p, allowed, status, note, updated_by: null, updated_at: '2026-10-15T00:00:00.000Z' });
  }
  return out;
}

export function effectivePerms(rows: RolePerm[], role: OrgRole, isAdmin: boolean): string[] {
  if (isAdmin) return [...PERM_KEYS];
  return rows.filter(r => r.org_role === role && r.allowed).map(r => r.permission);
}

export function can(session: Session | null | undefined, perm: string): boolean {
  return !!session && session.isMember && session.perms.includes(perm);
}

export const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map(p => [p.key, p.label]));
