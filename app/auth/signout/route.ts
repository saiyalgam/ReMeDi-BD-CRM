import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseConfig } from '@/lib/env';

export async function POST(request: NextRequest) {
  if (supabaseConfig()) await (await supabaseServer()).auth.signOut();
  const dest = request.nextUrl.clone();
  dest.pathname = '/login';
  dest.search = '';
  return NextResponse.redirect(dest, { status: 303 });
}
