import { dueLabel, fmtDate, initials } from '@/lib/format';
import type { LeadType, Verification } from '@/lib/types';

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
