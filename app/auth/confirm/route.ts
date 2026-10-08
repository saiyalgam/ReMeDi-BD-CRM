import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

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
  return NextResponse.redirect(dest);
}
