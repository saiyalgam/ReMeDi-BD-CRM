import Link from 'next/link';
import { mergeAction, verifyAction } from '@/app/actions';
import { Badge, Denied, Due, Empty, Notes, PageHead, Ref, Score, TypeTag } from '@/components/ui';
import { getSession, lastIngest, listLeads } from '@/lib/data';
import { ago, fmtDateTime } from '@/lib/format';
import { titleKey } from '@/lib/leadtype';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import type { Lead } from '@/lib/types';

export const metadata = { title: 'Crawler intake' };
type SP = Promise<Record<string, string | string[] | undefined>>;

/** Words in a title, for a rough similarity score between two notices. */
const words = (t: string) => new Set(titleKey(t).split(' ').filter(w => w.length > 3));
function similarity(a: Lead, b: Lead): number {
  const A = words(a.title), B = words(b.title);
  if (!A.size || !B.size) return 0;
  let common = 0; for (const w of A) if (B.has(w)) common++;
  let s = common / Math.min(A.size, B.size);
  if (a.funder_buyer && b.funder_buyer && titleKey(a.funder_buyer) === titleKey(b.funder_buyer)) s += 0.15;
  if (a.ref_no && b.ref_no && a.ref_no === b.ref_no) s += 0.5;
  return s;
}

export default async function IntakePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, leads, run] = await Promise.all([getSession(), listLeads(), lastIngest()]);
  const pending = leads.filter(l => l.verification === 'Unverified' && isOpen(l)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pool = leads.filter(l => l.verification !== 'Incorrect' && l.verification !== 'Duplicate');
  const withDup = pending.map(l => {
    const cands = pool.filter(o => o.id !== l.id).map(o => ({ o, s: similarity(l, o) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3);
    return { l, cands };
  });
  const focus = Number(sp.dup) || null;
  const verify = can(session, 'opp.verify');

  return (
    <>
      <PageHead eyebrow="Pipeline" title="Crawler intake" crumbs={[{ href: '/', label: 'Dashboard' }, { href: '/review', label: 'Review queue' }]}
        actions={can(session, 'opp.create') ? <Link className="btn" href="/settings/import">Import spreadsheet</Link> : undefined}>
        New leads from the crawler and manual entry, waiting for a person to say whether each one is real and relevant. {run ? `Last delivery ${ago(run.run_at)} (${fmtDateTime(run.run_at)} IST): ${run.inserted} new of ${run.received}.` : 'No crawler delivery yet.'}
      </PageHead>
      <Notes sp={sp} />
      {!verify ? <Denied>Your role can see intake but cannot verify leads.</Denied> : null}
      <section className="tbl-card">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Lead</th><th>Type · fit</th><th>Deadline</th><th>Possible duplicates</th><th>Verify</th></tr></thead>
          <tbody>
            {withDup.map(({ l, cands }) => (
              <tr key={l.id} className={focus === l.id ? 'sel' : ''} id={`l${l.id}`}>
                <td className="t" style={{ minWidth: 280 }}><Ref code={l.ref_code} /> <Link href={`/leads/${l.id}`}>{l.title}</Link><div className="sub">{[l.funder_buyer, l.country].filter(Boolean).join(' · ')}</div><div className="sub">{l.source} · found {ago(l.created_at)}</div></td>
                <td><TypeTag type={l.lead_type} /><div style={{ marginTop: 4 }}><Score value={l.fit_score} /></div></td>
                <td><Due deadline={l.deadline} /></td>
                <td style={{ minWidth: 240 }}>
                  {cands.length ? cands.map(({ o, s }) => (
                    <div key={o.id} style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                      <span><Badge tone="q">{Math.round(Math.min(1, s) * 100)}% similar</Badge> <Ref code={o.ref_code} /> <Link href={`/leads/${o.id}`} style={{ fontSize: 13 }}>{o.title.slice(0, 70)}</Link></span>
                      {verify ? <form action={mergeAction} className="inline"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="into" value={o.id} /><button className="btn btn-sm" type="submit">Merge into {o.ref_code}</button></form> : null}
                    </div>
                  )) : <span className="muted" style={{ fontSize: 13 }}>None found</span>}
                </td>
                <td style={{ minWidth: 220 }}>
                  {verify ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <form action={verifyAction} className="inline"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value="/intake" /><button className="btn btn-sm btn-good" name="verification" value="Correct" type="submit">✓ Correct</button>{cands.length ? <button className="btn btn-sm" formAction={mergeAction} name="op" value="keep" type="submit">Not a duplicate</button> : null}</form>
                      <form action={verifyAction} className="inline"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value="/intake" /><input type="hidden" name="verification" value="Incorrect" /><input type="text" name="note" required placeholder="Why it is wrong" aria-label={`Why ${l.ref_code} is incorrect`} style={{ width: 130 }} /><button className="btn btn-sm btn-bad" type="submit">✕ Incorrect</button></form>
                    </div>
                  ) : <Badge tone="neu">Unverified</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!withDup.length ? <Empty title="Intake is clear">Every open lead has been verified. New crawler deliveries appear here.</Empty> : null}
        <div className="tbl-foot"><span>{withDup.length} waiting · merging marks the newer lead as a Duplicate; its reference number stays reserved and is never reused.</span></div>
      </section>
    </>
  );
}
