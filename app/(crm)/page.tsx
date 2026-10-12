import Link from 'next/link';
import { DecisionPill, Due, TYPE_COLOR, VerificationPill, Who } from '@/components/ui';
import { getSession, lastIngest, listLeads, listMembers, listNews } from '@/lib/data';
import { ago, daysLeft, fmtDateTime, nameOf, todayIST, fmtDate } from '@/lib/format';
import { overview } from '@/lib/views';
import { SLUG_OF, TYPE_LABEL, type Verification } from '@/lib/types';

const V_COLOR: Record<Verification, string> = { Correct: 'var(--good)', Incorrect: 'var(--critical)', Duplicate: 'var(--serious)', Unverified: 'var(--neutral-mark)' };
const V_NAME: Record<Verification, string> = { Correct: 'Correct', Incorrect: 'Wrong lead', Duplicate: 'Duplicate', Unverified: 'Not checked' };
const pct = (x: number | null) => (x == null ? '–' : Math.round(x * 100) + '%');

export default async function Overview() {
  const [session, leads, members, news, run] = await Promise.all([getSession(), listLeads(), listMembers(), listNews(), lastIngest()]);
  const o = overview(leads, members);
  const maxStage = Math.max(1, ...o.pipeline.map(p => p.count));
  const toReview = news.filter(n => n.relevance === 'Unreviewed').sort((a, b) => b.auto_score - a.auto_score).slice(0, 5);
  const firstName = (session?.user.full_name || '').split(' ')[0];

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">{fmtDate(todayIST())}</div>
          <h1>{firstName ? `Desk overview, ${firstName}` : 'Desk overview'}</h1>
          <p>{run ? <>Last crawler delivery {ago(run.run_at)}: {run.inserted} new{run.updated ? `, ${run.updated} updated` : ''} of {run.received} sent ({fmtDateTime(run.run_at)} IST).</> : 'The crawler has not sent any leads yet.'}</p>
        </div>
        <Link className="btn btn-primary" href="/leads?verification=Unverified">Check new leads</Link>
      </div>

      <section className="kpis" aria-label="Summary">
        <Link className="kpi" href="/leads"><small>Open leads</small><b className="num">{o.kpi.open}</b><span className="sub">not closed or marked wrong</span></Link>
        <Link className="kpi" href="/leads?verification=Unverified"><small>Need checking</small><b className="num">{o.kpi.needsCheck}</b><span className="sub">correct or not?</span></Link>
        <Link className="kpi" href="/leads?assignee=none"><small>Unassigned</small><b className="num">{o.kpi.unassigned}</b><span className="sub">open leads with no owner</span></Link>
        <Link className="kpi" href="/leads?due=7"><small>Closing in 7 days</small><b className="num">{o.kpi.due7}</b><span className="sub">open leads</span></Link>
        <div className="kpi">
          <small>Lead accuracy</small>
          <b className="num">{pct(o.kpi.accuracy)}</b>
          <div className="meter" role="img" aria-label={`${o.kpi.correct} of ${o.kpi.reviewed} checked leads were correct`}>
            {o.kpi.reviewed ? <><i style={{ width: `${(o.kpi.correct / o.kpi.reviewed) * 100}%`, background: 'var(--good)' }} /><i style={{ flex: 1, background: 'var(--critical)' }} /></> : null}
          </div>
          <span className="sub">{o.kpi.correct} correct of {o.kpi.reviewed} checked</span>
        </div>
      </section>

      <div className="grid-3-2">
        <section className="card">
          <header><div><h2>Leads by type</h2><p>Open and rolling leads, split by whether someone has checked them.</p></div></header>
          <div className="sbars">
            {o.byType.map(t => (
              <Link key={t.type} className="sbar" href={`/leads?type=${SLUG_OF[t.type]}`} title={`${TYPE_LABEL[t.type]}: ${(['Correct', 'Unverified', 'Duplicate', 'Incorrect'] as Verification[]).map(v => `${t.counts[v]} ${V_NAME[v].toLowerCase()}`).join(', ')}`}>
                <span className="name"><i style={{ background: TYPE_COLOR[t.type] }} aria-hidden="true" />{TYPE_LABEL[t.type]}</span>
                <span className="track">
                  {(['Correct', 'Unverified', 'Duplicate', 'Incorrect'] as Verification[]).filter(v => t.counts[v] > 0).map(v => (
                    <span key={v} style={{ flex: t.counts[v], background: V_COLOR[v] }} />
                  ))}
                  {t.total === 0 ? <span style={{ flex: 1, background: 'var(--neutral-soft)' }} /> : null}
                </span>
                <span className="total">{t.total}</span>
              </Link>
            ))}
          </div>
          <div className="legend">
            {(['Correct', 'Unverified', 'Duplicate', 'Incorrect'] as Verification[]).map(v => <span key={v}><i style={{ background: V_COLOR[v] }} />{V_NAME[v]}</span>)}
          </div>
        </section>

        <section className="card">
          <header><div><h2>Pipeline</h2><p>Every lead not marked wrong, by stage.</p></div></header>
          <div className="hbars">
            {o.pipeline.map(p => (
              <div key={p.stage} className="hbar" title={`${p.stage}: ${p.count}`}>
                <span>{p.stage}</span>
                <span className="track"><span style={{ width: `${(p.count / maxStage) * 100}%` }} /></span>
                <b>{p.count}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <header>
          <div><h2>Is the crawler finding the right leads?</h2><p>Share of checked leads marked correct, by source. Mark leads correct or wrong to fill this in.</p></div>
        </header>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Source</th><th className="r">Found</th><th className="r">Checked</th><th className="r">Correct</th><th className="r">Wrong / duplicate</th><th style={{ minWidth: 170 }}>Accuracy</th></tr></thead>
            <tbody>
              {o.bySource.slice(0, 12).map(s => (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td className="r">{s.total}</td>
                  <td className="r">{s.reviewed}</td>
                  <td className="r">{s.correct}</td>
                  <td className="r">{s.wrong}</td>
                  <td>
                    {s.accuracy == null ? <span className="muted">Not checked yet</span> : (
                      <span className="acc" title={`${s.correct} of ${s.reviewed} correct`}>
                        <span className="meter"><i style={{ width: `${s.accuracy * 100}%`, background: 'var(--good)' }} /><i style={{ flex: 1, background: s.wrong ? 'var(--critical)' : 'transparent' }} /></span>
                        <b className="num">{pct(s.accuracy)}</b>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid2">
        <section className="card">
          <header><div><h2>Closing in the next 14 days</h2><p>Open leads, soonest first.</p></div><Link href="/leads?due=14">See all</Link></header>
          {o.closingSoon.length ? (
            <div className="mini">
              {o.closingSoon.slice(0, 8).map(l => (
                <div key={l.id}>
                  <div style={{ minWidth: 0 }}><Link href={`/leads/${l.id}`}>{l.title}</Link><div className="by">{l.funder_buyer}</div></div>
                  <Due deadline={l.deadline} />
                  <div className="st"><VerificationPill v={l.verification} /><Who name={nameOf(members, l.assigned_to)} /></div>
                </div>
              ))}
            </div>
          ) : <p className="muted">Nothing closes in the next two weeks.</p>}
        </section>

        <section className="card">
          <header><div><h2>Team workload</h2><p>Open leads assigned to each person.</p></div><Link href="/leads?assignee=none">{o.unassignedOpen} unassigned</Link></header>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Person</th><th className="r">Open</th><th className="r">Due ≤ 7 d</th><th className="r">Not checked</th><th className="r">Leads they checked</th></tr></thead>
            <tbody>
              {o.workload.map(w => (
                <tr key={w.member.id}>
                  <td><Link href={`/leads?assignee=${w.member.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><Who name={w.member.full_name || w.member.email} /></Link></td>
                  <td className="r">{w.open}</td>
                  <td className="r">{w.dueSoon}</td>
                  <td className="r">{w.unchecked}</td>
                  <td className="r">{w.checkedByThem}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <header><div><h2>Follow-ups this week</h2><p>Leads we are pursuing with a follow-up date in the next 7 days or overdue.</p></div><Link href="/leads?decision=Go">{o.decisions.go} Go</Link></header>
          {o.followUps.length ? (
            <div className="mini">
              {o.followUps.slice(0, 8).map(l => {
                const d = daysLeft(l.next_followup)!;
                return (
                  <div key={l.id}>
                    <div style={{ minWidth: 0 }}><Link href={`/leads/${l.id}`}>{l.title}</Link><div className="by">{[l.contact_name, l.contact_role].filter(Boolean).join(', ') || l.funder_buyer}</div></div>
                    <span className="dl"><span className="mono">{fmtDate(l.next_followup)}</span><span className={`due ${d <= 0 ? 'urgent' : 'soon'}`}>{d < 0 ? `overdue ${-d} d` : d === 0 ? 'today' : `in ${d} d`}</span></span>
                    <div className="st"><DecisionPill d={l.decision} /><Who name={nameOf(members, l.assigned_to)} /></div>
                  </div>
                );
              })}
            </div>
          ) : <p className="muted">No follow-ups due. Set a follow-up date in the Pursuit card on a lead.</p>}
        </section>

        <section className="card">
          <header><div><h2>Why we said No-go</h2><p>Recent reasons. The crawler reads these before scoring new leads.</p></div><Link href="/leads?decision=No-go&show=all">{o.decisions.noGo} No-go</Link></header>
          {o.noGoReasons.length ? (
            <ul className="reasons">
              {o.noGoReasons.map(l => <li key={l.id}><Link href={`/leads/${l.id}`}>{l.title}</Link><span>{l.decision_reason}</span></li>)}
            </ul>
          ) : <p className="muted">No No-go decisions yet. On a lead, use “Do we go for it?” and give the reason.</p>}
        </section>
      </div>

      <section className="card">
        <header><div><h2>News to review</h2><p>Latest stories from the news feeds, most likely relevant first.</p></div><Link href="/news">Open news</Link></header>
        {toReview.length ? (
          <ul className="timeline">
            {toReview.map(n => (
              <li key={n.id} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
                <div><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
                  <div className="when">{n.source} · {ago(n.published_at)}{n.auto_score >= 3 ? <> · <span className="hint">Likely relevant</span></> : null}</div></div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No unreviewed news. The daily news job runs at 7:00 IST; admins can also fetch now from the News page.</p>}
      </section>
    </>
  );
}
