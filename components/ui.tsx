import { dueLabel, fmtDate, initials } from '@/lib/format';
import type { Decision, LeadType, Verification } from '@/lib/types';

const V_ICON: Record<Verification, string> = { Correct: '✓', Incorrect: '✕', Duplicate: '⧉', Unverified: '?' };
const V_LABEL: Record<Verification, string> = { Correct: 'Correct', Incorrect: 'Wrong lead', Duplicate: 'Duplicate', Unverified: 'Not checked' };

export function VerificationPill({ v }: { v: Verification }) {
  return <span className={`pill v-${v.toLowerCase()}`}><span className="ic" aria-hidden="true">{V_ICON[v]}</span>{V_LABEL[v]}</span>;
}

export const TYPE_COLOR: Record<LeadType, string> = { 'Tender': 'var(--c-tender)', 'RFP / EOI': 'var(--c-rfp)', 'Grant': 'var(--c-grant)', 'CSR': 'var(--c-csr)' };

export function TypeTag({ type }: { type: LeadType }) {
  return <span className="pill"><i className="t-dot" style={{ background: TYPE_COLOR[type] }} aria-hidden="true" />{type}</span>;
}

export function Due({ deadline }: { deadline: string | null }) {
  const d = dueLabel(deadline);
  return (
    <span className="dl">
      <span className="mono">{deadline ? fmtDate(deadline) : '—'}</span>
      <span className={`due ${d.tone}`}>{d.text}</span>
    </span>
  );
}

export function Score({ value }: { value: number | null }) {
  const sc = value == null ? 'var(--neutral-mark)' : value >= 75 ? 'var(--good)' : value >= 55 ? 'var(--warning)' : value >= 35 ? 'var(--accent-mark)' : 'var(--neutral-mark)';
  return (
    <span className="score" style={{ ['--v' as string]: value ?? 0, ['--sc' as string]: sc }} title={value == null ? 'Not scored' : `Fit score ${value} of 100`}>
      <span>{value ?? '–'}</span>
    </span>
  );
}

export function Priority({ p }: { p: string | null }) {
  if (!p) return null;
  return <span className={`prio ${p.toLowerCase()}`}>{p}</span>;
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

export function Who({ name }: { name: string }) {
  return name ? <span className="who-inline"><Avatar name={name} />{name}</span> : <span className="muted">Unassigned</span>;
}

export function DecisionPill({ d }: { d: Decision | null | undefined }) {
  if (!d || d === 'Undecided') return null;
  return <span className={`pill d-${d === 'Go' ? 'go' : 'nogo'}`}><span className="ic" aria-hidden="true">{d === 'Go' ? '▶' : '■'}</span>{d}</span>;
}

/** Small labelled value used in the assessment grid; tone colours High/Missing/BOOT-type risks. */
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
