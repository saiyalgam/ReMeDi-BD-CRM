// OAuth callback: checks the state cookie and the caller's permission, exchanges the code, stores the refresh token
// encrypted (service role only) and returns to the settings page. Tokens never reach the browser or the logs.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/data';
import { can } from '@/lib/perm';
import { driveConfig, exchangeCode } from '@/lib/drive';
import { saveConnection } from '@/lib/drive-data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = new URL('/settings/integrations', req.url);
  const jar = await cookies();
  const expected = jar.get('gdrive_oauth_state')?.value;
  const fail = (m: string) => { back.searchParams.set('err', m); const r = NextResponse.redirect(back); r.cookies.delete({ name: 'gdrive_oauth_state', path: '/api/google/drive' }); return r; };
  if (url.searchParams.get('error')) return fail('Google did not grant access: ' + url.searchParams.get('error'));
  const state = url.searchParams.get('state'); const code = url.searchParams.get('code');
  if (!expected || !state || state !== expected || !code) return fail('The sign-in response could not be verified. Start again from this page.');
  const s = await getSession();
  if (!s || !can(s, 'drive.admin')) return fail('Only a Google Drive administrator can connect Drive.');
  const cfg = driveConfig(); if (!cfg) return fail('Google Drive is not configured.');
  try {
    const t = await exchangeCode(cfg, code);
    await saveConnection(t.refresh, t.email, t.scopes, s.user.id);
  } catch (e) {
    return fail('Connecting Google Drive failed: ' + (e as Error).message.slice(0, 200));
  }
  back.searchParams.set('msg', 'Google Drive connected. Now choose the root folder.');
  const r = NextResponse.redirect(back); r.cookies.delete({ name: 'gdrive_oauth_state', path: '/api/google/drive' }); return r;
}
