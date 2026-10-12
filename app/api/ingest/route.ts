import { NextResponse, type NextRequest } from 'next/server';
import { bearerOk } from '@/lib/auth-header';
import { ingestLeads, knownLeadKeys } from '@/lib/data';

// The n8n crawler posts scored leads here: { "leads": [ {uid, title, category, deadline, ...}, ... ], "note": "optional" }
// "mode": "update" (for reviewed JSON files) also refreshes the assessment of leads that already exist.
export async function POST(request: NextRequest) {
  if (!bearerOk(request.headers.get('authorization'), process.env.INGEST_TOKEN)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }); }
  const b = body as { leads?: unknown; note?: unknown; mode?: unknown };
  const rows = Array.isArray(body) ? body : Array.isArray(b?.leads) ? (b.leads as unknown[]) : null;
  if (!rows) return NextResponse.json({ error: 'expected { "leads": [...] }' }, { status: 400 });
  if (rows.length > 2000) return NextResponse.json({ error: 'send at most 2000 leads per request' }, { status: 413 });
  try {
    return NextResponse.json(await ingestLeads(rows, typeof b?.note === 'string' ? b.note.slice(0, 200) : undefined, b?.mode === 'update' ? 'update' : 'insert'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// The crawler asks which leads already exist (so it doesn't score them again) and for the team's verdicts (to learn from).
export async function GET(request: NextRequest) {
  if (!bearerOk(request.headers.get('authorization'), process.env.INGEST_TOKEN)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await knownLeadKeys());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
