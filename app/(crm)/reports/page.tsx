import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { Denied, Empty, PageHead } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listTasks } from '@/lib/data-ext';
import { fmtDate, nameOf, todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { isOpen, overview, weekStart } from '@/lib/views';
import { LEAD_TYPES, STAGES, TYPE_LABEL } from '@/lib/types';

export const metadata = { title: 'Reports' };
type SP = Promise<Record<string, string | string[] | undefined>>;

function Bars({ rows, max, unit = '' }: { rows: { label: string; n: number; href?: string }[]; max?: number; unit?: string }) {
  const m = max ?? Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="funnel">
      {rows.map(r => {
        const inner = <><span>{r.label}</span><span className="track"><span style={{ width: `${(r.n / m) * 100}%` }} /></span><b>{r.n}{unit}</b></>;
        return r.href ? <Link key={r.label} href={r.href}>{inner}</Link> : <a key={r.label} aria-disabled="true" style={{ cursor: 'default' }}>{inner}</a>;
      })}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, leads, members, tasks] = await Promise.all([getSession(), listLeads(), listMembers(), listTasks()]);
  if (!can(session, 'reports.read')) return <><PageHead title="Reports" /><Denied>Your role cannot see reports.</Denied></>;
  const weeksBack = Number(sp.weeks) || 12;
  const live = leads.filter(l => l.verification !== 'Incorrect' && l.verification !== 'Duplicate');
  const o = overview(leads);
  const ws0 = weekStart(todayIST());
  const weeks = Array.from({ length: weeksBack }, (_, i) => new Date(Date.parse(ws0 + 'T00:00:00Z') - (weeksBack - 1 - i) * 7 * 864e5).toISOString().slice(0, 10));
  const found = weeks.map(w => ({ w, n: leads.filter(l => weekStart(l.created_at) === w).length }));
  const applied = weeks.map(w => ({ w, n: leads.filter(l => l.applied_on && weekStart(l.applied_on) === w).length }));
  const maxW = Math.max(1, ...found.map(x => x.n), ...applied.map(x => x.n));
  const decided = live.filter(l => l.decision !== 'Undecided');
  const conv = [
    { label: 'Verified correct → Go', n: live.filter(l => l.verification === 'Correct').length ? Math.round(100 * live.filter(l => l.decision === 'Go').length / live.filter(l => l.verification === 'Correct').length) : 0 },
    { label: 'Go → submitted', n: live.filter(l => l.decision === 'Go').length ? Math.round(100 * live.filter(l => l.decision === 'Go' && ['Submitted', 'Clarification', 'Won', 'Lost'].includes(l.stage)).length / live.filter(l => l.decision === 'Go').length) : 0 },
    { label: 'Submitted → won', n: live.filter(l => ['Won', 'Lost'].includes(l.stage)).length ? Math.round(100 * live.filter(l => l.stage === 'Won').length / live.filter(l => ['Won', 'Lost'].includes(l.stage)).length) : 0 }
  ];
  const reasons = new Map<string, number>();
  for (const l of o.noGoReasons) for (const k of ['BOOT', 'EMD', 'payment', 'turnover', 'experience', 'scope', 'partner', 'regulat', 'capex', 'margin', 'credibility', 'fee']) if (new RegExp(k, 'i').test(l.decision_reason || '')) reasons.set(k, (reasons.get(k) || 0) + 1);

  return (
    <>
      <PageHead eyebrow="Insight" title="Reports" crumbs={[{ href: '/', label: 'Dashboard' }]}
        actions={<form method="get" className="inline"><label className="sr-only" htmlFor="wk">Period</label><select id="wk" name="weeks" defaultValue={String(weeksBack)}><option value="8">8 weeks</option><option value="12">12 weeks</option><option value="26">26 weeks</option></select><button className="btn" type="submit">Show</button></form>}
        tools={<ExportMenu kind="reports" params={sp} canExport={can(session, 'opp.export')} csvSheets={['Stages', 'By type', 'Weekly', 'Workload', 'No-go reasons', 'Crawler sources']} />}>
        Pipeline trends, conversion, proposal volume, No-go reasons, deadlines and workload. Every bar links to the records behind it.
      </PageHead>

      <section className="card">
        <header><div><h2>Found vs applied per week</h2><p>Opportunities added (all sources) and applications made (“applied on” date).</p></div></header>
        <div className="weeks" style={{ gridTemplateColumns: `repeat(${weeksBack}, minmax(0,1fr))`, height: 140 }} role="img" aria-label="Weekly opportunities found and applications made">
          {weeks.map((w, i) => (
            <div key={w} title={`Week of ${fmtDate(w)}: ${found[i]!.n} found, ${applied[i]!.n} applied`}>
              <b>{applied[i]!.n || ''}</b>
              <span style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 100 }}>
                <i style={{ width: 10, height: `${(found[i]!.n / maxW) * 100}px`, background: 'var(--neutral-mark)' }} />
                <i style={{ width: 10, height: `${(applied[i]!.n / maxW) * 100}px` }} />
              </span>
              <span>{fmtDate(w).replace(/ \d{4}$/, '')}</span>
            </div>
          ))}
        </div>
        <p className="legal">Grey: found · Teal: applied. Weeks start on Monday (IST).</p>
      </section>

      <div className="grid2">
        <section className="card"><header><div><h2>Stage</h2><p>Every opportunity not marked wrong or duplicate.</p></div></header>
          <Bars rows={STAGES.map(s => ({ label: s, n: live.filter(l => l.stage === s).length, href: `/leads?stage=${encodeURIComponent(s)}&show=all` }))} />
        </section>
        <section className="card"><header><div><h2>Conversion</h2><p>Share moving to the next step (decided records only).</p></div></header>
          <Bars rows={conv} max={100} unit="%" />
          <p className="legal">{decided.length} decided · {o.reviewed} verified · lead accuracy {o.accuracy == null ? '—' : Math.round(o.accuracy * 100) + '%'}.</p>
        </section>
      </div>

      <div className="grid2">
        <section className="card"><header><div><h2>By category</h2><p>Open now / all time.</p></div></header>
          <Bars rows={LEAD_TYPES.map(t => ({ label: TYPE_LABEL[t], n: live.filter(l => l.lead_type === t && isOpen(l)).length, href: `/leads?type=${t === 'RFP / EOI' ? 'rfp' : t.toLowerCase()}` }))} />
          <p className="legal">{LEAD_TYPES.map(t => `${TYPE_LABEL[t]}: ${live.filter(l => l.lead_type === t).length}`).join(' · ')} all time.</p>
        </section>
        <section className="card"><header><div><h2>Proposals by person</h2><p>Applications made (“applied on”) in the period, by owner.</p></div></header>
          {(() => { const since = weeks[0]!; const rows = members.map(m => ({ label: m.full_name || m.email, n: leads.filter(l => l.assigned_to === m.id && l.applied_on && l.applied_on >= since).length, href: `/leads?assignee=${m.id}&show=all` })).filter(r => r.n); return rows.length ? <Bars rows={rows} /> : <Empty title="No applications recorded in this period" />; })()}
        </section>
      </div>

      <div className="grid2">
        <section className="card"><header><div><h2>Why we said No-go</h2><p>Recurring themes in No-go reasons (keyword count) and the latest reasons. Learning data for review — criteria never change automatically.</p></div><Link href="/leads?decision=No-go&show=all">All No-go</Link></header>
          {reasons.size ? <Bars rows={[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k, n }))} /> : null}
          {o.noGoReasons.length ? <ul className="reasons">{o.noGoReasons.slice(0, 6).map(l => <li key={l.id}><Link href={`/leads/${l.id}?tab=decision`}>{l.ref_code} · {l.title.slice(0, 70)}</Link><span>{l.decision_reason}</span></li>)}</ul> : <Empty title="No No-go decisions yet" />}
        </section>
        <section className="card"><header><div><h2>Workload</h2><p>Open opportunities and tasks per person.</p></div></header>
          <Bars rows={members.map(m => ({ label: m.full_name || m.email, n: leads.filter(l => l.assigned_to === m.id && isOpen(l)).length + tasks.filter(t => t.assignee === m.id && !t.personal && (t.status === 'Open' || t.status === 'In progress')).length, href: `/activity?person=${m.id}` }))} />
          <p className="legal">Unassigned open opportunities: <Link href="/leads?assignee=none">{leads.filter(l => !l.assigned_to && isOpen(l)).length}</Link>. Owner of the most: {(() => { const top = [...members].sort((a, b) => leads.filter(l => l.assigned_to === b.id && isOpen(l)).length - leads.filter(l => l.assigned_to === a.id && isOpen(l)).length)[0]; return top ? nameOf(members, top.id) : '—'; })()}.</p>
        </section>
      </div>

      <section className="card"><header><div><h2>Crawler sources</h2><p>Share of checked leads marked correct, by source.</p></div></header>
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Source</th><th className="r">Found</th><th className="r">Checked</th><th className="r">Correct</th><th className="r">Wrong / duplicate</th><th className="r">Accuracy</th></tr></thead>
          <tbody>{o.bySource.slice(0, 15).map(s => <tr key={s.source}><td>{s.source}</td><td className="r">{s.total}</td><td className="r">{s.reviewed}</td><td className="r">{s.correct}</td><td className="r">{s.wrong}</td><td className="r">{s.accuracy == null ? <span className="muted">—</span> : `${Math.round(s.accuracy * 100)}%`}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}
