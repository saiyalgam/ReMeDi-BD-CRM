// What each screen exports. Every dataset is read as the signed-in person, so row-level security and the same
// masking as the screens apply: nothing a role cannot see on screen can leave in a file.
import { getLead, getSession, listActivity, listLeads, listMembers, requirePerm } from './data';
import { demo, nextSeq, saveDemo } from './demo';
import { supabaseServer } from './supabase/server';
import {
  listCriteria, listDeadlines, listDocRequests, listDocs, listKb, listLeadPartners, listPartners, listRequirements, listRisks, listScores, listTasks
} from './data-ext';
import { daysLeft, nameOf, todayIST } from './format';
import { can } from './perm';
import { filterFromParams, filterLeads, flagContext, flagsOf, isOpen, overview, QUEUE_LABEL, reviewQueue, weekStart } from './views';
import { STAGES, TYPE_SLUGS, type Lead, type Member } from './types';
import type { Cell, SheetData } from './xlsx-write';

export const EXPORT_KINDS = ['pipeline', 'review', 'tasks', 'partners', 'knowledge', 'activity', 'reports', 'opportunity'] as const;
export type ExportKind = typeof EXPORT_KINDS[number];
type SP = Record<string, string | undefined>;

const hidden = (v: string | null | undefined) => (v === '__hidden__' ? 'Hidden for your role' : v ?? '');
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
const leadLink = (id: number) => `${site()}/leads/${id}`;
const days = (iso: string | null) => { const d = daysLeft(iso); return d === null ? '' : d; };
const who = (members: Member[], id: string | null | undefined) => (id ? nameOf(members, id) : '');

export interface ExportResult { title: string; sheets: SheetData[]; rowCount: number }

