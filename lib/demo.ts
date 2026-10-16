// In-memory sample data for DEMO_MODE=1 (local preview only). Lead rows come from the real crawler rounds in
// demo-data.json; everything else marked [Sample] is fictional and exists only so every screen has something to show.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import raw from './demo-data.json';
import { normalizeIngestRow } from './leadtype';
import { todayIST } from './format';
import { LEAD_DEFAULTS } from './defaults';
import { defaultRolePerms } from './perm';
import { LEGACY_STAGE } from './types';
import type {
  AccessRule, Activity, AuditEntry, Criterion, DeadlineRec, DocRequest, IngestRun, IntegrationEvent, KbDoc, Lead, LeadDoc, LeadPartner,
  Member, NewsFeed, NewsItem, Partner, RelNote, Relationship, Requirement, Risk, RolePerm, SavedView, Score, Task,
  DriveFile, DriveFolder, IntegrationSettings, KbClaim, KbEvidence
} from './types';

export interface DemoStore {
  members: Member[]; leads: Lead[]; activity: Activity[]; news: NewsItem[]; feeds: NewsFeed[];
  access: AccessRule[]; runs: IngestRun[]; nextId: number;
  rolePerms: RolePerm[]; requirements: Requirement[]; risks: Risk[]; criteria: Criterion[]; scores: Score[];
  deadlines: DeadlineRec[]; docs: LeadDoc[]; docRequests: DocRequest[]; tasks: Task[]; partners: Partner[]; leadPartners: LeadPartner[];
  kb: KbDoc[]; relationships: Relationship[]; relNotes: RelNote[]; events: IntegrationEvent[]; views: SavedView[]; audit: AuditEntry[];
  refSeq: number; seq: number;
  // update 4 (optional so an older demo file on disk still loads)
  kbEvidence?: KbEvidence[]; claims?: KbClaim[]; driveFolders?: DriveFolder[]; driveFiles?: DriveFile[]; settings?: IntegrationSettings;
}

const ME = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-000000000002';
const B = '00000000-0000-4000-8000-000000000003';
const CTO = '00000000-0000-4000-8000-000000000004';
const VP = '00000000-0000-4000-8000-000000000005';
const GM = '00000000-0000-4000-8000-000000000006';

