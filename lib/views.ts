import { daysLeft, todayIST } from './format';
import {
  CLOSED_STAGES, DECISIONS, ELIGIBILITY_STATUSES, LEAD_TYPES, PARTNER_NEEDS, STAGES, TYPE_SLUGS, VERIFICATIONS,
  type Activity, type DeadlineRec, type Decision, type DocRequest, type EligibilityStatus, type Lead, type LeadDoc, type LeadType,
  type Member, type Requirement, type ScoreKind, type Stage, type Task, type Verification
} from './types';

export interface LeadFilter {
  type?: LeadType;
  types?: LeadType[];        // several types (e.g. tenders + RFPs)
  review?: boolean;          // being screened / considered, or not yet verified
  verification?: Verification;
  decision?: Decision;
  stage?: Stage;
  stages?: Stage[];          // several stages (e.g. "in preparation" metrics)
  eligibility?: EligibilityStatus;
  partner?: string;          // partner_need
  approval?: 'pending';
  assignee?: string;         // 'me' | 'none' | member id
  priority?: string;
  country?: string;
  minScore?: number;
  due?: '7' | '14' | '30' | 'overdue';
  flag?: 'amendment' | 'docs' | 'uncertain';
  show?: 'open' | 'all';
  q?: string;
  sort?: 'deadline' | 'fit' | 'new' | 'ref';
  page?: number;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function filterFromParams(sp: SP): LeadFilter {
  const f: LeadFilter = {};
  const type = one(sp.type);
  if (type) { const ts = type.split(',').map(t => TYPE_SLUGS[t]).filter(Boolean) as LeadType[]; if (ts.length === 1) f.type = ts[0]; else if (ts.length > 1) f.types = ts; }
  if (one(sp.review) === '1') f.review = true;
  const v = one(sp.verification); if (v && (VERIFICATIONS as string[]).includes(v)) f.verification = v as Verification;
  const dc = one(sp.decision); if (dc && (DECISIONS as string[]).includes(dc)) f.decision = dc as Decision;
  const st = one(sp.stage);
  if (st) { const list = st.split(',').filter(x => (STAGES as string[]).includes(x)) as Stage[]; if (list.length === 1) f.stage = list[0]; else if (list.length > 1) f.stages = list; }
  const el = one(sp.eligibility); if (el && (ELIGIBILITY_STATUSES as string[]).includes(el)) f.eligibility = el as EligibilityStatus;
  const pn = one(sp.partner); if (pn && (PARTNER_NEEDS as readonly string[]).includes(pn)) f.partner = pn;
  if (one(sp.approval) === 'pending') f.approval = 'pending';
  const a = one(sp.assignee); if (a) f.assignee = a;
  const p = one(sp.priority); if (p) f.priority = p;
  const c = one(sp.country); if (c) f.country = c.slice(0, 60);
  const ms = Number(one(sp.minScore)); if (Number.isFinite(ms) && ms > 0) f.minScore = Math.min(100, ms);
  const d = one(sp.due); if (d === '7' || d === '14' || d === '30' || d === 'overdue') f.due = d;
  const fl = one(sp.flag); if (fl === 'amendment' || fl === 'docs' || fl === 'uncertain') f.flag = fl;
  f.show = one(sp.show) === 'all' ? 'all' : 'open';
  const q = one(sp.q); if (q) f.q = q.slice(0, 100);
  const s = one(sp.sort); f.sort = s === 'fit' || s === 'new' || s === 'ref' ? s : 'deadline';
  const pg = Number(one(sp.page)); f.page = Number.isFinite(pg) && pg > 1 ? Math.floor(pg) : 1;
  return f;
}

/** Still worth working on: not past its deadline, not closed, not marked wrong, not a No-go. */
export function isOpen(l: Lead, ignoreVerification = false): boolean {
  const d = daysLeft(l.deadline);
  if (d !== null && d < 0 && !['Submitted', 'Clarification'].includes(l.stage)) return false;
  if ((CLOSED_STAGES as string[]).includes(l.stage)) return false;
  if (!ignoreVerification && l.decision === 'No-go') return false;
  if (!ignoreVerification && (l.verification === 'Incorrect' || l.verification === 'Duplicate')) return false;
  return true;
}
export const isOpenLead = (l: Lead) => isOpen(l);

export interface LeadFlags { amendment: boolean; docsMissing: boolean; uncertain: boolean }
export interface FlagContext { pendingAmendments: Set<number>; missingDocs: Set<number>; uncertainReqs: Set<number> }

export function flagContext(deadlines: DeadlineRec[], docs: LeadDoc[], reqs: Requirement[]): FlagContext {
  return {
    pendingAmendments: new Set(deadlines.filter(d => d.kind === 'Amendment' && !d.verified && !d.rejected).map(d => d.lead_id)),
    missingDocs: new Set(docs.filter(d => d.status === 'Missing' || d.status === 'Requested' || d.status === 'Login needed').map(d => d.lead_id)),
    uncertainReqs: new Set(reqs.filter(r => r.status === 'Needs clarification').map(r => r.lead_id))
  };
}
export function flagsOf(l: Lead, cx: FlagContext): LeadFlags {
  return {
    amendment: cx.pendingAmendments.has(l.id),
    docsMissing: cx.missingDocs.has(l.id) || l.rfp_status === 'Missing' || l.rfp_status === 'Login needed',
    uncertain: cx.uncertainReqs.has(l.id) || l.eligibility_status === 'Needs clarification'
  };
}

export function filterLeads(leads: Lead[], f: LeadFilter, meId: string, cx?: FlagContext): Lead[] {
  const q = (f.q || '').toLowerCase().trim();
  const out = leads.filter(l => {
    const statusFilter = !!f.verification || !!f.decision || !!f.stage || !!f.stages;
    if (f.show !== 'all' && f.due !== 'overdue' && !f.approval && !isOpen(l, statusFilter)) return false;
    if (f.types && !f.types.includes(l.lead_type)) return false;
    if (f.review && !(['Screening', 'Under consideration'].includes(l.stage) || l.verification === 'Unverified')) return false;
    if (f.decision && (l.decision || 'Undecided') !== f.decision) return false;
    if (f.type && l.lead_type !== f.type) return false;
    if (f.verification && l.verification !== f.verification) return false;
    if (f.stage && l.stage !== f.stage) return false;
    if (f.stages && !f.stages.includes(l.stage)) return false;
    if (f.eligibility && l.eligibility_status !== f.eligibility) return false;
    if (f.partner && l.partner_need !== f.partner) return false;
    if (f.approval === 'pending' && l.approval_status !== 'Pending') return false;
    if (f.priority && l.priority !== f.priority) return false;
    if (f.country && !(l.country || '').toLowerCase().includes(f.country.toLowerCase())) return false;
    if (f.minScore && (l.fit_score ?? -1) < f.minScore) return false;
    if (f.assignee === 'me' && l.assigned_to !== meId) return false;
    if (f.assignee === 'none' && l.assigned_to) return false;
    if (f.assignee && f.assignee !== 'me' && f.assignee !== 'none' && l.assigned_to !== f.assignee) return false;
    if (f.due === 'overdue') { if (!isOverdue(l)) return false; }
    else if (f.due) { const d = daysLeft(l.deadline); if (d === null || d < 0 || d > +f.due) return false; }
    if (f.flag && cx) { const fl = flagsOf(l, cx); if (f.flag === 'amendment' && !fl.amendment) return false; if (f.flag === 'docs' && !fl.docsMissing) return false; if (f.flag === 'uncertain' && !fl.uncertain) return false; }
    if (q && ![l.ref_code, l.title, l.funder_buyer, l.country, l.ref_no, l.source, l.category, l.why_fit].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
  const dl = (l: Lead) => { const d = daysLeft(l.deadline); return d === null ? 1e6 : d; };
  out.sort((a, b) =>
    f.sort === 'fit' ? (b.fit_score ?? -1) - (a.fit_score ?? -1) || dl(a) - dl(b)
      : f.sort === 'new' ? b.created_at.localeCompare(a.created_at)
        : f.sort === 'ref' ? String(a.ref_code).localeCompare(String(b.ref_code))
          : dl(a) - dl(b) || (b.fit_score ?? -1) - (a.fit_score ?? -1));
  return out;
}

/** Deadline passed while we were still working on it (Go or in a working stage, not yet submitted). */
export function isOverdue(l: Lead): boolean {
  const d = daysLeft(l.deadline);
  if (d === null || d >= 0) return false;
  if ((CLOSED_STAGES as string[]).includes(l.stage) || ['Submitted', 'Clarification'].includes(l.stage)) return false;
  if (l.verification === 'Incorrect' || l.verification === 'Duplicate' || l.decision === 'No-go') return false;
  return l.decision === 'Go' || ['Partnering', 'In preparation'].includes(l.stage);
}

/** Built-in saved views: name + query string (people can add their own on the Pipeline page). */
export const BUILTIN_VIEWS: { key: string; name: string; query: string; hint: string }[] = [
  { key: 'all', name: 'All open', query: '', hint: 'Every opportunity still open' },
  { key: 'mine', name: 'My work', query: 'assignee=me', hint: 'Open opportunities you own' },
  { key: 'review', name: 'Needs review', query: 'verification=Unverified', hint: 'Not yet verified' },
  { key: 'approval', name: 'Awaiting approval', query: 'approval=pending', hint: 'A Go / No-go recommendation waits for approval' },
  { key: 'soon', name: 'Deadlines in 14 days', query: 'due=14', hint: 'Closing within two weeks' },
  { key: 'fit', name: 'High fit', query: 'minScore=70&sort=fit', hint: 'Crawler fit score 70 or more' },
  { key: 'partner', name: 'Partner required', query: 'partner=Required+by+tender', hint: 'The tender itself requires a partner' },
  { key: 'prep', name: 'In preparation', query: 'stage=Partnering,In+preparation', hint: 'Being partnered or prepared' }
];

/** "TenderDetail + BidDetail (official: GeM)" -> "TenderDetail"; "Grants.gov: telemedicine" -> "Grants.gov" */
export function sourceGroup(source: string | null): string {
  const s = (source || 'Unknown').split(/ \(| \+ |:/)[0]!.trim();
  return s || 'Unknown';
}

/** Which scorecard applies: an override on the lead, else from type and category. */
export function scoreKindOf(l: Lead): ScoreKind {
  if (l.scorecard_kind) return l.scorecard_kind as ScoreKind;
  if (l.lead_type === 'Grant') return 'Grant / award';
  if (l.lead_type === 'CSR') return 'CSR';
  if (/intl|international|overseas/i.test(l.category)) return 'International tender';
  if (l.origin === 'manual' && !l.deadline && l.lead_type === 'RFP / EOI') return 'Relationship lead';
  return 'Government / PSU tender';
}

const sameDay = (iso: string) => iso.slice(0, 10);
function weekStart(iso: string): string {
  const d = new Date(sameDay(iso) + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10);
}

export function dashboard(leads: Lead[], members: Member[], tasks: Task[], deadlines: DeadlineRec[], docs: LeadDoc[], reqs: Requirement[], activity: Activity[]) {
  const open = leads.filter(l => isOpen(l));
  const live = leads.filter(l => l.verification !== 'Incorrect' && l.verification !== 'Duplicate');
  const prepStages: Stage[] = ['Partnering', 'In preparation'];
  const tendersPrep = open.filter(l => (l.lead_type === 'Tender' || l.lead_type === 'RFP / EOI') && prepStages.includes(l.stage));
  const grantsPrep = open.filter(l => (l.lead_type === 'Grant' || l.lead_type === 'CSR') && prepStages.includes(l.stage));
  const underReview = open.filter(l => ['Screening', 'Under consideration'].includes(l.stage) || l.verification === 'Unverified');
  const upcoming = open.filter(l => { const d = daysLeft(l.deadline); return d !== null && d >= 0 && d <= 14; });
  const overdue = leads.filter(isOverdue);
  const pendingApproval = leads.filter(l => l.approval_status === 'Pending');
  const today = todayIST();
  const monthStart = today.slice(0, 8) + '01';
  const submittedMonth = leads.filter(l => l.applied_on && l.applied_on >= monthStart);
  const count = (s: Stage) => live.filter(l => l.stage === s).length;

  const cx = flagContext(deadlines, docs, reqs);
  const reasons = (l: Lead): string[] => {
    const r: string[] = [];
    if (l.approval_status === 'Pending') r.push(`${l.recommended_decision} recommended — needs approval`);
    if (cx.pendingAmendments.has(l.id)) r.push('Deadline amendment to verify');
    if (l.eligibility_status === 'Needs clarification' || cx.uncertainReqs.has(l.id)) r.push('Eligibility needs clarification');
    if (!l.assigned_to && l.verification === 'Correct') r.push('No owner');
    if (isOverdue(l)) r.push('Deadline passed before submission');
    if (cx.missingDocs.has(l.id)) r.push('Tender documents missing');
    return r;
  };
  const attention = leads
    .filter(l => isOpen(l) || isOverdue(l) || l.approval_status === 'Pending')
    .map(l => ({ lead: l, why: reasons(l), d: daysLeft(l.deadline) }))
    .filter(x => x.why.length)
    .sort((a, b) => (b.lead.approval_status === 'Pending' ? 1 : 0) - (a.lead.approval_status === 'Pending' ? 1 : 0) || (a.d ?? 999) - (b.d ?? 999))
    .slice(0, 8);

  const openTasks = tasks.filter(t => t.status === 'Open' || t.status === 'In progress');
  const workload = members.map(m => {
    const mine = open.filter(l => l.assigned_to === m.id);
    const myTasks = openTasks.filter(t => t.assignee === m.id && !t.personal);
    return {
      member: m,
      open: mine.length,
      tasks: myTasks.length,
      dueSoon: mine.filter(l => { const d = daysLeft(l.deadline); return d !== null && d >= 0 && d <= 7; }).length + myTasks.filter(t => { const d = daysLeft(t.due_on); return d !== null && d >= 0 && d <= 3; }).length,
      overdue: myTasks.filter(t => (daysLeft(t.due_on) ?? 0) < 0).length + mine.filter(isOverdue).length
    };
  }).sort((a, b) => (b.open + b.tasks) - (a.open + a.tasks));

  // weekly applications / proposals (applied_on) for the last 8 weeks
  const weeks: { week: string; count: number }[] = [];
  const ws0 = weekStart(today);
  for (let i = 7; i >= 0; i--) weeks.push({ week: new Date(Date.parse(ws0 + 'T00:00:00Z') - i * 7 * 864e5).toISOString().slice(0, 10), count: 0 });
  for (const l of leads) if (l.applied_on) { const w = weekStart(l.applied_on); const row = weeks.find(x => x.week === w); if (row) row.count++; }

  const funnel = [
    { label: 'Discovered', n: live.length, href: '/leads?show=all' },
    { label: 'Verified correct', n: live.filter(l => l.verification === 'Correct').length, href: '/leads?verification=Correct&show=all' },
    { label: 'Eligible (incl. with partner)', n: live.filter(l => l.eligibility_status === 'Meets directly' || l.eligibility_status === 'Potentially eligible with partner').length, href: '/leads?eligibility=Meets+directly&show=all' },
    { label: 'Go', n: live.filter(l => l.decision === 'Go').length, href: '/leads?decision=Go&show=all' },
    { label: 'Submitted', n: live.filter(l => ['Submitted', 'Clarification', 'Won', 'Lost'].includes(l.stage)).length, href: '/leads?stage=Submitted,Clarification,Won,Lost&show=all' },
    { label: 'Won', n: count('Won'), href: '/leads?stage=Won&show=all' }
  ];

  return {
    kpi: {
      active: open.length, tendersPrep: tendersPrep.length, grantsPrep: grantsPrep.length, underReview: underReview.length,
      upcoming: upcoming.length, overdue: overdue.length, pendingApproval: pendingApproval.length,
      submitted: count('Submitted') + count('Clarification'), submittedMonth: submittedMonth.length, won: count('Won'), lost: count('Lost'),
      unverified: open.filter(l => l.verification === 'Unverified').length
    },
    attention, workload, weeks, funnel,
    recent: activity.filter(a => a.action !== 'comment' || true).slice(0, 12)
  };
}

export type QueueKind = 'unverified' | 'duplicates' | 'documents' | 'eligibility' | 'amendments' | 'decisions';
export interface QueueItem { kind: QueueKind; lead: Lead; detail: string; since: string; owner: string | null; href: string; amendmentId?: number }

export const QUEUE_LABEL: Record<QueueKind, string> = {
  unverified: 'Unverified leads', duplicates: 'Possible duplicates', documents: 'Missing documents',
  eligibility: 'Uncertain eligibility', amendments: 'Deadline amendments', decisions: 'Pending decisions'
};

/** Everything that needs a person: built from the same records the opportunity page shows. */
export function reviewQueue(leads: Lead[], deadlines: DeadlineRec[], docs: LeadDoc[], requests: DocRequest[], reqs: Requirement[]): QueueItem[] {
  const byId = new Map(leads.map(l => [l.id, l]));
  const items: QueueItem[] = [];
  const live = (l: Lead) => isOpen(l, true) && l.verification !== 'Incorrect' && l.verification !== 'Duplicate';
  for (const l of leads) if (l.verification === 'Unverified' && isOpen(l)) items.push({ kind: 'unverified', lead: l, detail: `Found ${l.origin === 'crawler' ? 'by the crawler' : 'by hand'} · ${l.source || 'unknown source'}`, since: l.created_at, owner: l.assigned_to, href: `/leads/${l.id}` });
  // possible duplicates: same normalised title among live leads, or same buyer + reference
  const key = (l: Lead) => l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
  const groups = new Map<string, Lead[]>();
  for (const l of leads.filter(x => x.verification === 'Unverified' || x.verification === 'Correct')) { const k = key(l); if (k.length >= 20) groups.set(k, [...(groups.get(k) || []), l]); }
  for (const g of groups.values()) if (g.length > 1) for (const l of g.slice(1)) if (l.verification === 'Unverified' && !l.duplicate_of) items.push({ kind: 'duplicates', lead: l, detail: `Same title as ${g[0]!.ref_code} — merge or keep both`, since: l.created_at, owner: l.assigned_to, href: `/intake?dup=${l.id}` });
  const docLeads = new Map<number, string[]>();
  for (const d of docs) if ((d.status === 'Missing' || d.status === 'Login needed') && byId.has(d.lead_id)) docLeads.set(d.lead_id, [...(docLeads.get(d.lead_id) || []), d.name]);
  for (const l of leads) if ((l.rfp_status === 'Missing' || l.rfp_status === 'Login needed') && !docLeads.has(l.id) && l.verification === 'Correct') docLeads.set(l.id, [`RFP documents (${l.rfp_status.toLowerCase()})`]);
  for (const [lid, names] of docLeads) { const l = byId.get(lid)!; if (!live(l)) continue; const draft = requests.find(r => r.lead_id === lid && r.status === 'Draft'); items.push({ kind: 'documents', lead: l, detail: names.join(', ') + (draft ? ' · request drafted, not sent' : ''), since: l.updated_at, owner: l.assigned_to, href: `/leads/${lid}?tab=documents` }); }
  const unclear = new Map<number, Requirement[]>();
  for (const r of reqs) if (r.status === 'Needs clarification') unclear.set(r.lead_id, [...(unclear.get(r.lead_id) || []), r]);
  for (const l of leads) {
    if (!live(l)) continue;
    const rs = unclear.get(l.id);
    if (l.eligibility_status === 'Needs clarification' || rs?.length) items.push({ kind: 'eligibility', lead: l, detail: rs?.length ? `${rs.length} requirement${rs.length > 1 ? 's' : ''} need clarification: ${rs.map(r => r.requirement).slice(0, 2).join('; ')}` : (l.eligibility_summary || 'Marked needs clarification'), since: l.eligibility_at || l.updated_at, owner: l.assigned_to, href: `/leads/${l.id}?tab=eligibility` });
    else if (l.verification === 'Correct' && l.eligibility_status === 'Not assessed' && ['Screening', 'Under consideration'].includes(l.stage)) items.push({ kind: 'eligibility', lead: l, detail: 'Correct lead, eligibility not assessed yet', since: l.verified_at || l.updated_at, owner: l.assigned_to, href: `/leads/${l.id}?tab=eligibility` });
  }
  for (const d of deadlines) if (d.kind === 'Amendment' && !d.verified && !d.rejected) { const l = byId.get(d.lead_id); if (l) items.push({ kind: 'amendments', lead: l, detail: `${d.previous || 'no date'} → ${d.deadline} · ${d.source || 'source not given'}`, since: d.created_at, owner: l.assigned_to, href: `/leads/${l.id}?tab=source`, amendmentId: d.id }); }
  for (const l of leads) if (l.approval_status === 'Pending') items.push({ kind: 'decisions', lead: l, detail: `${l.recommended_decision} recommended: ${l.recommendation_reason || ''}`, since: l.recommended_at || l.updated_at, owner: l.recommended_by, href: `/leads/${l.id}?tab=decision` });
  return items;
}

export function overview(leads: Lead[]) {
  const reviewed = leads.filter(l => l.verification !== 'Unverified');
  const correct = reviewed.filter(l => l.verification === 'Correct').length;
  const groups = new Map<string, Lead[]>();
  for (const l of leads) { const g = sourceGroup(l.source); groups.set(g, [...(groups.get(g) || []), l]); }
  const bySource = [...groups.entries()].map(([source, rows]) => {
    const rev = rows.filter(l => l.verification !== 'Unverified');
    const ok = rev.filter(l => l.verification === 'Correct').length;
    return { source, total: rows.length, reviewed: rev.length, correct: ok, wrong: rev.length - ok, accuracy: rev.length ? ok / rev.length : null };
  }).sort((a, b) => b.reviewed - a.reviewed || b.total - a.total);
  const noGoReasons = leads.filter(l => l.decision === 'No-go' && l.decision_reason)
    .sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
  const byType = LEAD_TYPES.map(t => ({ type: t, total: leads.filter(l => l.lead_type === t).length, open: leads.filter(l => l.lead_type === t && isOpen(l)).length }));
  return { reviewed: reviewed.length, correct, accuracy: reviewed.length ? correct / reviewed.length : null, bySource, noGoReasons, byType };
}

export { weekStart };
