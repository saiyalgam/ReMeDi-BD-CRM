export type LeadType = 'Tender' | 'RFP / EOI' | 'Grant' | 'CSR';
export const LEAD_TYPES: LeadType[] = ['Tender', 'RFP / EOI', 'Grant', 'CSR'];

// URL slugs for each lead type (/leads?type=rfp)
export const TYPE_SLUGS: Record<string, LeadType> = { tender: 'Tender', rfp: 'RFP / EOI', grant: 'Grant', csr: 'CSR' };
export const SLUG_OF: Record<LeadType, string> = { 'Tender': 'tender', 'RFP / EOI': 'rfp', 'Grant': 'grant', 'CSR': 'csr' };
export const TYPE_LABEL: Record<LeadType, string> = { 'Tender': 'Tenders', 'RFP / EOI': 'RFPs & EOIs', 'Grant': 'Grants & awards', 'CSR': 'CSR calls' };

// 1. Lead verification: is the opportunity real and relevant enough to review? (Not: should we bid.)
export type Verification = 'Unverified' | 'Correct' | 'Incorrect' | 'Duplicate';
export const VERIFICATIONS: Verification[] = ['Unverified', 'Correct', 'Incorrect', 'Duplicate'];

// 2. Eligibility, as reviewed by the team against the source document (the crawler's guess is kept separately).
export type EligibilityStatus = 'Not assessed' | 'Meets directly' | 'Potentially eligible with partner' | 'Does not meet' | 'Needs clarification';
export const ELIGIBILITY_STATUSES: EligibilityStatus[] = ['Not assessed', 'Meets directly', 'Potentially eligible with partner', 'Does not meet', 'Needs clarification'];

// 3. Pursuit decision (a correct lead can still be a No-go).
export type Decision = 'Undecided' | 'Go' | 'No-go';
export const DECISIONS: Decision[] = ['Undecided', 'Go', 'No-go'];
export type ApprovalStatus = 'None' | 'Pending' | 'Approved' | 'Returned';

// 4. Pipeline stage.
export type Stage = 'Identified' | 'Screening' | 'Under consideration' | 'Partnering' | 'In preparation' | 'Submitted' | 'Clarification' | 'Won' | 'Lost' | 'Dropped' | 'Banked';
export const STAGES: Stage[] = ['Identified', 'Screening', 'Under consideration', 'Partnering', 'In preparation', 'Submitted', 'Clarification', 'Won', 'Lost', 'Dropped', 'Banked'];
export const CLOSED_STAGES: Stage[] = ['Won', 'Lost', 'Dropped', 'Banked'];
export const ACTIVE_STAGES: Stage[] = STAGES.filter(s => !CLOSED_STAGES.includes(s));
/** Old stage names from before update 3 (rows in a not-yet-migrated database or an old demo file). */
export const LEGACY_STAGE: Record<string, Stage> = { New: 'Identified', Qualified: 'Under consideration', Preparing: 'In preparation' };

export const PARTNER_NEEDS = ['Not indicated', 'Required by tender', 'Recommended for delivery', 'Unclear'] as const;
export type PartnerNeed = typeof PARTNER_NEEDS[number];
export const GAP_TYPES = ['Eligibility', 'Technical', 'Regulatory', 'Local presence / geography', 'Implementation', 'Financing / EMD', 'Equipment / OEM', 'Consortium', 'Other'] as const;

export const PRIORITIES = ['Apply', 'Consider', 'Watch', 'Skip', 'Review'];

// Initial planning bands for opportunity sizing. These are team estimates, not crawler facts.
export const VALUE_BANDS = ['Up to ₹50 lakh', '₹50 lakh–₹2 crore', 'Above ₹2 crore', 'Unestimated'] as const;
export type ValueBand = typeof VALUE_BANDS[number];

// RFP / tender documents: the crawler sets Available / Missing / Login needed; the team moves it to Requested / Received.
export const RFP_STATUSES = ['Unknown', 'Available', 'Missing', 'Login needed', 'Requested', 'Received'];
export const BUSINESS_MODELS = ['Opex service', 'Capex supply', 'Capex + O&M', 'BOOT / PPP', 'Grant', 'Unknown'];
export const SCOPE_TYPES = ['POC + telemedicine', 'Screening / camps', 'Mobile medical unit', 'Devices supply', 'Hospital supplies', 'Software / IT', 'Research / consulting', 'Funding call', 'Unknown'];

export type Relevance = 'Unreviewed' | 'Relevant' | 'Not relevant';

