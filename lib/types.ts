export type LeadType = 'Tender' | 'RFP / EOI' | 'Grant' | 'CSR';
export const LEAD_TYPES: LeadType[] = ['Tender', 'RFP / EOI', 'Grant', 'CSR'];

// URL slugs for each lead type (/leads?type=rfp)
export const TYPE_SLUGS: Record<string, LeadType> = { tender: 'Tender', rfp: 'RFP / EOI', grant: 'Grant', csr: 'CSR' };
export const SLUG_OF: Record<LeadType, string> = { 'Tender': 'tender', 'RFP / EOI': 'rfp', 'Grant': 'grant', 'CSR': 'csr' };
export const TYPE_LABEL: Record<LeadType, string> = { 'Tender': 'Tenders', 'RFP / EOI': 'RFPs & EOIs', 'Grant': 'Grants', 'CSR': 'CSR calls' };

export type Verification = 'Unverified' | 'Correct' | 'Incorrect' | 'Duplicate';
export const VERIFICATIONS: Verification[] = ['Unverified', 'Correct', 'Incorrect', 'Duplicate'];

export type Stage = 'New' | 'Qualified' | 'Preparing' | 'Submitted' | 'Won' | 'Lost' | 'Dropped';
export const STAGES: Stage[] = ['New', 'Qualified', 'Preparing', 'Submitted', 'Won', 'Lost', 'Dropped'];
export const CLOSED_STAGES: Stage[] = ['Won', 'Lost', 'Dropped'];

export const PRIORITIES = ['Apply', 'Consider', 'Watch', 'Skip', 'Review'];

// Do we go for it? Separate from "is the lead correct?" (a correct lead can still be a No-go).
export type Decision = 'Undecided' | 'Go' | 'No-go';
export const DECISIONS: Decision[] = ['Undecided', 'Go', 'No-go'];

// RFP / tender documents: the crawler sets Available / Missing / Login needed; the team moves it to Requested / Received.
export const RFP_STATUSES = ['Unknown', 'Available', 'Missing', 'Login needed', 'Requested', 'Received'];
export const BUSINESS_MODELS = ['Opex service', 'Capex supply', 'Capex + O&M', 'BOOT / PPP', 'Grant', 'Unknown'];
export const SCOPE_TYPES = ['POC + telemedicine', 'Screening / camps', 'Mobile medical unit', 'Devices supply', 'Hospital supplies', 'Software / IT', 'Research / consulting', 'Funding call', 'Unknown'];

export type Relevance = 'Unreviewed' | 'Relevant' | 'Not relevant';

export interface Lead {
  id: number;
  uid: string;
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
  eligibility: string | null;
  partner_needed: string | null;
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
  // go / no-go
  decision: Decision;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
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

export interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: 'member' | 'admin';
}

export interface Activity {
  id: number;
  lead_id: number;
  actor: string | null;
  action: 'created' | 'verified' | 'assigned' | 'stage' | 'comment' | 'decision' | 'edited' | 'pursuit' | 'updated';
  detail: string | null;
  created_at: string;
}

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
}