// Names from the BD workbooks: leads to validate, never confirmed partners (same seed as update-3.sql).
export const PARTNER_SEED: [string, string | null, 'Organisation' | 'Person', Partner['verification'], string][] = [
  ['Raj Kumari Foundation (RKF)', 'RKF', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: partner on "CSR AFSL". Separate legal entity; do not use its documents as NCPL\'s.'],
  ['Codiant Technologies', 'Codient (workbook spelling)', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026 (Pre-leads, as "Codient"): system-integration collaboration. Confirm legal name and spelling.'],
  ['Equa Medical', 'Equa-Medical', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: Panama and Ecuador projects.'],
  ['TrioTree', 'Triotree', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: named on J&K telemedicine tender; MoU discussion in Pre-leads.'],
  ['TDH', null, 'Organisation', 'Unidentified', 'BusinessPipeline 29 Sep 2026: Sundarbans grant and pulmonary-studies proposal. Exact entity to be confirmed.'],
  ['Gurumauli Foundation, Pune', null, 'Organisation', 'Unidentified', 'Mentioned in team discussion. Identity and capabilities not verified.'],
  ['CCAMP', 'C-CAMP', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: CardiVU-PRO Wadhwani Foundation application.'],
  ['Firstmillion', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: Church Project NE (CSR).'],
  ['Qserve Pune', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: eSanjeevani Project Thane.'],
  ['Appzoy', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: "to be involved" in Equa-Medical Ecuador.'],
  ['Divine Spectrum', 'Divine Spectrum SDN BHD', 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026 (Pre-leads): RFI for kiosks.'],
  ['CBR', null, 'Organisation', 'Unidentified', 'BusinessPipeline 29 Sep 2026: "CBR Devices requirement". Organisation type and full name to be confirmed.'],
  ['Marina', null, 'Organisation', 'Unidentified', 'BusinessPipeline 29 Sep 2026: named on J&K telemedicine tender. Whether an organisation or a person is unclear.'],
  ['Nitin Chouthai', null, 'Person', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: newborn incubator transporter feasibility (US).'],
  ['Ameya Pethe', null, 'Person', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026: newborn incubator transporter feasibility (US).'],
  ['GenetixBiotech', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026 (Pre-leads): exploring an association.'],
  ['Akash Enterprise', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026 (Pre-leads): GeM tender specialist.'],
  ['COEP Tech', null, 'Organisation', 'Needs confirmation', 'BusinessPipeline 29 Sep 2026 (Pre-leads): Smart Villages Initiative partner.'],
  ['London-based organisation (Mozambique project)', null, 'Organisation', 'Unidentified', 'Unidentified—needs confirmation. Mentioned in connection with a Mozambique project; do not state a relationship.']
];

export const CRITERIA_SEED: [Criterion['kind'], string, number, string | null][] = [
  ['Government / PSU tender', 'Scope matches ReMeDi products / services', 3, 'POC diagnostics, telemedicine, screening or implementation are a core part of the scope'],
  ['Government / PSU tender', 'Eligibility (turnover, experience, certifications)', 3, 'Based on the clause-level eligibility review, not the crawler guess'],
  ['Government / PSU tender', 'Commercial terms (EMD, payment, capex)', 2, 'Upfront capital, payment cycle and reimbursement risk'],
  ['Government / PSU tender', 'Delivery capacity and geography', 2, 'Locations, staffing, partner availability'],
  ['Government / PSU tender', 'Strategic value', 1, 'Reference value, state relationship, follow-on potential'],
  ['International tender', 'Scope matches ReMeDi products / services', 3, null],
  ['International tender', 'Country medical-device regulation', 3, 'Registration route and timeline in that country'],
  ['International tender', 'Local partner / consortium readiness', 3, 'Required local partner, JV rules, supplier registration (e.g. UNGM)'],
  ['International tender', 'Commercial and currency risk', 2, null],
  ['International tender', 'Strategic value', 1, null],
  ['Grant / award', 'Fit with funder priorities', 3, null],
  ['Grant / award', 'Applicant eligibility (entity, geography)', 3, 'Which entity applies: NCPL, ReMeDi Foundation or RKF'],
  ['Grant / award', 'Evidence and outcomes we can show', 2, null],
  ['Grant / award', 'Effort vs award size', 1, null],
  ['CSR', 'Alignment with CSR focus and Schedule VII', 3, null],
  ['CSR', 'Implementing entity eligibility (12A/80G, CSR-1)', 3, 'Which entity can receive CSR funds'],
  ['CSR', 'Relationship strength', 2, null],
  ['CSR', 'Programme size and margin', 1, null],
  ['Relationship lead', 'Decision-maker access', 3, null],
  ['Relationship lead', 'Clear need for ReMeDi', 2, null],
  ['Relationship lead', 'Path to a funded opportunity', 2, null]
];

function build(): DemoStore {
  const members: Member[] = [
    { id: ME, email: 'ceo.demo@neurosynaptic.com', full_name: 'Demo CEO', role: 'admin', org_role: 'CEO' },
    { id: CTO, email: 'cto.demo@neurosynaptic.com', full_name: 'Demo CTO', role: 'member', org_role: 'CTO' },
    { id: VP, email: 'vp.demo@neurosynaptic.com', full_name: 'Demo VP', role: 'member', org_role: 'VP' },
    { id: GM, email: 'gm.demo@neurosynaptic.com', full_name: 'Demo GM', role: 'member', org_role: 'GM' },
    { id: A, email: 'anita.sample@neurosynaptic.com', full_name: 'Anita (sample)', role: 'member', org_role: 'BD Executive' },
    { id: B, email: 'rahul.sample@neurosynaptic.com', full_name: 'Rahul (sample)', role: 'member', org_role: 'BD Executive' }
  ];
  const now = new Date().toISOString();
  const today = todayIST();
  const daysFrom = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const leads: Lead[] = [];
  const activity: Activity[] = [];
  const deadlines: DeadlineRec[] = [];
  let id = 1, aid = 1, seq = 1, ref = 1;
  for (const row of raw as Record<string, unknown>[]) {
    const n = normalizeIngestRow(row, todayIST());
    if (!n.ok) continue;
    const created = `${n.lead.found_on}T03:30:00.000Z`;
    const lead = { ...LEAD_DEFAULTS, ...n.lead, id: id++, ref_code: `OPP-${n.lead.found_on.slice(0, 4)}-${String(ref++).padStart(4, '0')}`, created_at: created, updated_at: created } as Lead;
    leads.push(lead);
    activity.push({ id: aid++, lead_id: lead.id, actor: null, action: 'created', detail: `Found by the crawler (${n.lead.source || 'unknown source'})`, created_at: created });
    if (lead.deadline) deadlines.push({ id: seq++, lead_id: lead.id, kind: 'Original', deadline: lead.deadline, previous: null, source: lead.source, source_url: lead.url, verified: true, verified_by: null, verified_at: created, rejected: false, note: null, created_by: null, created_at: created });
  }
  const log = (lead_id: number, actor: string | null, action: Activity['action'], detail: string, at = now) => activity.push({ id: aid++, lead_id, actor, action, detail, created_at: at });
  const find = (part: string) => leads.find(x => x.title.toLowerCase().includes(part.toLowerCase()));
  // A few worked examples so every screen has something to show
  const set = (uidPart: string, patch: Partial<Lead>, note?: string, hoursAgo = 2) => {
    const l = find(uidPart);
    if (!l) return undefined;
    const at = ago(hoursAgo);
    Object.assign(l, patch, { updated_at: at });
    if (patch.verification) { l.verified_by = patch.verified_by ?? ME; l.verified_at = at; log(l.id, l.verified_by, 'verified', patch.verification + (note ? ': ' + note : ''), at); }
    if (patch.assigned_to) { l.assigned_at = at; log(l.id, GM, 'assigned', 'Assigned to ' + members.find(m => m.id === patch.assigned_to)!.full_name, at); }
    if (patch.decision && patch.decision !== 'Undecided') log(l.id, l.decided_by ?? ME, 'decision', patch.decision + (patch.decision_reason ? ': ' + patch.decision_reason : ''), at);
    if (patch.stage && patch.stage !== 'Identified') log(l.id, l.assigned_to ?? ME, 'stage', 'Identified → ' + patch.stage, at);
    if (patch.recommended_decision) log(l.id, l.recommended_by, 'recommendation', `Recommended ${patch.recommended_decision}: ${patch.recommendation_reason || ''}`, at);
    if (patch.eligibility_status && patch.eligibility_status !== 'Not assessed') log(l.id, l.eligibility_by, 'eligibility', patch.eligibility_status + (patch.eligibility_summary ? ': ' + patch.eligibility_summary : ''), at);
    return l;
  };
  set('Catalyse Tech', { verification: 'Correct', verification_note: 'ToR read; certification evidence needed', assigned_to: ME, stage: 'Submitted', decision: 'Go', decision_reason: 'Technical scope fits; certification evidence to attach.', decided_by: ME, decided_at: ago(30), approval_status: 'Approved', applied_on: daysFrom(-3) }, 'ToR read; certification evidence needed', 30);
  set('MSRTC', { verification: 'Correct', assigned_to: A, verified_by: A, decision: 'No-go', decision_reason: 'BOOT model: we fund the set-up and the state reimburses per check-up later; EMD ₹1.52 Cr; needs a funding partner; state payment risk.', decided_by: ME, decided_at: ago(50), approval_status: 'Approved', business_model: 'BOOT / PPP' }, 'Checked on mahatenders', 50);
  const camps = set('health camps for construction workers', {
    verification: 'Correct', assigned_to: B, stage: 'Screening', verified_by: B, eligibility_status: 'Needs clarification', eligibility_by: B, eligibility_at: ago(5),
    eligibility_summary: '[Sample] Turnover clause unclear; experience letters to confirm.', partner_need: 'Unclear',
    recommended_decision: 'Go', recommendation_reason: '[Sample] Screening camps match our kit; go if the turnover clause is clarified.', recommended_by: B, recommended_at: ago(4), approval_status: 'Pending'
  }, undefined, 6);
  set('MIT Solve', { verification: 'Correct', assigned_to: ME, stage: 'In preparation', decision: 'Go', decision_reason: 'Philips Foundation prize fits POC + teleconsult for maternal and cardiac care.', decided_by: ME, decided_at: ago(70), approval_status: 'Approved', contact_name: 'Solve team', contact_email: 'challenges@solve.mit.edu', next_followup: todayIST(), pitch_summary: 'ReMeDi kiosks bring 40+ POC tests and teleconsultation to rural primary care.' }, undefined, 70);
  set('Tele/e-ICUs', { verification: 'Incorrect', verified_by: A }, 'Tele-ICU staffing, not our product', 26);
  set('MRI tele-reporting', { verification: 'Incorrect', verified_by: B }, 'Teleradiology only', 27);
  set('videoconference equipment', { verification: 'Incorrect' }, 'Meeting-room AV', 28);
  const pink = set('Pink Smart Mobile', { verification: 'Duplicate', verified_by: A }, 'Same scheme as the 5-unit SGPGIMS bid', 29);
  if (pink) { const orig = leads.find(x => x.id !== pink.id && /SGPGIMS/i.test(x.title + ' ' + (x.funder_buyer || ''))); if (orig) pink.duplicate_of = orig.id; }
  set('Uttara Kannada', { verification: 'Correct', assigned_to: B, verified_by: B, stage: 'Under consideration' }, undefined, 8);
  set('KITA SEHAT', { assigned_to: A, stage: 'Screening' }, undefined, 9);
  set('Jhpiego', { assigned_to: B }, undefined, 10);
  set('ICMR special call', { verification: 'Correct', assigned_to: A, stage: 'Under consideration', verified_by: A, eligibility_status: 'Potentially eligible with partner', eligibility_by: A, eligibility_at: ago(12), eligibility_summary: '[Sample] Needs an academic co-applicant.', partner_need: 'Required by tender' }, undefined, 12);

  // [Sample] clause-level review on the construction-workers camps tender
  const requirements: Requirement[] = [];
  const risks: Risk[] = [];
  const docs: LeadDoc[] = [];
  const docRequests: DocRequest[] = [];
  const tasks: Task[] = [];
  if (camps) {
    const R = (requirement: string, excerpt: string, necessity: Requirement['necessity'], source_ref: string, evidence: string | null, status: Requirement['status'], confidence: Requirement['confidence'], question: string | null, partner_need: Requirement['partner_need'] = 'Not indicated', gap_type: string | null = null) =>
      requirements.push({ id: seq++, lead_id: camps.id, requirement, excerpt, necessity, source_doc: '[Sample] Tender document', source_ref, evidence, evidence_doc: null, status, confidence, question, partner_need, gap_type, reviewer: B, note: '[Sample] demo entry', extracted: false, sort: requirements.length, created_at: ago(6), updated_at: ago(5) });
    R('Average annual turnover', '[Sample wording] Average turnover of ₹[X] crore over the last three financial years', 'Mandatory', 'Section 4.2(b), p. 18', 'CA turnover certificate (to attach from Knowledge base)', 'Needs clarification', 'Low', 'Does “last three financial years” include FY 2025–26?', 'Not indicated', 'Eligibility');
    R('Similar work experience', '[Sample wording] Two health-camp or screening projects of similar scale', 'Mandatory', 'Section 4.2(c), p. 19', 'Experience letters — to be selected', 'Not assessed', null, null);
    R('Medical-device registration', '[Sample wording] Devices to comply with applicable medical-device rules', 'Mandatory', 'Section 5.1, p. 24', null, 'Needs clarification', 'Medium', 'Which devices in the BOQ need registration certificates?', 'Not indicated', 'Regulatory');
    R('Field staff in every district', '[Sample wording] Bidder to deploy camp teams in all listed districts', 'Unclear', 'Section 6.3, p. 31', null, 'Partner may cover', 'Medium', null, 'Recommended for delivery', 'Local presence / geography');
    R('Consortium allowed', '[Sample wording] Consortium of up to two members permitted', 'Optional', 'Section 4.4, p. 21', null, 'Not assessed', null, null);
    const RK = (factor: string, level: Risk['level'], note: string) => risks.push({ id: seq++, lead_id: camps.id, factor, level, note: '[Sample] ' + note, source: '[Sample] Tender document', updated_by: B, updated_at: ago(5) });
    RK('EMD, bid security and performance security', 'Medium', 'EMD by bank guarantee; amount to be read from the BOQ.');
    RK('Time to first revenue and reimbursement', 'High', 'Payment after each camp batch is verified.');
    RK('Missing or unavailable RFP documents', 'High', 'BOQ annexure not on the portal.');
    docs.push({ id: seq++, lead_id: camps.id, name: '[Sample] Tender document', kind: 'RFP', version: 'v1', url: camps.url, status: 'Available', review_status: 'Reviewed', issued_on: null, expires_on: null, restricted: false, note: null, added_by: B, created_at: ago(6), updated_at: ago(6) });
    docs.push({ id: seq++, lead_id: camps.id, name: '[Sample] BOQ annexure', kind: 'BOQ', version: null, url: null, status: 'Missing', review_status: 'Not reviewed', issued_on: null, expires_on: null, restricted: false, note: 'Referenced in the tender but not published', added_by: B, created_at: ago(6), updated_at: ago(6) });
    docRequests.push({ id: seq++, lead_id: camps.id, document: '[Sample] BOQ annexure', to_name: '[Tender inviting officer]', to_email: null, subject: 'Request for BOQ annexure', body: 'Dear Sir/Madam,\n\nThe tender refers to a BOQ annexure that is not available on the portal. We request that it be published so bidders can prepare a compliant response.\n\nRegards,\n[Name], Neurosynaptic Communications Pvt. Ltd.', remind_on: daysFrom(2), status: 'Draft', drafted_by: B, reviewed_by: null, created_at: ago(5), updated_at: ago(5) });
    if (camps.deadline) deadlines.push({ id: seq++, lead_id: camps.id, kind: 'Amendment', deadline: daysFrom(Math.max(3, (Date.parse(camps.deadline) - Date.parse(today)) / 864e5 + 7)), previous: camps.deadline, source: '[Sample] Corrigendum noticed by the crawler', source_url: camps.url, verified: false, verified_by: null, verified_at: null, rejected: false, note: null, created_by: null, created_at: ago(3) });
    tasks.push({ id: seq++, lead_id: camps.id, title: 'Confirm turnover clause with the buyer', detail: 'Raise a pre-bid query', personal: false, status: 'In progress', assignee: B, created_by: GM, due_on: daysFrom(2), done_note: null, done_at: null, created_at: ago(5), updated_at: ago(4) });
    tasks.push({ id: seq++, lead_id: camps.id, title: 'Pick experience letters for similar projects', detail: null, personal: false, status: 'Open', assignee: null, created_by: GM, due_on: daysFrom(4), done_note: null, done_at: null, created_at: ago(5), updated_at: ago(5) });
  }
  const solve = find('MIT Solve');
  if (solve) {
    tasks.push({ id: seq++, lead_id: solve.id, title: 'Draft the pitch narrative', detail: null, personal: false, status: 'Done', assignee: ME, created_by: ME, due_on: daysFrom(-2), done_note: 'Draft v2 shared with the team', done_at: ago(30), created_at: ago(90), updated_at: ago(30) });
    tasks.push({ id: seq++, lead_id: solve.id, title: 'Collect outcome figures for the application', detail: null, personal: false, status: 'Open', assignee: A, created_by: ME, due_on: daysFrom(-1), done_note: null, done_at: null, created_at: ago(80), updated_at: ago(80) });
  }
  tasks.push({ id: seq++, lead_id: null, title: '[Sample] Update the capability deck', detail: null, personal: true, status: 'Open', assignee: ME, created_by: ME, due_on: daysFrom(5), done_note: null, done_at: null, created_at: ago(20), updated_at: ago(20) });

  const partners: Partner[] = PARTNER_SEED.map(([name, aliases, kind, verification, source_note]) => ({
    id: seq++, name, aliases, kind, category: null, capabilities: null, geography: null, health_domains: null, contact_name: null, contact_email: null, contact_phone: null,
    owner: null, prior_collaboration: null, verification, relationship: 'To confirm', due_diligence: null, restrictions: null, source_note, created_at: now, updated_at: now
  }));
  const criteria: Criterion[] = CRITERIA_SEED.map(([kind, criterion, weight, guidance], i) => ({ id: seq++, kind, criterion, weight, guidance, active: true, sort: i }));
  const kb: KbDoc[] = [
    { id: seq++, name: '[Sample] Certificate of incorporation', entity: 'NCPL', doc_type: 'Registration', owner: GM, doc_date: null, expires_on: null, version: null, confidentiality: 'Internal', approval: 'Draft', tags: 'registration, eligibility', location: '[path to the file]', summary: 'Placeholder record — replace with the real document details.', created_at: now, updated_at: now },
    { id: seq++, name: '[Sample] Audited financial statements', entity: 'NCPL', doc_type: 'Financial', owner: ME, doc_date: null, expires_on: null, version: null, confidentiality: 'Restricted', approval: 'Draft', tags: 'turnover, eligibility', location: '[path to the file]', summary: 'Placeholder. Restricted: visible only to roles allowed to see financial documents.', created_at: now, updated_at: now },
    { id: seq++, name: '[Sample] Product brochure', entity: 'NCPL', doc_type: 'Product', owner: A, doc_date: null, expires_on: daysFrom(20), version: null, confidentiality: 'Internal', approval: 'Approved', tags: 'product, proposal', location: '[path to the file]', summary: 'Placeholder record.', created_at: now, updated_at: now },
    { id: seq++, name: '[Sample] Registration certificate (expired example)', entity: 'ReMeDi Foundation', doc_type: 'Registration', owner: GM, doc_date: null, expires_on: daysFrom(-10), version: null, confidentiality: 'Internal', approval: 'Approved', tags: 'CSR, registration', location: '[path to the file]', summary: 'Shows how an expired document is flagged.', created_at: now, updated_at: now }
  ];
  const relationships: Relationship[] = [
    { id: seq++, owner: ME, organisation: '[Sample] State health department', contact_name: '[Contact name]', contact_role: 'Programme officer', contact_email: null, contact_phone: null, status: 'Warm', last_touch: daysFrom(-12), next_followup: daysFrom(-1), next_action: 'Send the one-page note', visibility: 'Private', linked_lead: null, created_at: now, updated_at: now },
    { id: seq++, owner: ME, organisation: '[Sample] Corporate foundation (CSR)', contact_name: '[CSR head]', contact_role: 'Head of CSR', contact_email: null, contact_phone: null, status: 'Active', last_touch: daysFrom(-4), next_followup: daysFrom(3), next_action: 'Share programme budget', visibility: 'Shared with leadership', linked_lead: solve?.id ?? null, created_at: now, updated_at: now },
    { id: seq++, owner: A, organisation: '[Sample] District hospital', contact_name: '[Medical superintendent]', contact_role: null, contact_email: null, contact_phone: null, status: 'New', last_touch: null, next_followup: daysFrom(6), next_action: null, visibility: 'Private', linked_lead: null, created_at: now, updated_at: now }
  ];
  const relNotes: RelNote[] = [{ id: seq++, relationship_id: relationships[0]!.id, author: ME, body: '[Sample] Private note: interested in screening at scale.', created_at: now }];

  return {
    members, leads, activity, news: [], nextId: id,
    feeds: [{ id: 1, name: process.env.DEMO_FEED_URL ? 'Demo feed' : 'Telemedicine tenders, India', url: process.env.DEMO_FEED_URL || 'https://news.google.com/rss/search?q=telemedicine+tender+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', topic: 'Tenders', active: true }],
    access: [{ pattern: '@neurosynaptic.com', note: 'Everyone with a company email' }],
    runs: [{ id: 1, run_at: '2026-10-02T01:15:00.000Z', received: 38, inserted: 38, note: 'Round 2 (Firecrawl)' }],
    rolePerms: defaultRolePerms(), requirements, risks, criteria, scores: [], deadlines, docs, docRequests, tasks, partners, leadPartners: [],
    kb, relationships, relNotes, events: [], views: [], audit: [], refSeq: ref, seq,
    ...demoKbExtras(kb, now)
  };
}

// Kept in a temp file so pages, server actions and API routes (separate bundles) see the same data.
const FILE = path.join(os.tmpdir(), 'remedi-crm-demo-v3.json');
let cached: { mtime: number; store: DemoStore } | null = null;

export function demo(): DemoStore {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (cached && cached.mtime === mtime) return cached.store;
    const store = JSON.parse(fs.readFileSync(FILE, 'utf8')) as DemoStore;
    store.leads = store.leads.map(l => ({ ...LEAD_DEFAULTS, ...l, stage: LEGACY_STAGE[l.stage] || l.stage }) as Lead);
    cached = { mtime, store };
    return cached.store;
  } catch {
    const store = build();
    saveDemo(store);
    return store;
  }
}

export function saveDemo(store: DemoStore = demo()): void {
  fs.writeFileSync(FILE, JSON.stringify(store));
  cached = { mtime: fs.statSync(FILE).mtimeMs, store };
}

/** Next id for any demo table. */
export function nextSeq(st: DemoStore = demo()): number { return st.seq++; }
export const DEMO_ME = ME;

/** [Sample] evidence passages and claims so the knowledge-base search, claim review and eligibility evidence screens
 *  have something to show in demo mode. Fictional text only; no company facts. */
function demoKbExtras(kb: KbDoc[], now: string): Pick<DemoStore, 'kbEvidence' | 'claims' | 'driveFolders' | 'driveFiles' | 'settings'> {
  const [inc, fin, bro, reg] = kb;
  const ev = (id: number, d: KbDoc | undefined, locator: string, body: string): KbEvidence => ({ id, document_id: d!.id, locator, body, confidentiality: d!.confidentiality, ocr: false });
  const kbEvidence: KbEvidence[] = [
    ev(90001, inc, 'page 1', '[Sample] Certificate text placeholder: company name, registration number and date appear here in a real document.'),
    ev(90002, bro, 'page 2', '[Sample] Brochure text placeholder describing a point-of-care screening kit and teleconsultation workflow.'),
    ev(90003, bro, 'page 3', '[Sample] Brochure placeholder: "deployed at [number] sites" — a figure a person must confirm against a contract or report.'),
    ev(90004, fin, 'page 4', '[Sample] Restricted placeholder: turnover figures for three financial years would appear here.'),
    ev(90005, reg, 'page 1', '[Sample] Registration placeholder with a validity date that has passed.')
  ];
  const c = (id: number, d: KbDoc | undefined, claim_type: string, statement: string, claim_status: KbClaim['claim_status'], locator: string, extra: Partial<KbClaim> = {}): KbClaim => ({
    id, claim_uid: 'CLM-SAMPLE-' + id, document_id: d!.id, claim_type, statement, claim_status, review_status: 'pending', entity: d!.entity,
    confidentiality: d!.confidentiality, locator, quote: statement.slice(0, 200), subject: null, value: null, conflict_group: null, confidence: 'medium',
    reviewed_by: null, reviewed_at: null, review_note: null, created_at: now, updated_at: now, ...extra
  });
  const claims: KbClaim[] = [
    c(91001, inc, 'registration', '[Sample] The company is registered under [Act] (registration number on page 1).', 'unverified', 'page 1'),
    c(91002, bro, 'reach', '[Sample] Deployed at [number] sites (brochure).', 'unverified', 'page 3', { subject: 'sites', value: 120, conflict_group: 'CNF-SAMPLE' }),
    c(91003, bro, 'reach', '[Sample] Deployed at [number] sites (older brochure).', 'unverified', 'page 2', { subject: 'sites', value: 95, conflict_group: 'CNF-SAMPLE' }),
    c(91004, fin, 'financial', '[Sample] Turnover for one financial year (restricted).', 'unverified', 'page 4', { subject: 'turnover ?' }),
    c(91005, reg, 'registration', '[Sample] Registration valid until a date that has passed.', 'expired', 'page 1')
  ];
  const settings: IntegrationSettings = { id: 1, drive_root_id: null, drive_root_name: null, drive_root_url: null, drive_root_verified: null, shared_drive_id: null, copy_policy: 'link_only', ai_provider: 'none', ai_allow_confidential: false, updated_by: null, updated_at: now };
  return { kbEvidence, claims, driveFolders: [], driveFiles: [], settings };
}
