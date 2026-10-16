import Link from 'next/link';
import type { ReactNode } from 'react';
import { daysLeft, dueLabel, fmtDate, initials } from '@/lib/format';
import type { ApprovalStatus, Decision, EligibilityStatus, LeadType, Partner, ReqStatus, RiskLevel, Stage, Verification } from '@/lib/types';
import type { LeadFlags } from '@/lib/views';

// ---- the four separate decision fields: each has its own badge, always symbol + word ----
const V: Record<Verification, [string, string, string]> = {
  Unverified: ['?', 'Unverified', 'b-neu'], Correct: ['✓', 'Correct', 'b-ok'], Incorrect: ['✕', 'Incorrect', 'b-bad'], Duplicate: ['⧉', 'Duplicate', 'b-neu']
};
export function VerificationPill({ v }: { v: Verification }) {
  const [ic, label, cls] = V[v] || V.Unverified;
  return <span className={`badge ${cls}`} title="Lead verification"><span className="ic" aria-hidden="true">{ic}</span>{label}</span>;
}

const E: Record<EligibilityStatus, [string, string, string]> = {
  'Not assessed': ['○', 'Not assessed', 'b-neu'], 'Meets directly': ['✓', 'Meets directly', 'b-ok'],
  'Potentially eligible with partner': ['◐', 'Eligible with partner', 'b-info'], 'Does not meet': ['✕', 'Does not meet', 'b-bad'],
  'Needs clarification': ['?', 'Needs clarification', 'b-q']
};
export function EligibilityPill({ e }: { e: EligibilityStatus }) {
  const [ic, label, cls] = E[e] || E['Not assessed'];
  return <span className={`badge ${cls}`} title={`Eligibility: ${e}`}><span className="ic" aria-hidden="true">{ic}</span>{label}</span>;
}

export function DecisionPill({ d, approval, always }: { d: Decision | null | undefined; approval?: ApprovalStatus; always?: boolean }) {
  if (approval === 'Pending') return <span className="badge b-info" title="A recommendation is waiting for approval"><span className="ic" aria-hidden="true">◆</span>Awaiting approval</span>;
  if (!d || d === 'Undecided') return always ? <span className="badge b-neu"><span className="ic" aria-hidden="true">○</span>Undecided</span> : null;
  return d === 'Go'
    ? <span className="badge b-ok"><span className="ic" aria-hidden="true">▶</span>Go</span>
    : <span className="badge b-bad"><span className="ic" aria-hidden="true">■</span>No-go</span>;
}

export function StagePill({ s }: { s: Stage }) {
  const cls = s === 'Won' ? 'b-ok' : s === 'Lost' || s === 'Dropped' ? 'b-neu' : s === 'Banked' ? 'b-neu' : 'b-out';
  return <span className={`badge ${cls}`} title="Pipeline stage">{s}</span>;
}

const RQ: Record<ReqStatus, [string, string]> = { Meets: ['✓', 'b-ok'], 'Does not meet': ['✕', 'b-bad'], 'Partner may cover': ['◐', 'b-info'], 'Needs clarification': ['?', 'b-q'], 'Not assessed': ['○', 'b-neu'] };
export function ReqPill({ s }: { s: ReqStatus }) {
  const [ic, cls] = RQ[s] || RQ['Not assessed'];
  return <span className={`badge ${cls}`}><span className="ic" aria-hidden="true">{ic}</span>{s}</span>;
}

const RK: Record<RiskLevel, [string, string]> = { Low: ['▼', 'b-ok'], Medium: ['■', 'b-warn'], High: ['▲', 'b-bad'], Unclear: ['?', 'b-q'], 'Not applicable': ['—', 'b-neu'] };
export function RiskPill({ l }: { l: RiskLevel }) {
  const [ic, cls] = RK[l] || RK.Unclear;
  return <span className={`badge ${cls}`}><span className="ic" aria-hidden="true">{ic}</span>{l === 'Low' ? 'Low risk' : l}</span>;
}

export function Badge({ tone = 'neu', icon, children, title }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'neu' | 'q' | 'out'; icon?: string; children: ReactNode; title?: string }) {
  return <span className={`badge b-${tone}`} title={title}>{icon ? <span className="ic" aria-hidden="true">{icon}</span> : null}{children}</span>;
}

export const VTONE: Record<Partner['verification'], 'ok' | 'q' | 'bad'> = { Verified: 'ok', 'Needs confirmation': 'q', Unidentified: 'bad' };

export function Ref({ code, big }: { code: string | null | undefined; big?: boolean }) {
  return <span className={`ref${big ? ' big' : ''}`}>{code || '—'}</span>;
}

export function Flags({ f }: { f: LeadFlags }) {
  if (!f.amendment && !f.docsMissing && !f.uncertain) return null;
  return (
    <span className="inline" style={{ gap: 4 }}>
      {f.amendment ? <span className="flag f-amd" title="A new deadline was reported and is waiting for verification">↻ Deadline change to verify</span> : null}
      {f.docsMissing ? <span className="flag f-doc" title="Tender documents are missing or need a login">▢ Documents missing</span> : null}
      {f.uncertain ? <span className="flag f-unc" title="Eligibility or scope needs clarification">? Unclear eligibility / scope</span> : null}
    </span>
  );
}