export async function buildExport(kind: ExportKind, sp: SP, id?: number): Promise<ExportResult> {
  const s = await requirePerm('opp.export', 'export');
  const members = await listMembers();
  switch (kind) {
    case 'pipeline': {
      const [leads, deadlines, docs, reqs] = await Promise.all([listLeads(), listDeadlines(), listDocs(), listRequirements()]);
      const cx = flagContext(deadlines, docs, reqs);
      const rows = filterLeads(leads, { ...filterFromParams(sp), page: 1 }, s.user.id, cx);
      const sheet: SheetData = {
        name: 'Pipeline',
        columns: ['Ref. no.', 'Title', 'Buyer / funder', 'Country / state', 'Type', 'Category', 'Source', 'Origin', 'Value (as stated)', 'Value band', 'Crawler fit score',
          'Deadline', 'Days left', 'Deadline note', 'Verification', 'Verification note', 'Eligibility', 'Eligibility summary', 'Partner need',
          'Go / No-go', 'Decision reason', 'Approval', 'Recommended', 'Stage', 'Owner', 'Applied on', 'Next follow-up', 'Flags', 'Found on', 'Notice link', 'CRM link'],
        rows: rows.map(l => {
          const f = flagsOf(l, cx);
          return [l.ref_code, l.title, l.funder_buyer, l.country, l.lead_type, l.category, l.source, l.origin, l.amount, l.value_band, l.fit_score,
            l.deadline, days(l.deadline), l.deadline_note, l.verification, l.verification_note, l.eligibility_status, l.eligibility_summary, l.partner_need,
            l.decision, l.decision_reason, l.approval_status, l.recommended_decision, l.stage, who(members, l.assigned_to), l.applied_on, l.next_followup,
            [f.amendment && 'Deadline change to verify', f.docsMissing && 'Documents missing', f.uncertain && 'Unclear eligibility / scope'].filter(Boolean).join('; '),
            l.found_on, l.url, leadLink(l.id)];
        })
      };
      return { title: 'Pipeline', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'review': {
      const [leads, deadlines, docs, requests, reqs] = await Promise.all([listLeads(), listDeadlines(), listDocs(), listDocRequests(), listRequirements()]);
      const items = reviewQueue(leads, deadlines, docs, requests, reqs).filter(i => !sp.tab || i.kind === sp.tab);
      const sheet: SheetData = {
        name: 'Review queue', columns: ['Review', 'Ref. no.', 'Opportunity', 'Detail', 'Owner', 'In queue since', 'Deadline', 'Days left', 'CRM link'],
        rows: items.map(i => [QUEUE_LABEL[i.kind], i.lead.ref_code, i.lead.title, i.detail, who(members, i.owner), i.since.slice(0, 10), i.lead.deadline, days(i.lead.deadline), site() + i.href])
      };
      return { title: 'Review queue', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'tasks': {
      const [tasks, leads] = await Promise.all([listTasks(), listLeads()]);
      const byId = new Map(leads.map(l => [l.id, l]));
      const active = (st: string) => st === 'Open' || st === 'In progress';
      const view = sp.view || 'all';
      const rows = tasks.filter(t => (view === 'mine' ? t.assignee === s.user.id && active(t.status) : view === 'available' ? !t.assignee && !t.personal && active(t.status)
        : view === 'overdue' ? active(t.status) && (daysLeft(t.due_on) ?? 1) < 0 : view === 'done' ? t.status === 'Done' : true) && (!sp.person || t.assignee === sp.person));
      const sheet: SheetData = {
        name: 'Tasks', columns: ['Task', 'Details', 'Ref. no.', 'Opportunity', 'Owner', 'Status', 'Due', 'Days to due', 'Personal', 'Completion note', 'Completed', 'Created by', 'Created'],
        rows: rows.map(t => { const l = t.lead_id ? byId.get(t.lead_id) : undefined; return [t.title, t.detail, l?.ref_code, l?.title, t.assignee ? who(members, t.assignee) : 'Available', t.status, t.due_on, days(t.due_on), t.personal ? 'Yes' : '', t.done_note, t.done_at?.slice(0, 10), who(members, t.created_by), t.created_at.slice(0, 10)]; })
      };
      return { title: 'Tasks', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'partners': {
      if (!can(s, 'partners.read')) throw new Error('Your role cannot see the partner directory.');
      const [partners, links, leads] = await Promise.all([listPartners(), listLeadPartners(), listLeads()]);
      const byLead = new Map(leads.map(l => [l.id, l]));
      const sens = can(s, 'partners.read_sensitive');
      const sheet: SheetData = {
        name: 'Partners',
        columns: ['Name', 'Also known as', 'Kind', 'Verification', 'Relationship', 'Category', 'Capabilities', 'Geography', 'Health domains', 'Relationship owner', 'Prior collaboration', 'Source / how verified', 'Linked opportunities',
          ...(sens ? ['Contact', 'Email', 'Phone', 'Due diligence', 'Restrictions'] : [])],
        rows: partners.map(p => [p.name, p.aliases, p.kind, p.verification, p.relationship, p.category, p.capabilities, p.geography, p.health_domains, who(members, p.owner), p.prior_collaboration, p.source_note,
          links.filter(x => x.partner_id === p.id).map(x => `${byLead.get(x.lead_id)?.ref_code || ''} (${x.need}: ${x.gap_note || ''})`).join('; '),
          ...(sens ? [hidden(p.contact_name), hidden(p.contact_email), hidden(p.contact_phone), hidden(p.due_diligence), hidden(p.restrictions)] : [])] as Cell[]),
        note: sens ? undefined : 'Contacts, due diligence and restrictions are not included for your role.'
      };
      return { title: 'Partners', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'knowledge': {
      const [{ docs }, reqs] = await Promise.all([listKb(), listRequirements()]);
      const sheet: SheetData = {
        name: 'Knowledge base', columns: ['Name', 'Entity', 'Type', 'Owner', 'Version', 'Document date', 'Expires', 'Expiry status', 'Approval', 'Confidentiality', 'Tags', 'Location', 'Summary', 'Used in clauses'],
        rows: docs.map(d => { const x = daysLeft(d.expires_on); return [d.name, d.entity, d.doc_type, who(members, d.owner), d.version, d.doc_date, d.expires_on, x === null ? '' : x < 0 ? 'Expired' : x <= 30 ? 'Expires within 30 days' : 'Valid', d.approval, d.confidentiality, d.tags, d.location, d.summary, reqs.filter(r => r.evidence_doc === d.id).length]; })
      };
      return { title: 'Knowledge base', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'activity': {
      const [activity, leads] = await Promise.all([listActivity(5000), listLeads()]);
      const byId = new Map(leads.map(l => [l.id, l]));
      const since = new Date(Date.now() - (Number(sp.days) || 7) * 864e5).toISOString();
      const type = sp.type ? TYPE_SLUGS[sp.type] : undefined;
      const roleIds = new Set(members.filter(m => !sp.role || m.org_role === sp.role).map(m => m.id));
      const rows = activity.filter(a => a.created_at >= since && (!sp.person || a.actor === sp.person) && (!sp.role || (a.actor && roleIds.has(a.actor)))
        && (!type || byId.get(a.lead_id)?.lead_type === type) && (!sp.lead || a.lead_id === Number(sp.lead)));
      const sheet: SheetData = {
        name: 'Team activity', columns: ['When (UTC)', 'Who', 'Role', 'Action', 'Ref. no.', 'Opportunity', 'Detail'],
        rows: rows.map(a => { const m = members.find(x => x.id === a.actor); const l = byId.get(a.lead_id); return [a.created_at.replace('T', ' ').slice(0, 16), a.actor ? who(members, a.actor) : 'Crawler / import', m?.org_role, a.action, l?.ref_code, l?.title, a.detail]; })
      };
      return { title: 'Team activity', sheets: [sheet], rowCount: sheet.rows.length };
    }
    case 'reports': {
      if (!can(s, 'reports.read')) throw new Error('Your role cannot see reports.');
      const [leads, tasks] = await Promise.all([listLeads(), listTasks()]);
      const live = leads.filter(l => l.verification !== 'Incorrect' && l.verification !== 'Duplicate');
      const o = overview(leads);
      const ws0 = weekStart(todayIST());
      const weeks = Array.from({ length: 26 }, (_, i) => new Date(Date.parse(ws0 + 'T00:00:00Z') - (25 - i) * 7 * 864e5).toISOString().slice(0, 10));
      const sheets: SheetData[] = [
        { name: 'Stages', columns: ['Stage', 'Opportunities'], rows: STAGES.map(st => [st, live.filter(l => l.stage === st).length]) },
        { name: 'By type', columns: ['Type', 'Open now', 'All time'], rows: o.byType.map(t => [t.type, t.open, t.total]) },
        { name: 'Weekly', columns: ['Week starting', 'Found', 'Applied'], rows: weeks.map(w => [w, leads.filter(l => weekStart(l.created_at) === w).length, leads.filter(l => l.applied_on && weekStart(l.applied_on) === w).length]) },
        { name: 'Workload', columns: ['Person', 'Role', 'Open opportunities', 'Open shared tasks', 'Overdue tasks', 'Applications (all time)'], rows: members.map(m => [m.full_name || m.email, m.org_role, leads.filter(l => l.assigned_to === m.id && isOpen(l)).length, tasks.filter(t => t.assignee === m.id && !t.personal && (t.status === 'Open' || t.status === 'In progress')).length, tasks.filter(t => t.assignee === m.id && !t.personal && (t.status === 'Open' || t.status === 'In progress') && (daysLeft(t.due_on) ?? 1) < 0).length, leads.filter(l => l.assigned_to === m.id && l.applied_on).length]) },
        { name: 'No-go reasons', columns: ['Ref. no.', 'Opportunity', 'Decided', 'Reason'], rows: o.noGoReasons.map(l => [l.ref_code, l.title, l.decided_at?.slice(0, 10), l.decision_reason]) },
        { name: 'Crawler sources', columns: ['Source', 'Found', 'Checked', 'Correct', 'Wrong / duplicate', 'Accuracy %'], rows: o.bySource.map(x => [x.source, x.total, x.reviewed, x.correct, x.wrong, x.accuracy == null ? '' : Math.round(x.accuracy * 100)]) }
      ];
      return { title: 'Reports', sheets, rowCount: sheets.reduce((a, x) => a + x.rows.length, 0) };
    }
    case 'opportunity': {
      const res = id ? await getLead(id) : null;
      if (!res) throw new Error('Opportunity not found.');
      const l: Lead = res.lead;
      const [reqs, risks, scores, criteria, deadlines, docs, requests, links, partners, tasks] = await Promise.all([
        listRequirements(l.id), listRisks(l.id), listScores(l.id), listCriteria(), listDeadlines(l.id), listDocs(l.id), listDocRequests(l.id), listLeadPartners(), listPartners(), listTasks()
      ]);
      const kv: [string, Cell][] = [
        ['Ref. no.', l.ref_code], ['Title', l.title], ['Buyer / funder', l.funder_buyer], ['Country / state', l.country], ['Type', l.lead_type], ['Category', l.category],
        ['Buyer reference', l.ref_no], ['Value (as stated)', l.amount], ['Value band', l.value_band], ['Deadline', l.deadline], ['Days left', days(l.deadline)], ['Deadline note', l.deadline_note],
        ['Verification', l.verification], ['Verification note', l.verification_note], ['Eligibility', l.eligibility_status], ['Eligibility summary', l.eligibility_summary],
        ['Partner need (tender)', l.partner_need], ['Go / No-go', l.decision], ['Decision reason', l.decision_reason], ['Decided by', who(members, l.decided_by)], ['Decided', l.decided_at?.slice(0, 10)],
        ['Approval', l.approval_status], ['Recommended', l.recommended_decision], ['Recommendation reason', l.recommendation_reason], ['Stage', l.stage], ['Owner', who(members, l.assigned_to)],
        ['Applied on', l.applied_on], ['Next follow-up', l.next_followup], ['Crawler fit score', l.fit_score], ['Crawler eligibility guess (unreviewed)', l.eligibility],
        ['Source', l.source], ['Notice link', l.url], ['CRM link', leadLink(l.id)], ['Exported', `${todayIST()} by ${s.user.full_name || s.user.email}`]
      ];
      const pName = (pid: number) => partners.find(p => p.id === pid)?.name || '';
      const sheets: SheetData[] = [
        { name: 'Summary', columns: ['Field', 'Value'], rows: kv },
        { name: 'Eligibility', columns: ['Requirement', 'Necessity', 'Tender wording', 'Source document', 'Page / clause', 'Evidence', 'Status', 'Confidence', 'Open question', 'Partner need', 'Gap type', 'Reviewer', 'Note'],
          rows: reqs.map(r => [r.requirement, r.necessity, r.excerpt, r.source_doc, r.source_ref, r.evidence, r.status, r.confidence, r.question, r.partner_need, r.gap_type, who(members, r.reviewer), r.note]) },
        { name: 'Risks', columns: ['Factor', 'Level', 'Note', 'Source'], rows: risks.map(r => [r.factor, r.level, r.note, r.source]) },
        { name: 'Scorecard', columns: ['Criterion', 'Weight', 'Score (0-5)', 'Rationale', 'Evidence'], rows: scores.map(x => { const c = criteria.find(k => k.id === x.criterion_id); return [c?.criterion, c?.weight, x.score, x.rationale, x.evidence]; }) },
        { name: 'Deadlines', columns: ['Kind', 'Date', 'Previous', 'Source', 'Status', 'Verified by', 'Recorded'], rows: deadlines.map(d => [d.kind, d.deadline, d.previous, d.source, d.rejected ? 'Rejected' : d.verified ? 'Verified' : 'Awaiting verification', who(members, d.verified_by), d.created_at.slice(0, 10)]) },
        { name: 'Documents', columns: ['Document', 'Kind', 'Version', 'Status', 'Review', 'Issued', 'Valid until', 'Link', 'Note'], rows: docs.map(d => [d.name, d.kind, d.version, d.status, d.review_status, d.issued_on, d.expires_on, d.url, d.note]) },
        { name: 'Document requests', columns: ['Document', 'To', 'Subject', 'Status', 'Remind on'], rows: requests.map(r => [r.document, r.to_name || r.to_email, r.subject, r.status, r.remind_on]) },
        { name: 'Partners', columns: ['Partner', 'Need', 'Gap type', 'Gap it covers', 'Evidence', 'Status'], rows: links.filter(x => x.lead_id === l.id).map(x => [pName(x.partner_id), x.need, x.gap_type, x.gap_note, x.evidence, x.status]) },
        { name: 'Tasks', columns: ['Task', 'Owner', 'Status', 'Due', 'Completion note'], rows: tasks.filter(t => t.lead_id === l.id && !t.personal).map(t => [t.title, t.assignee ? who(members, t.assignee) : 'Available', t.status, t.due_on, t.done_note]) },
        { name: 'History', columns: ['When (UTC)', 'Who', 'Action', 'Detail'], rows: res.activity.map(a => [a.created_at.replace('T', ' ').slice(0, 16), a.actor ? who(members, a.actor) : 'Crawler / import', a.action, a.detail]) }
      ];
      return { title: `${l.ref_code} ${l.title}`.slice(0, 80), sheets, rowCount: reqs.length + risks.length + deadlines.length + docs.length };
    }
  }
}

export async function exportFileBase(kind: ExportKind, title: string): Promise<string> {
  const s = await getSession();
  void s;
  const slug = (kind === 'opportunity' ? title.split(' ')[0] : kind).replace(/[^A-Za-z0-9-]+/g, '-');
  return `ReMeDi-CRM_${slug}_${todayIST()}`;
}

/** Records who exported what (kind, filters, row count). Demo: in-memory audit list. Real: audit_log, allowed by RLS
 *  only for the caller's own export rows. Logging failure never blocks the download but is reported on the server. */
export async function logExport(kind: ExportKind, detail: string, rowCount: number): Promise<void> {
  const s = await getSession();
  if (!s) return;
  const changed = [kind, detail.slice(0, 300), `rows=${rowCount}`];
  if (s.demo) {
    const st = demo();
    st.audit.unshift({ id: nextSeq(st), table_name: 'export', row_id: kind, op: 'EXPORT', actor: s.user.id, changed, created_at: new Date().toISOString() });
    saveDemo(st);
    return;
  }
  const sb = await supabaseServer();
  const { error } = await sb.from('audit_log').insert({ table_name: 'export', row_id: kind, op: 'EXPORT', actor: s.user.id, changed });
  if (error) console.error('export log failed', error.message);
}
