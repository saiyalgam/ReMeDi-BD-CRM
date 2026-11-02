import Link from 'next/link';
import { AutoSubmitSelect } from '@/components/AutoSubmit';
import { TrackerBoard, type BoardCard } from '@/components/TrackerBoard';
import { Notes } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { daysLeft, fmtDate, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import {
  BOARD_STATUSES, CLOSED_TRACKER, SIZE_BUCKETS, STATUS_COLOR, TRACKER_CATEGORIES, TRACKER_STATUSES,
  crore, fmtCr, sizeBucket, trackerCategory, trackerStatus, type TrackerStatus
} from '@/lib/tracker';
import type { Lead } from '@/lib/types';

export const metadata = { title: 'Lead Tracker' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default async function TrackerPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, leads, members] = await Promise.all([getSession(), listLeads(), listMembers()]);
  const me = session!.user.id;
  const f = {
    q: one(sp.q).toLowerCase().slice(0, 100), cat: one(sp.cat), owner: one(sp.owner), geo: one(sp.geo), size: one(sp.size), prio: one(sp.prio),
    st: one(sp.st), scope: one(sp.scope) || 'team', closing: one(sp.closing) === '1', view: one(sp.view) === 'table' ? 'table' : 'kanban'
  };

  // Team leads: verified by a person or added by hand. Crawler leads nobody has checked yet stay in the review queue.
  const inScope = (l: Lead) => f.scope === 'all' ? l.verification !== 'Incorrect' && l.verification !== 'Duplicate'
    : f.scope === 'crawler' ? l.verification === 'Unverified' && l.origin !== 'manual'
      : (l.verification === 'Correct' || l.origin === 'manual');
  const base = leads.filter(inScope);
  const geos = [...new Set(base.map(l => (l.country || '').split(',').pop()!.trim()).filter(Boolean))].sort();
  const rows = base.filter(l => {
    if (f.cat && trackerCategory(l) !== f.cat) return false;
    if (f.owner === 'none' ? !!l.assigned_to : f.owner === 'me' ? l.assigned_to !== me : f.owner && l.assigned_to !== f.owner) return false;
    if (f.geo && !(l.country || '').includes(f.geo)) return false;
    if (f.size && sizeBucket(l) !== f.size) return false;
    if (f.prio && (l.priority || '') !== f.prio) return false;
    if (f.st && trackerStatus(l) !== f.st) return false;
    if (f.closing) { const d = daysLeft(l.deadline); if (d === null || d < 0 || d > 7) return false; }
    if (f.q && !`${l.title} ${l.funder_buyer || ''} ${l.ref_code || ''} ${l.suggested_partner || ''} ${l.contact_name || ''} ${l.country || ''}`.toLowerCase().includes(f.q)) return false;
    return true;
  });

  const agg = <K extends string>(keys: readonly K[], keyOf: (l: Lead) => K) => keys.map(k => {
    const ls = rows.filter(l => keyOf(l) === k);
    return { key: k, n: ls.length, cr: ls.reduce((a, l) => a + (crore(l.amount) || 0), 0) };
  });
  const byStatus = agg(TRACKER_STATUSES, trackerStatus);
  const byCat = agg(TRACKER_CATEGORIES, trackerCategory);
  const bySize = agg(SIZE_BUCKETS, sizeBucket);
  const total = { n: rows.length, cr: rows.reduce((a, l) => a + (crore(l.amount) || 0), 0) };

  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]).filter(([k, v]) => v && !['msg', 'err'].includes(k)));
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...flat, ...patch } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const s = p.toString(); return s ? `/tracker?${s}` : '/tracker';
  };

  const cards: BoardCard[] = rows.map(l => {
    const d = daysLeft(l.deadline);
    return {
      id: l.id, ref: l.ref_code, title: l.title, buyer: l.funder_buyer, owner: nameOf(members, l.assigned_to), geo: l.country,
      size: crore(l.amount) != null ? fmtCr(crore(l.amount)!) : l.amount, category: trackerCategory(l), type: l.lead_type,
      source: l.origin === 'manual' ? (l.source && /import/i.test(l.source) ? 'Imported' : 'Added by team') : 'Crawler',
      fit: l.fit_score, priority: l.priority, next: l.next_step, deadline: l.deadline ? fmtDate(l.deadline) : null,
      days: d, status: trackerStatus(l), decision: l.decision
    };
  });
  const canMove = can(session, 'opp.edit');

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">Business development</div>
          <h1>Lead Management</h1>
          <p>Every opportunity from identification to outcome. Drag a card to change its status; the detailed stage, Go / No-go and history stay on the lead.</p>
        </div>
        <div className="inline">
          {can(session, 'opp.create') ? <Link className="btn" href="/settings/import">Import leads</Link> : null}
          <Link className="btn" href={`/export/pipeline?show=all`}>Export</Link>
          {can(session, 'opp.create') ? <Link className="btn btn-primary" href="/leads/new">+ Add New Lead</Link> : null}
        </div>
      </div>
      <Notes sp={sp} />

      <section className="card matrices" aria-labelledby="mx-h">
        <header><h2 id="mx-h">Pipeline breakdown</h2><p>Count and value (₹ crore, where a value is known). Click a row to filter.</p></header>
        <div className="mx-grid">
          <Matrix title="By present state" rows={byStatus.map(r => ({ ...r, href: href({ st: f.st === r.key ? '' : r.key }), on: f.st === r.key }))} total={total} />
          <Matrix title="By category" rows={byCat.map(r => ({ ...r, href: href({ cat: f.cat === r.key ? '' : r.key }), on: f.cat === r.key }))} total={total} />
          <Matrix title="By size bucket" rows={bySize.map(r => ({ ...r, href: href({ size: f.size === r.key ? '' : r.key }), on: f.size === r.key }))} total={total} />
        </div>
      </section>

      <nav className="stagestrip" aria-label="Leads by status">
        {byStatus.map((r, i) => (
          <Link key={r.key} href={href({ st: f.st === r.key ? '' : r.key })} className="stagecell" aria-current={f.st === r.key ? 'true' : undefined}>
            <small>{i + 1}. {r.key}</small>
            <b>{r.n} <span>lead{r.n === 1 ? '' : 's'}</span></b>
            <em className={r.key === 'Tanked' && r.n ? 'hot' : undefined}>{fmtCr(r.cr)}</em>
            <i style={{ background: STATUS_COLOR[r.key as TrackerStatus].bg }} aria-hidden="true" />
          </Link>
        ))}
      </nav>

      <form className="card filterbar" action="/tracker" role="search">
        <div className="fb-search">
          <label className="sr-only" htmlFor="tq">Filter</label>
          <input id="tq" type="search" name="q" defaultValue={one(sp.q)} placeholder="Filter by project name, buyer, partner or PoC…" />
        </div>
        <div className="fb-row">
          <AutoSubmitSelect name="scope" defaultValue={f.scope} label="Which leads">
            <option value="team">Team leads</option><option value="crawler">Crawler, not yet verified</option><option value="all">All leads</option>
          </AutoSubmitSelect>
          <AutoSubmitSelect name="cat" defaultValue={f.cat} label="Category"><option value="">Category: All</option>{TRACKER_CATEGORIES.map(c => <option key={c}>{c}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="owner" defaultValue={f.owner} label="Owner"><option value="">Owner: All</option><option value="me">Me</option><option value="none">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="geo" defaultValue={f.geo} label="Geography"><option value="">Geography: All</option>{geos.map(g => <option key={g}>{g}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="size" defaultValue={f.size} label="Size"><option value="">Size: All</option>{SIZE_BUCKETS.map(s => <option key={s}>{s}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="prio" defaultValue={f.prio} label="Priority"><option value="">Priority: All</option>{['Apply', 'Consider', 'Watch', 'Skip', 'Review'].map(p => <option key={p}>{p}</option>)}</AutoSubmitSelect>
          {f.st ? <input type="hidden" name="st" value={f.st} /> : null}
          {f.view === 'table' ? <input type="hidden" name="view" value="table" /> : null}
          <Link className={`chiptoggle${f.closing ? ' on' : ''}`} href={href({ closing: f.closing ? '' : '1' })}><i aria-hidden="true" />Closing in 7 days</Link>
          <button className="btn btn-sm" type="submit">Apply</button>
          <Link className="btn btn-sm" href="/tracker" title="Clear filters">Reset</Link>
          <span className="seg" role="group" aria-label="View">
            <Link href={href({ view: '' })} aria-current={f.view === 'kanban' ? 'true' : undefined}>Kanban</Link>
            <Link href={href({ view: 'table' })} aria-current={f.view === 'table' ? 'true' : undefined}>Table</Link>
          </span>
        </div>
      </form>

      {f.view === 'kanban' ? (
        <TrackerBoard cards={cards} columns={BOARD_STATUSES} closed={CLOSED_TRACKER} canMove={canMove} />
      ) : (
        <section className="card tbl-card">
          <div className="tbl-wrap">
            <table className="tbl tracker-tbl">
              <thead><tr><th>S. No.</th><th>Name of the project</th><th>Category</th><th className="r">Size (₹ Cr)</th><th>Present state</th><th>Lead owner</th><th>Geography</th><th>Details</th><th>Next step</th><th>Partner(s)</th><th className="r">Fit</th><th>Deadline</th></tr></thead>
              <tbody>
                {rows.length ? rows.map((l, i) => {
                  const st = trackerStatus(l); const c = crore(l.amount);
                  return (
                    <tr key={l.id}>
                      <td className="num">{i + 1}</td>
                      <td><Link href={`/leads/${l.id}`}><b>{l.title}</b></Link><div className="sub muted">{l.ref_code} · {l.funder_buyer || '—'}</div></td>
                      <td>{trackerCategory(l)}</td>
                      <td className="r">{c != null ? Number(c.toFixed(2)) : '—'}</td>
                      <td><span className="stchip" style={{ background: STATUS_COLOR[st].bg, color: STATUS_COLOR[st].fg }}>{st}</span></td>
                      <td>{nameOf(members, l.assigned_to) || <span className="muted">Unassigned</span>}</td>
                      <td>{l.country || '—'}</td>
                      <td className="clip">{l.summary || '—'}</td>
                      <td className="clip">{l.next_step || '—'}</td>
                      <td>{l.suggested_partner || '—'}</td>
                      <td className="r">{l.fit_score ?? '—'}</td>
                      <td>{l.deadline ? fmtDate(l.deadline) : '—'}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={12} className="muted">No leads match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function Matrix({ title, rows, total }: { title: string; rows: { key: string; n: number; cr: number; href: string; on: boolean }[]; total: { n: number; cr: number } }) {
  return (
    <table className="mx">
      <thead><tr><th scope="col">{title}</th><th scope="col" className="r">Count · Value</th></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className={r.on ? 'on' : undefined}>
            <td><Link href={r.href}>{r.key}</Link></td>
            <td className="r"><Link href={r.href}>{r.n} · {fmtCr(r.cr)}</Link></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td className="r">{total.n} · {fmtCr(total.cr)}</td></tr></tfoot>
    </table>
  );
}
