import { daysLeft } from './format';
import { CLOSED_STAGES, LEAD_TYPES, STAGES, TYPE_SLUGS, VERIFICATIONS, type Lead, type LeadType, type Member, type Stage, type Verification } from './types';

export interface LeadFilter {
  type?: LeadType;
  verification?: Verification;
  stage?: Stage;
  assignee?: string; // 'me' | 'none' | member id
  priority?: string;
  due?: '7' | '14' | '30';
  show?: 'open' | 'all';
  q?: string;
  sort?: 'deadline' | 'fit' | 'new';
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function filterFromParams(sp: SP): LeadFilter {
  const f: LeadFilter = {};
  const type = one(sp.type); if (type && TYPE_SLUGS[type]) f.type = TYPE_SLUGS[type];
  const v = one(sp.verification); if (v && (VERIFICATIONS as string[]).includes(v)) f.verification = v as Verification;
  const st = one(sp.stage); if (st && (STAGES as string[]).includes(st)) f.stage = st as Stage;
  const a = one(sp.assignee); if (a) f.assignee = a;
  const p = one(sp.priority); if (p) f.priority = p;
  const d = one(sp.due); if (d === '7' || d === '14' || d === '30') f.due = d;
  f.show = one(sp.show) === 'all' ? 'all' : 'open';
  const q = one(sp.q); if (q) f.q = q.slice(0, 100);
  const s = one(sp.sort); f.sort = s === 'fit' || s === 'new' ? s : 'deadline';
  return f;
}

/** Still worth working on: not past its deadline, not closed, not marked wrong. */
export function isOpen(l: Lead, ignoreVerification = false): boolean {
  const d = daysLeft(l.deadline);
  if (d !== null && d < 0) return false;
  if ((CLOSED_STAGES as string[]).includes(l.stage)) return false;
  if (!ignoreVerification && (l.verification === 'Incorrect' || l.verification === 'Duplicate')) return false;
  return true;
}

export function filterLeads(leads: Lead[], f: LeadFilter, meId: string): Lead[] {
  const q = (f.q || '').toLowerCase().trim();
  const out = leads.filter(l => {
    if (f.show !== 'all' && !isOpen(l, !!f.verification)) return false;
    if (f.type && l.lead_type !== f.type) return false;
    if (f.verification && l.verification !== f.verification) return false;
    if (f.stage && l.stage !== f.stage) return false;
    if (f.priority && l.priority !== f.priority) return false;
    if (f.assignee === 'me' && l.assigned_to !== meId) return false;
    if (f.assignee === 'none' && l.assigned_to) return false;
    if (f.assignee && f.assignee !== 'me' && f.assignee !== 'none' && l.assigned_to !== f.assignee) return false;
    if (f.due) { const d = daysLeft(l.deadline); if (d === null || d < 0 || d > +f.due) return false; }
    if (q && ![l.title, l.funder_buyer, l.country, l.ref_no, l.source, l.category, l.why_fit].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  const dl = (l: Lead) => { const d = daysLeft(l.deadline); return d === null ? 1e6 : d; };
  out.sort((a, b) =>
    f.sort === 'fit' ? (b.fit_score ?? -1) - (a.fit_score ?? -1) || dl(a) - dl(b)
      : f.sort === 'new' ? b.created_at.localeCompare(a.created_at)
        : dl(a) - dl(b) || (b.fit_score ?? -1) - (a.fit_score ?? -1));
  return out;
}

/** "TenderDetail + BidDetail (official: GeM)" -> "TenderDetail"; "Grants.gov: telemedicine" -> "Grants.gov" */
export function sourceGroup(source: string | null): string {
  const s = (source || 'Unknown').split(/ \(| \+ |:/)[0]!.trim();
  return s || 'Unknown';
}

export function overview(leads: Lead[], members: Member[]) {
  const open = leads.filter(l => isOpen(l));
  const reviewed = leads.filter(l => l.verification !== 'Unverified');
  const correct = reviewed.filter(l => l.verification === 'Correct').length;

  const byType = LEAD_TYPES.map(t => {
    const rows = leads.filter(l => l.lead_type === t && isOpen(l, true));
    const counts = Object.fromEntries(VERIFICATIONS.map(v => [v, rows.filter(l => l.verification === v).length])) as Record<Verification, number>;
    return { type: t, total: rows.length, open: rows.filter(l => isOpen(l)).length, counts };
  });

  const pipeline = STAGES.map(s => ({ stage: s, count: leads.filter(l => l.stage === s && l.verification !== 'Incorrect' && l.verification !== 'Duplicate').length }));

  const groups = new Map<string, Lead[]>();
  for (const l of leads) { const g = sourceGroup(l.source); groups.set(g, [...(groups.get(g) || []), l]); }
  const bySource = [...groups.entries()].map(([source, rows]) => {
    const rev = rows.filter(l => l.verification !== 'Unverified');
    const ok = rev.filter(l => l.verification === 'Correct').length;
    return { source, total: rows.length, reviewed: rev.length, correct: ok, wrong: rev.length - ok, accuracy: rev.length ? ok / rev.length : null };
  }).sort((a, b) => b.reviewed - a.reviewed || b.total - a.total);

  const closingSoon = open.filter(l => { const d = daysLeft(l.deadline); return d !== null && d <= 14; })
    .sort((a, b) => (daysLeft(a.deadline)! - daysLeft(b.deadline)!) || (b.fit_score ?? 0) - (a.fit_score ?? 0));

  const workload = members.map(m => {
    const mine = open.filter(l => l.assigned_to === m.id);
    return {
      member: m,
      open: mine.length,
      dueSoon: mine.filter(l => { const d = daysLeft(l.deadline); return d !== null && d <= 7; }).length,
      unchecked: mine.filter(l => l.verification === 'Unverified').length,
      checkedByThem: leads.filter(l => l.verified_by === m.id).length
    };
  }).sort((a, b) => b.open - a.open);

  return {
    kpi: {
      open: open.length,
      needsCheck: open.filter(l => l.verification === 'Unverified').length,
      unassigned: open.filter(l => !l.assigned_to).length,
      due7: open.filter(l => { const d = daysLeft(l.deadline); return d !== null && d <= 7; }).length,
      reviewed: reviewed.length,
      correct,
      accuracy: reviewed.length ? correct / reviewed.length : null
    },
    byType, pipeline, bySource, closingSoon, workload,
    unassignedOpen: open.filter(l => !l.assigned_to).length
  };
}
