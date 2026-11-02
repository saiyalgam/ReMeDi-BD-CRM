import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseConfig } from '@/lib/env';
import { FRESH_COOKIE, UNLOCK_COOKIE } from '@/lib/pin-cookie';

export async function POST(request: NextRequest) {
  if (supabaseConfig()) await (await supabaseServer()).auth.signOut();
  const dest = request.nextUrl.clone();
  dest.pathname = '/login';
  dest.search = '';
  const res = NextResponse.redirect(dest, { status: 303 });
  res.cookies.delete(UNLOCK_COOKIE);
  res.cookies.delete(FRESH_COOKIE);
  return res;
}
