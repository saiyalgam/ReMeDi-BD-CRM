// Downloads for the Export menu: /export/<kind>?format=xlsx|csv&<same filters as the screen>[&id=<lead>][&sheet=<n>]
// Outside /api on purpose so the sign-in proxy covers it. Permission checks live in buildExport (opp.export plus the
// screen's own read permission); restricted or sensitive fields are never selected for roles that cannot see them.
import { NextResponse, type NextRequest } from 'next/server';
import { NotAllowed } from '@/lib/data';
import { buildExport, EXPORT_KINDS, exportFileBase, logExport, type ExportKind } from '@/lib/exports';
import { toCsv, toXlsx } from '@/lib/xlsx-write';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new NextResponse('Unknown export', { status: 404 });
  const sp: Record<string, string | undefined> = Object.fromEntries(req.nextUrl.searchParams.entries());
  const format = sp.format === 'csv' ? 'csv' : 'xlsx';
  const id = sp.id ? Number(sp.id) : undefined;
  try {
    const res = await buildExport(kind as ExportKind, sp, id);
    const base = await exportFileBase(kind as ExportKind, res.title);
    const filters = Object.entries(sp).filter(([k, v]) => v && k !== 'format').map(([k, v]) => `${k}=${v}`).join('&');
    await logExport(kind as ExportKind, `${format}${filters ? ' ' + filters : ''}`, res.rowCount);
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (format === 'csv') {
      const idx = Math.min(Math.max(0, Number(sp.sheet) || 0), res.sheets.length - 1);
      const sheet = res.sheets[idx]!;
      const suffix = res.sheets.length > 1 ? `_${sheet.name.replace(/[^A-Za-z0-9-]+/g, '-')}` : '';
      return new NextResponse(toCsv(sheet), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}${suffix}.csv"` } });
    }
    const body = toXlsx(res.sheets, { title: res.title, author: 'ReMeDi Opportunity CRM' });
    return new NextResponse(body as unknown as BodyInit, { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"` } });
  } catch (e) {
    if (e instanceof NotAllowed) return new NextResponse(e.message, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    throw e;
  }
}