export interface Lead {
  id: number;
  uid: string;
  ref_code: string | null;
  lead_type: LeadType;
  category: string;
  title: string;
  funder_buyer: string | null;
  country: string | null;
  deadline: string | null;
  amount: string | null;
  ref_no: string | null;
  url: string | null;
  source: string | null;
  summary: string | null;
  fit_score: number | null;
  priority: string | null;
  eligibility: string | null;        // crawler's suggestion (Direct / Via partner / Check / Not eligible), not reviewed
  partner_needed: string | null;     // crawler's suggestion
  suggested_partner: string | null;
  why_fit: string | null;
  risks: string | null;
  next_step: string | null;
  verification: Verification;
  verification_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  stage: Stage;
  assigned_to: string | null;
  assigned_at: string | null;
  // assessment (crawler / AI, editable)
  deadline_note: string | null;
  rfp_status: string | null;
  eligibility_reason: string | null;
  scope_gaps: string | null;
  scope_type: string | null;
  uses_our_product: string | null;
  business_model: string | null;
  business_model_note: string | null;
  regulatory_risk: string | null;
  regulatory_note: string | null;
  red_flags: string | null;
  // reviewed eligibility (update 3)
  eligibility_status: EligibilityStatus;
  eligibility_summary: string | null;
  eligibility_by: string | null;
  eligibility_at: string | null;
  partner_need: PartnerNeed;
  // go / no-go
  decision: Decision;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  recommended_decision: 'Go' | 'No-go' | null;
  recommendation_reason: string | null;
  recommended_by: string | null;
  recommended_at: string | null;
  approval_status: ApprovalStatus;
  approval_note: string | null;
  duplicate_of: number | null;
  scorecard_kind: string | null;
  value_band: string | null;
  // pursuit
  applied_on: string | null;
  pitch_summary: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  next_followup: string | null;
  found_on: string;
  origin: string;
  created_at: string;
  updated_at: string;
}

export const ORG_ROLES = ['CEO', 'CTO', 'VP', 'GM', 'BD Executive'] as const;
export type OrgRole = typeof ORG_ROLES[number];

export interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: 'member' | 'admin';        // system administrator flag (users, access, settings)
  org_role?: OrgRole | null;       // organisation level, drives permissions
}

export type ActivityAction = 'created' | 'verified' | 'assigned' | 'stage' | 'comment' | 'decision' | 'edited' | 'pursuit' | 'updated'
  | 'eligibility' | 'recommendation' | 'approval' | 'requirement' | 'risk' | 'score' | 'deadline' | 'document' | 'request' | 'task' | 'partner' | 'merge' | 'meeting' | 'drive';

export interface Activity {
  id: number;
  lead_id: number;
  actor: string | null;
  action: ActivityAction;
  detail: string | null;
  created_at: string;
}

export type ReqStatus = 'Meets' | 'Does not meet' | 'Partner may cover' | 'Needs clarification' | 'Not assessed';
export const REQ_STATUSES: ReqStatus[] = ['Meets', 'Does not meet', 'Partner may cover', 'Needs clarification', 'Not assessed'];
export interface Requirement {
  id: number; lead_id: number; requirement: string; excerpt: string | null;
  necessity: 'Mandatory' | 'Optional' | 'Unclear'; source_doc: string | null; source_ref: string | null;
  evidence: string | null; evidence_doc: number | null; status: ReqStatus; confidence: 'High' | 'Medium' | 'Low' | null;
  question: string | null; partner_need: 'Required by tender' | 'Recommended for delivery' | 'Not indicated'; gap_type: string | null;
  reviewer: string | null; note: string | null; extracted: boolean; sort: number; created_at: string; updated_at: string;
  /** update 4: the cited claim shown beside the clause (null when none is linked) */
  evidence_claim?: number | null;
}

export const RISK_FACTORS = [
  'Contract value, currency and payment terms',
  'EMD, bid security and performance security',
  'Capex vs opex / BOOT or PPP structure',
  'Time to first revenue and reimbursement',
  'Delivery locations, staffing and capacity',
  'Products, devices, software and services required',
  'Medical-device registration / regulation',
  'Supplier registration and onboarding (e.g. UNGM)',
  'Consortium, JV or local-partner requirement',
  'Missing or unavailable RFP documents'
] as const;
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Unclear' | 'Not applicable';
export const RISK_LEVELS: RiskLevel[] = ['Low', 'Medium', 'High', 'Unclear', 'Not applicable'];
export interface Risk { id: number; lead_id: number; factor: string; level: RiskLevel; note: string | null; source: string | null; updated_by: string | null; updated_at: string }

export const SCORE_KINDS = ['Government / PSU tender', 'International tender', 'Grant / award', 'CSR', 'Relationship lead'] as const;
export type ScoreKind = typeof SCORE_KINDS[number];
export interface Criterion { id: number; kind: ScoreKind; criterion: string; weight: number; guidance: string | null; active: boolean; sort: number }
export interface Score { lead_id: number; criterion_id: number; score: number | null; rationale: string | null; evidence: string | null; scored_by: string | null; scored_at: string }

