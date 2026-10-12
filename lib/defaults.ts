import type { Lead } from './types';

/** Values a new lead starts with (mirrors the database defaults). */
export const LEAD_DEFAULTS: Partial<Lead> = {
  verification: 'Unverified', verification_note: null, verified_by: null, verified_at: null,
  stage: 'New', assigned_to: null, assigned_at: null,
  deadline_note: null, rfp_status: 'Unknown', eligibility_reason: null, scope_gaps: null, scope_type: null, uses_our_product: null,
  business_model: null, business_model_note: null, regulatory_risk: null, regulatory_note: null, red_flags: null,
  decision: 'Undecided', decision_reason: null, decided_by: null, decided_at: null,
  applied_on: null, pitch_summary: null, contact_name: null, contact_role: null, contact_email: null, contact_phone: null, next_followup: null
};
