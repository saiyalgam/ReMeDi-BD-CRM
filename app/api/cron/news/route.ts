import { NextResponse, type NextRequest } from 'next/server';
import { bearerOk } from '@/lib/auth-header';
import { refreshNews } from '@/lib/data';

export const maxDuration = 60;

// Vercel Cron calls this daily (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: NextRequest) {
  if (!bearerOk(request.headers.get('authorization'), process.env.CRON_SECRET)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await refreshNews());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