export interface DeadlineRec {
  id: number; lead_id: number; kind: 'Original' | 'Amendment'; deadline: string; previous: string | null;
  source: string | null; source_url: string | null; verified: boolean; verified_by: string | null; verified_at: string | null;
  rejected: boolean; note: string | null; created_by: string | null; created_at: string;
}

export const DOC_KINDS = ['RFP', 'Corrigendum / amendment', 'Annexure', 'BOQ', 'Clarification', 'Pre-bid minutes', 'Submission', 'Other'] as const;
export const DOC_STATUSES = ['Available', 'Missing', 'Requested', 'Received', 'Login needed'] as const;
export interface LeadDoc {
  id: number; lead_id: number; name: string; kind: string; version: string | null; url: string | null;
  status: typeof DOC_STATUSES[number]; review_status: 'Not reviewed' | 'Reviewed' | 'Superseded';
  issued_on: string | null; expires_on: string | null; restricted: boolean; note: string | null; added_by: string | null; created_at: string; updated_at: string;
}
export interface DocRequest {
  id: number; lead_id: number; document: string; to_name: string | null; to_email: string | null; subject: string | null; body: string | null;
  remind_on: string | null; status: 'Draft' | 'Reviewed' | 'Sent by a person' | 'Cancelled'; drafted_by: string | null; reviewed_by: string | null; created_at: string; updated_at: string;
}

export type TaskStatus = 'Open' | 'In progress' | 'Done' | 'Cancelled';
export const TASK_STATUSES: TaskStatus[] = ['Open', 'In progress', 'Done', 'Cancelled'];
export interface Task {
  id: number; lead_id: number | null; title: string; detail: string | null; personal: boolean; status: TaskStatus;
  assignee: string | null; created_by: string | null; due_on: string | null; done_note: string | null; done_at: string | null; created_at: string; updated_at: string;
}

export const PARTNER_VERIFICATION = ['Verified', 'Needs confirmation', 'Unidentified'] as const;
export const PARTNER_RELATIONSHIP = ['Current', 'Past', 'Prospective', 'To confirm'] as const;
export interface Partner {
  id: number; name: string; aliases: string | null; kind: 'Organisation' | 'Person'; category: string | null; capabilities: string | null;
  geography: string | null; health_domains: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  owner: string | null; prior_collaboration: string | null; verification: typeof PARTNER_VERIFICATION[number];
  relationship: typeof PARTNER_RELATIONSHIP[number]; due_diligence: string | null; restrictions: string | null; source_note: string | null;
  created_at: string; updated_at: string;
}
export interface LeadPartner {
  id: number; lead_id: number; partner_id: number; need: 'Required by tender' | 'Recommended for delivery';
  gap_type: string | null; gap_note: string | null; evidence: string | null; status: 'Suggested' | 'Contacted' | 'Committed' | 'Declined'; added_by: string | null; created_at: string;
}

export const KB_ENTITIES = ['NCPL', 'ReMeDi Foundation', 'RKF', 'Partner', 'Other', 'Unresolved'] as const;
export const KB_TYPES = ['Product', 'Credential / certificate', 'Registration', 'Experience letter', 'Project reference', 'Financial', 'Policy', 'Presentation', 'Proposal material', 'Other'] as const;
export interface KbDoc {
  id: number; name: string; entity: typeof KB_ENTITIES[number]; doc_type: typeof KB_TYPES[number]; owner: string | null;
  doc_date: string | null; expires_on: string | null; version: string | null; confidentiality: KbConfidentiality;
  approval: 'Draft' | 'Approved' | 'Superseded'; tags: string | null; location: string | null; summary: string | null; created_at: string; updated_at: string;
  // update 4 provenance (absent on records typed in by hand before update 4)
  doc_uid?: string | null; source_path?: string | null; container_path?: string | null; file_name?: string | null; file_type?: string | null;
  size_bytes?: number | null; sha256?: string | null; category?: string | null; sensitivity_reason?: string | null;
  extraction_status?: string | null; extraction_notes?: string | null; processing_version?: string | null; processed_at?: string | null;
  review_flags?: string[] | null; duplicate_of_uid?: string | null; searchable?: boolean | null; excluded_reason?: string | null;
  expiry_text?: string | null; drive_file_id?: string | null; drive_url?: string | null;
}
export const KB_CONFIDENTIALITY = ['Internal', 'Confidential', 'Restricted'] as const;
export type KbConfidentiality = typeof KB_CONFIDENTIALITY[number];

