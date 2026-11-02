import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { UNLOCK_COOKIE, pinSecret, verifyToken } from './lib/pin-cookie';

// Keeps the Supabase session fresh and sends signed-out visitors to /login.
// TPIN (update 6): a signed-in visitor without a valid unlock cookie goes to /unlock (PIN) instead of a new email link.
// The gate is on only when PIN_COOKIE_SECRET is set (always on in demo mode).
const DEMO_DEFAULT_USER = '00000000-0000-4000-8000-000000000001';
const PIN_FREE = (p: string) => p.startsWith('/unlock') || p.startsWith('/set-pin');

function toUnlock(request: NextRequest) {
  const dest = request.nextUrl.clone();
  dest.pathname = '/unlock';
  dest.search = '';
  const back = request.nextUrl.pathname + request.nextUrl.search;
  if (back !== '/') dest.searchParams.set('next', back);
  return NextResponse.redirect(dest);
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (process.env.DEMO_MODE === '1') {
    const path = request.nextUrl.pathname;
    if (PIN_FREE(path) || path.startsWith('/api/') || path.startsWith('/auth')) return NextResponse.next();
    const uid = request.cookies.get('demo_as')?.value || DEMO_DEFAULT_USER;
    return (await verifyToken('unlock', request.cookies.get(UNLOCK_COOKIE)?.value, uid)) ? NextResponse.next() : toUnlock(request);
  }
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headers) Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      }
    }
  });
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith('/login') || path.startsWith('/auth') || path.startsWith('/api/');
  if (!data?.claims && !isPublic) {
    const dest = request.nextUrl.clone();
    dest.pathname = '/login';
    dest.search = '';
    return NextResponse.redirect(dest);
  }
  const uid = data?.claims?.sub;
  if (uid && !isPublic && !PIN_FREE(path) && pinSecret() && !(await verifyToken('unlock', request.cookies.get(UNLOCK_COOKIE)?.value, String(uid)))) {
    const redirect = toUnlock(request);
    response.cookies.getAll().forEach(c => redirect.cookies.set(c)); // keep any refreshed Supabase session cookies
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
