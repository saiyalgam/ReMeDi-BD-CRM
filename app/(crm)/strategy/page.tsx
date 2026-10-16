import Link from 'next/link';
import { listLeads } from '@/lib/data';
import { isOpenLead } from '@/lib/views';

const bands = [
  { label: '₹10–30 lakh', min: 10, max: 30, cue: 'Selective pursuit' },
  { label: '₹30 lakh–₹1 crore', min: 30, max: 100, cue: 'Build a strong shortlist' },
  { label: 'Above ₹1 crore', min: 100, max: Infinity, cue: 'Strategic growth focus' },
];
function lakh(amount: string | null) {
  if (!amount) return null;
  const s = amount.toLowerCase().replace(/,/g, '');
  const n = Number(s.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
  if (!Number.isFinite(n)) return null;
  return s.includes('cr') || s.includes('crore') ? n * 100 : s.includes('usd') ? null : s.includes('lakh') || s.includes('lac') ? n : n >= 100000 ? n / 100000 : null;
}

export default async function StrategyPage() {
  const leads = (await listLeads()).filter(isOpenLead);
  const rows = bands.map(b => ({ ...b, leads: leads.filter(l => { const v = lakh(l.amount); return v != null && v >= b.min && v < b.max; }) }));
  const unestimated = leads.filter(l => lakh(l.amount) == null);
  const go = leads.filter(l => l.decision === 'Go').length;
  return <>
    <div className="phead"><div><div className="eyebrow">Planning</div><h1>Opportunity strategy</h1><p>Prioritize the pipeline by estimated value, then connect opportunities to the capabilities and partners needed to deliver.</p></div><Link className="btn" href="/leads">Review leads</Link></div>
    <section className="kpis" aria-label="Portfolio summary">
      <div className="kpi"><small>Open opportunities</small><b className="num">{leads.length}</b><span className="sub">Across all lead types</span></div>
      <div className="kpi"><small>Marked Go</small><b className="num">{go}</b><span className="sub">Team decision recorded</span></div>
      <div className="kpi"><small>Value not estimated</small><b className="num">{unestimated.length}</b><span className="sub">Add a value estimate during review</span></div>
    </section>
    <section className="card"><header><div><h2>Value portfolio</h2><p>Banding is estimated from the crawler or manually entered amount. Confirm currency and units before relying on totals.</p></div></header>
      <div className="grid-3-2">{rows.map(b => <article className="card" key={b.label}><div className="eyebrow">{b.cue}</div><h2>{b.label}</h2><b className="num">{b.leads.length}</b><p className="muted">{b.leads.length} opportunities</p>{b.leads.slice(0,4).map(l => <p key={l.id}><Link href={`/leads/${l.id}`}>{l.title}</Link></p>)}</article>)}</div>
      <p className="muted">{unestimated.length} opportunities need a usable value estimate.</p>
    </section>
    <section className="card"><header><div><h2>Partner and capability register</h2><p>Recommended next step: capture partner geography, implementation capacity, clinical/regulatory strengths, and consortium eligibility. Link a partner to each opportunity as part of go/no-go review.</p></div></header>
      <div className="note">Partners now have their own directory with verification status, and each opportunity links partners to the specific gap they cover. <Link href="/partners">Open the partner directory</Link>.</div>
    </section>
  </>;
}