export const TYPE_COLOR: Record<LeadType, string> = { 'Tender': 'var(--c-tender)', 'RFP / EOI': 'var(--c-rfp)', 'Grant': 'var(--c-grant)', 'CSR': 'var(--c-csr)' };

export function TypeTag({ type }: { type: LeadType }) {
  return <span className="badge b-out"><i className="t-dot" style={{ background: TYPE_COLOR[type] }} aria-hidden="true" />{type}</span>;
}

export function Due({ deadline, note }: { deadline: string | null; note?: string | null }) {
  const d = dueLabel(deadline);
  return (
    <span className="dl">
      <span className="mono">{deadline ? fmtDate(deadline) : '—'}</span>
      <span className={`due ${d.tone}`}>{d.tone === 'urgent' ? '! ' : ''}{d.text}</span>
      {note && /amend|extend|moved|corrig/i.test(note) ? <span className="flag f-amd" title={note}>↻ Amended</span> : null}
    </span>
  );
}

export function FollowUp({ date }: { date: string | null }) {
  const d = daysLeft(date);
  if (d === null) return <span className="muted">—</span>;
  return <span className="dl"><span className="mono">{fmtDate(date)}</span><span className={`due ${d < 0 ? 'urgent' : d <= 2 ? 'soon' : 'normal'}`}>{d < 0 ? `overdue ${-d} d` : d === 0 ? 'today' : `in ${d} d`}</span></span>;
}

export function Score({ value }: { value: number | null }) {
  const sc = value == null ? 'var(--neutral-mark)' : value >= 75 ? 'var(--good)' : value >= 55 ? 'var(--warning)' : value >= 35 ? 'var(--accent-mark)' : 'var(--neutral-mark)';
  return (
    <span className="score" style={{ ['--v' as string]: value ?? 0, ['--sc' as string]: sc }} title={value == null ? 'Not scored' : `Crawler fit score ${value} of 100 (a suggestion, not a decision)`}>
      <span>{value ?? '–'}</span>
    </span>
  );
}

export function Priority({ p }: { p: string | null }) {
  if (!p) return null;
  return <span className={`prio ${p.toLowerCase()}`} title="Crawler priority (suggestion)">{p}</span>;
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

export function Who({ name }: { name: string }) {
  return name ? <span className="who-inline"><Avatar name={name} />{name}</span> : <span className="muted">Unassigned</span>;
}

/** Small labelled value used in the crawler assessment grid; tone colours High/Missing/BOOT-type risks. */
export function Tag({ value, tone }: { value: string | null | undefined; tone?: 'bad' | 'warn' | 'ok' }) {
  if (!value) return <span className="muted">—</span>;
  return <span className={`tag${tone ? ' ' + tone : ''}`}>{value}</span>;
}

export function riskTone(field: string, v: string | null | undefined): 'bad' | 'warn' | 'ok' | undefined {
  if (!v) return undefined;
  if (field === 'regulatory_risk') return v === 'High' ? 'bad' : v === 'Medium' ? 'warn' : v === 'Low' ? 'ok' : undefined;
  if (field === 'business_model') return v.startsWith('BOOT') ? 'bad' : v.startsWith('Capex') ? 'warn' : v === 'Opex service' || v === 'Grant' ? 'ok' : undefined;
  if (field === 'rfp_status') return v === 'Missing' ? 'bad' : v === 'Login needed' || v === 'Requested' ? 'warn' : v === 'Available' || v === 'Received' ? 'ok' : undefined;
  if (field === 'uses_our_product') return v === 'No' ? 'bad' : v === 'Partly' ? 'warn' : v === 'Yes' ? 'ok' : undefined;
  if (field === 'eligibility') return v === 'Not eligible' ? 'bad' : v === 'Via partner' || v === 'Check' ? 'warn' : v === 'Direct' ? 'ok' : undefined;
  return undefined;
}

/** Confirmation / error banners from ?msg= and ?err= after a form posts. */
export function Notes({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
  const msg = one(sp.msg), err = one(sp.err);
  return <>
    {msg ? <div className="note ok" role="status">{msg}</div> : null}
    {err ? <div className="note err" role="alert">{err}</div> : null}
  </>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: { href: string; label: string } }) {
  return <div className="empty-state"><b>{title}</b>{children ? <span>{children}</span> : null}{action ? <Link className="btn" href={action.href}>{action.label}</Link> : null}</div>;
}

export function Denied({ children }: { children: ReactNode }) {
  return (
    <div className="denied" role="note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      <span>{children}</span>
    </div>
  );
}

export function PageHead({ eyebrow, title, children, actions, tools, crumbs }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode; tools?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="phead">
      <div>
        {crumbs ? <nav aria-label="Breadcrumb" className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{crumbs.map((c, i) => <span key={c.href}>{i ? ' / ' : ''}<Link href={c.href}>{c.label}</Link></span>)}</nav> : null}
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {children ? <p>{children}</p> : null}
      </div>
      {actions || tools ? <div className="inline">{actions}{tools}</div> : null}
    </div>
  );
}

/** Stroke icons for the navigation (inline SVG, inherit the text colour). */
export function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
    check: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
    chart: <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>,
    news: <><path d="M4 22h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" /></>,
    gear: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] || null}</svg>;
}
