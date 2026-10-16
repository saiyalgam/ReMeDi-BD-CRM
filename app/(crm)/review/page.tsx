import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { reviewAmendmentAction } from '@/app/actions';
import { Badge, Due, Empty, Notes, PageHead, Ref, Who } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listDeadlines, listDocRequests, listDocs, listRequirements } from '@/lib/data-ext';
import { ago, daysLeft, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { QUEUE_LABEL, reviewQueue, type QueueKind } from '@/lib/views';

export const metadata = { title: 'Review queue' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const ORDER: QueueKind[] = ['decisions', 'amendments', 'eligibility', 'documents', 'unverified', 'duplicates'];
const ACTION: Record<QueueKind, string> = { unverified: 'Verify', duplicates: 'Compare', documents: 'Request', eligibility: 'Review', amendments: 'Verify', decisions: 'Decide' };

export default async function ReviewPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, leads, members, deadlines, docs, requests, reqs] = await Promise.all([getSession(), listLeads(), listMembers(), listDeadlines(), listDocs(), listDocRequests(), listRequirements()]);
  const all = reviewQueue(leads, deadlines, docs, requests, reqs);
  const tab = (ORDER.includes(sp.tab as QueueKind) ? sp.tab : 'all') as QueueKind | 'all';
  const who = typeof sp.who === 'string' ? sp.who : '';
  const scoped = all.filter(i => !who || (who === 'me' ? i.owner === session!.user.id : who === 'none' ? !i.owner : i.owner === who));
  const items = scoped.filter(i => tab === 'all' || i.kind === tab)
    .sort((a, b) => (daysLeft(a.lead.deadline) ?? 999) - (daysLeft(b.lead.deadline) ?? 999) || a.since.localeCompare(b.since));
  const count = (k: QueueKind) => scoped.filter(i => i.kind === k).length;
  const old = scoped.filter(i => Date.now() - Date.parse(i.since) > 3 * 864e5).length;
  const soon = scoped.filter(i => { const d = daysLeft(i.lead.deadline); return d !== null && d >= 0 && d <= 7; }).length;
  const link = (patch: Record<string, string>) => { const p = new URLSearchParams({ ...(tab !== 'all' ? { tab } : {}), ...(who ? { who } : {}), ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `/review${p.toString() ? '?' + p : ''}`; };

  return (
    <>
      <PageHead eyebrow="Desk" title="Review queue" crumbs={[{ href: '/', label: 'Dashboard' }]}
        actions={<form method="get" className="inline">{tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
          <label className="sr-only" htmlFor="who">Show</label>
          <select id="who" name="who" defaultValue={who}><option value="">Everyone’s items</option><option value="me">Owned by me</option><option value="none">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select>
          <button className="btn" type="submit">Show</button></form>}
        tools={<ExportMenu kind="review" params={sp} canExport={can(session, 'opp.export')} />}>
        Work that needs a person before an opportunity can move on. Each item opens the opportunity at the right section.
      </PageHead>
      <Notes sp={sp} />
      <div className="stats">
        <div className="stat"><small>Waiting on approval</small><b>{count('decisions')}</b><span className="muted" style={{ fontSize: 12 }}>{can(session, 'decision.approve') ? 'You can approve these' : 'Approvers are notified'}</span></div>
        <div className="stat"><small>In the queue over 3 days</small><b style={{ color: old ? 'var(--warning-text)' : undefined }}>{old}</b></div>
        <div className="stat"><small>Deadline in 7 days or less</small><b style={{ color: soon ? 'var(--critical-text)' : undefined }}>{soon}</b></div>
        <div className="stat"><small>Unassigned items</small><b>{scoped.filter(i => !i.owner).length}</b></div>
      </div>
      <nav className="qtabs" aria-label="Review type">
        <Link className="qtab" href={link({ tab: '' })} aria-current={tab === 'all' ? 'page' : undefined}>All <span className="n">{scoped.length}</span></Link>
        {ORDER.map(k => <Link key={k} className="qtab" href={link({ tab: k })} aria-current={tab === k ? 'page' : undefined}>{QUEUE_LABEL[k]} <span className="n">{count(k)}</span></Link>)}
      </nav>
      <section className="tbl-card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Review</th><th>Opportunity</th><th>Owner</th><th>In queue</th><th>Deadline</th><th>Next action</th></tr></thead>
            <tbody>
              {items.map((i, n) => {
                const age = Date.now() - Date.parse(i.since);
                return (
                  <tr key={`${i.kind}-${i.lead.id}-${i.amendmentId || n}`}>
                    <td style={{ whiteSpace: 'nowrap' }}><Badge tone={i.kind === 'decisions' ? 'info' : i.kind === 'documents' ? 'bad' : i.kind === 'unverified' || i.kind === 'duplicates' ? 'neu' : 'q'}>{QUEUE_LABEL[i.kind]}</Badge></td>
                    <td className="t" style={{ minWidth: 280 }}><Ref code={i.lead.ref_code} /> <Link href={i.href}>{i.lead.title}</Link><div className="sub">{i.detail}</div></td>
                    <td>{i.owner ? <Who name={nameOf(members, i.owner)} /> : <Badge tone="q">Unassigned</Badge>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><span className={age > 3 * 864e5 ? 'due soon' : 'muted'}>{ago(i.since).replace(' ago', '')}</span></td>
                    <td><Due deadline={i.lead.deadline} /></td>
                    <td style={{ minWidth: 180 }}>
                      {i.kind === 'amendments' && i.amendmentId && can(session, 'deadline.verify') ? (
                        <form action={reviewAmendmentAction} className="inline">
                          <input type="hidden" name="aid" value={i.amendmentId} /><input type="hidden" name="return" value={link({})} />
                          <button className="btn btn-sm btn-good" name="verdict" value="verify" type="submit">✓ Verify</button>
                          <button className="btn btn-sm" name="verdict" value="reject" type="submit">Reject</button>
                          <Link className="btn btn-sm" href={i.href}>Source</Link>
                        </form>
                      ) : <Link className={`btn btn-sm${i.kind === 'decisions' ? ' btn-primary' : ''}`} href={i.href}>{ACTION[i.kind]} →</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!items.length ? <Empty title="Nothing waiting here">Items leave the queue automatically when their decision is saved.</Empty> : null}
        </div>
        <div className="tbl-foot"><span>{items.length} item{items.length === 1 ? '' : 's'} · sorted by deadline, then time in queue</span><Link href="/intake">Crawler intake →</Link></div>
      </section>
    </>
  );
}
