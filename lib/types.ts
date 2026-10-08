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
  action: 'created' | 'verified' | 'assigned' | 'stage' | 'comment';
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
export interface IngestRun { id: number; run_at: string; received: number; inserted: number; note: string | null }

export interface Session {
  user: Member;
  isMember: boolean;
  demo: boolean;
}