export const CLAIM_STATUSES = ['proposed', 'submitted', 'contracted', 'delivered', 'validated', 'expired', 'unverified'] as const;
export type ClaimStatus = typeof CLAIM_STATUSES[number];
export const CLAIM_REVIEW = ['pending', 'confirmed', 'rejected', 'needs_info'] as const;
export type ClaimReview = typeof CLAIM_REVIEW[number];
export interface KbClaim {
  id: number; claim_uid: string | null; document_id: number | null; claim_type: string; statement: string; claim_status: ClaimStatus;
  review_status: ClaimReview; entity: string | null; confidentiality: KbConfidentiality; locator: string | null; quote: string | null;
  subject: string | null; value: number | null; conflict_group: string | null; confidence: string | null;
  reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string; updated_at: string;
}
export interface KbEvidence { id: number; document_id: number; locator: string; body: string; confidentiality: KbConfidentiality; ocr: boolean }
export interface KbHit {
  evidence_id: number; document_id: number; doc_name: string; entity: string; category: string | null; confidentiality: KbConfidentiality;
  approval: string; expires_on: string | null; locator: string; snippet: string; rank: number;
}

// ---------------- Google Drive (update 4) ----------------
export const DRIVE_SUBFOLDERS = ['00 Source and amendments', '01 Go-No-go assessment', '02 Company evidence', '03 Partner evidence', '04 Proposal', '05 Submission and outcome'] as const;
export type DriveSubfolder = typeof DRIVE_SUBFOLDERS[number];
export interface DriveConnectionStatus { provider: string; account_email: string | null; scopes: string | null; status: 'Not connected' | 'Connected' | 'Error' | 'Revoked'; last_error: string | null; connected_at: string | null }
export interface IntegrationSettings {
  id: 1; drive_root_id: string | null; drive_root_name: string | null; drive_root_url: string | null; drive_root_verified: string | null;
  shared_drive_id: string | null; copy_policy: 'link_only' | 'copy_internal'; ai_provider: 'none'; ai_allow_confidential: boolean;
  updated_by: string | null; updated_at: string;
}
export interface DriveFolder {
  id: number; lead_id: number; folder_id: string | null; folder_url: string | null; folder_name: string | null; parent_id: string | null;
  subfolders: Partial<Record<DriveSubfolder, string>>; status: 'Creating' | 'Ready' | 'Error'; error: string | null;
  created_by: string | null; created_at: string; last_synced_at: string | null;
}
export interface DriveFile {
  id: number; lead_id: number; drive_file_id: string; name: string; mime_type: string | null; modified_time: string | null; web_url: string | null;
  subfolder: string | null; sensitivity: KbConfidentiality; kb_document_id: number | null; mode: 'Link' | 'Copy'; verified: boolean;
  note: string | null; linked_by: string | null; created_at: string;
}

export const REL_STATUSES = ['New', 'Active', 'Warm', 'Dormant', 'Closed'] as const;
export interface Relationship {
  id: number; owner: string; organisation: string; contact_name: string | null; contact_role: string | null; contact_email: string | null; contact_phone: string | null;
  status: typeof REL_STATUSES[number]; last_touch: string | null; next_followup: string | null; next_action: string | null;
  visibility: 'Private' | 'Shared with leadership'; linked_lead: number | null; created_at: string; updated_at: string;
}
export interface RelNote { id: number; relationship_id: number; author: string | null; body: string; created_at: string }

export interface IntegrationEvent {
  id: number; kind: 'calendar' | 'chat'; lead_id: number | null; relationship_id: number | null; task_id: number | null; title: string;
  payload: Record<string, unknown>; status: 'Draft' | 'Opened in Google' | 'Sent' | 'Not configured' | 'Failed'; error: string | null; created_by: string | null; created_at: string;
}

export interface SavedView { id: number; owner: string; name: string; query: string; created_at: string }
export interface AuditEntry { id: number; table_name: string; row_id: string | null; op: string; actor: string | null; changed: string[] | null; created_at: string }
export interface RolePerm { org_role: OrgRole; permission: string; allowed: boolean; status: 'Confirmed' | 'Proposed' | 'Open question'; note: string | null; updated_by: string | null; updated_at: string }

export interface NewsItem {
  id: number;
  feed_id: number | null;
  guid: string;
  title: string;
  url: string;
  source: string | null;
  topic: string | null;
  summary: string | null;
  published_at: string | null;
  auto_score: number;
  relevance: Relevance;
  marked_by: string | null;
  marked_at: string | null;
}

export interface NewsFeed { id: number; name: string; url: string; topic: string | null; active: boolean }
export interface AccessRule { pattern: string; note: string | null }
export interface IngestRun { id: number; run_at: string; received: number; inserted: number; updated?: number | null; note: string | null }

export interface Session {
  user: Member;
  isMember: boolean;
  demo: boolean;
  orgRole: OrgRole;
  perms: string[];        // effective permissions (admins get every one)
}
