// Starts the Google Drive OAuth flow for the organisation connection. Only drive.admin may start it.
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/data';
import { can } from '@/lib/perm';
import { authUrl, driveConfig, driveConfigProblems } from '@/lib/drive';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const back = new URL('/settings/integrations', req.url);
  const s = await getSession();
  if (!s || !can(s, 'drive.admin')) { back.searchParams.set('err', 'Only a Google Drive administrator can connect Drive.'); return NextResponse.redirect(back); }
  const cfg = driveConfig();
  if (!cfg) { back.searchParams.set('err', 'Google Drive is not configured. Missing: ' + driveConfigProblems().join(', ')); return NextResponse.redirect(back); }
  const state = crypto.randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(authUrl(cfg, state));
  res.cookies.set('gdrive_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/google/drive', maxAge: 600 });
  return res;
}
