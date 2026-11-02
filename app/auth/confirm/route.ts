import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { clearLock, getPin } from '@/lib/pin';
import { FRESH_COOKIE, FRESH_MINUTES, UNLOCK_COOKIE, UNLOCK_HOURS, cookieOptions, signToken } from '@/lib/pin-cookie';

// The magic link lands here. Handles both the token-hash link (works on any device) and the PKCE code link.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextParam = url.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const code = url.searchParams.get('code');
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const sb = await supabaseServer();
  let error: string | null;
  if (token_hash && type) error = (await sb.auth.verifyOtp({ type, token_hash })).error?.message ?? null;
  else if (code) error = (await sb.auth.exchangeCodeForSession(code)).error?.message ?? null;
  else error = 'The sign-in link is incomplete';
  const dest = request.nextUrl.clone();
  dest.search = '';
  if (error) { dest.pathname = '/login'; dest.searchParams.set('error', `Sign-in failed: ${error}. Request a new link.`); }
  else dest.pathname = next;
  const res = NextResponse.redirect(dest);
  if (!error) {
    // An email sign-in proves who this is: unlock this browser, clear a PIN lock, and allow a PIN reset for 15 minutes.
    const uid = (await sb.auth.getClaims()).data?.claims?.sub;
    if (uid) {
      const unlock = await signToken('unlock', String(uid), UNLOCK_HOURS * 3600e3);
      const fresh = await signToken('fresh', String(uid), FRESH_MINUTES * 60e3);
      if (unlock) res.cookies.set(UNLOCK_COOKIE, unlock, cookieOptions);
      if (fresh) res.cookies.set(FRESH_COOKIE, fresh, { ...cookieOptions, maxAge: FRESH_MINUTES * 60 });
      await clearLock(String(uid)).catch(() => undefined);
      // First sign-in: go and create a PIN.
      if (unlock && !(await getPin(String(uid)).catch(() => true))) { dest.pathname = '/set-pin'; dest.search = ''; if (next !== '/') dest.searchParams.set('next', next); const toPin = NextResponse.redirect(dest); res.cookies.getAll().forEach(c => toPin.cookies.set(c)); return toPin; }
    }
  }
  return res;
}
