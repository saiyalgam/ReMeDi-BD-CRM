// Pure helpers shared by the ingest API and tests (no imports so Node can run them directly).

export type LeadTypeName = 'Tender' | 'RFP / EOI' | 'Grant' | 'CSR';

const RFP_WORDS = /\b(RFPs?|RFQs?|EOIs?|RFTs?|expressions? of interest|requests? for (?:proposals?|quotations?|tenders?)|calls? for proposals?|terms of reference|ToR)\b/i;

/** Tender, RFP / EOI, Grant or CSR, from the crawler's category and the title. */
export function deriveLeadType(category: string, title: string, explicit?: string | null): LeadTypeName {
  const allowed: LeadTypeName[] = ['Tender', 'RFP / EOI', 'Grant', 'CSR'];
  if (explicit && (allowed as string[]).includes(explicit)) return explicit as LeadTypeName;
  const c = (category || '').toLowerCase();
  if (c.includes('grant')) return 'Grant';
  if (RFP_WORDS.test(title || '')) return 'RFP / EOI';
  if (c.includes('tender')) return 'Tender';
  if (c.includes('csr')) return 'CSR';
  return 'Tender';
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 10);
  if (!ISO.test(s)) return null;
  return isNaN(Date.parse(s + 'T00:00:00Z')) ? null : s;
}
function text(v: unknown, max = 2000): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
function httpUrl(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 2000) : null;
}

/**
 * Is this the same notice under another id? Same full title, and no conflicting buyer or reference
 * (many GeM bids share one title, e.g. "Smart Mobile Medical Unit (1 unit) for basic health check-ups…").
 */
export function sameNotice(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const full = (t: unknown) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (full(a.title).length < 25 || full(a.title) !== full(b.title)) return false;
  const differs = (k: string) => a[k] && b[k] && full(a[k]) !== full(b[k]);
  return !differs('funder_buyer') && !differs('ref_no');
}

/** Same normalisation the crawler uses to spot the same notice under a different id. */
export function titleKey(t: unknown): string {
  return String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90);
}

/** AI text was written on the day a lead was found; drop phrases like "12 days left" so it never goes stale. */
export function stripDaysLeft(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const out = s
    .replace(/\s*[(;,–—-]?\s*(?:only\s+|just\s+|about\s+|~)?\d+\s+(?:working\s+)?days?\s+(?:left|remaining|to go)(?:\s+(?:before|until|to)\s+(?:the\s+)?(?:deadline|closing|submission))?\s*\)?/gi, '')
    .replace(/\s*[(;,]?\s*(?:closes|closing|due)\s+(?:today|tomorrow)\s*\)?/gi, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+([.;,])/g, '$1').replace(/^[;,.\s]+|[;,\s]+$/g, '').trim();
  return out || null;
}

const ONE_OF = (v: unknown, allowed: string[]) => { const s = text(v, 40); return s && allowed.includes(s) ? s : null; };

export const ASSESSMENT_FIELDS = ['deadline_note', 'rfp_status', 'eligibility_reason', 'scope_gaps', 'scope_type', 'uses_our_product', 'business_model', 'business_model_note', 'regulatory_risk', 'regulatory_note', 'red_flags'] as const;

export interface IngestLead {
  uid: string; lead_type: LeadTypeName; category: string; title: string;
  funder_buyer: string | null; country: string | null; deadline: string | null; amount: string | null;
  ref_no: string | null; url: string | null; source: string | null; summary: string | null;
  fit_score: number | null; priority: string | null; eligibility: string | null; partner_needed: string | null;
  suggested_partner: string | null; why_fit: string | null; risks: string | null; next_step: string | null;
  deadline_note: string | null; rfp_status: string | null; eligibility_reason: string | null; scope_gaps: string | null;
  scope_type: string | null; uses_our_product: string | null; business_model: string | null; business_model_note: string | null;
  regulatory_risk: string | null; regulatory_note: string | null; red_flags: string | null;
  found_on: string; origin: string;
}

/** Turn one row from the n8n crawler (same columns as the Google Sheet) into a lead row. */
export function normalizeIngestRow(row: Record<string, unknown>, today: string): { ok: true; lead: IngestLead } | { ok: false; reason: string } {
  if (!row || typeof row !== 'object') return { ok: false, reason: 'not an object' };
  const uid = text(row.uid, 200);
  const title = text(row.title, 500);
  if (!uid) return { ok: false, reason: 'missing uid' };
  if (!title) return { ok: false, reason: 'missing title' };
  const category = text(row.category, 100) || 'Uncategorised';
  const score = Number(row.fit_score);
  return {
    ok: true,
    lead: {
      uid, title, category,
      lead_type: deriveLeadType(category, title, text(row.lead_type, 20)),
      funder_buyer: text(row.funder_buyer, 300),
      country: text(row.country, 200),
      deadline: isoDate(row.deadline),
      amount: text(row.amount, 300),
      ref_no: text(row.ref_no, 200),
      url: httpUrl(row.url),
      source: text(row.source, 200),
      summary: text(row.summary),
      fit_score: row.fit_score === '' || row.fit_score == null || !Number.isFinite(score) ? null : Math.max(0, Math.min(100, Math.round(score))),
      priority: text(row.priority, 30),
      eligibility: text(row.eligibility, 100),
      partner_needed: text(row.partner_needed, 30),
      suggested_partner: text(row.suggested_partner, 300),
      why_fit: stripDaysLeft(text(row.why_fit)),
      risks: stripDaysLeft(text(row.risks)),
      next_step: stripDaysLeft(text(row.next_step)),
      deadline_note: text(row.deadline_note, 300),
      rfp_status: ONE_OF(row.rfp_status, ['Unknown', 'Available', 'Missing', 'Login needed', 'Requested', 'Received']),
      eligibility_reason: text(row.eligibility_reason, 500),
      scope_gaps: text(row.scope_gaps, 300),
      scope_type: text(row.scope_type, 60),
      uses_our_product: ONE_OF(row.uses_our_product, ['Yes', 'Partly', 'No', 'Unknown']),
      business_model: text(row.business_model, 60),
      business_model_note: text(row.business_model_note, 300),
      regulatory_risk: ONE_OF(row.regulatory_risk, ['Low', 'Medium', 'High', 'n/a', 'Unknown']),
      regulatory_note: text(row.regulatory_note, 400),
      red_flags: text(row.red_flags, 500),
      found_on: isoDate(row.found_on) || today,
      origin: text(row.origin, 20) === 'manual' ? 'manual' : 'crawler'
    }
  };
}

// Fields a later delivery may refresh on a lead that already exists (never the team's own fields).
export const REFRESHABLE = ['funder_buyer', 'country', 'amount', 'ref_no', 'url', 'summary', 'fit_score', 'priority', 'eligibility', 'partner_needed', 'suggested_partner', 'why_fit', 'risks', 'next_step', ...ASSESSMENT_FIELDS] as const;

/**
 * What to change on an existing lead.
 * - mode "insert" (the daily crawler): only move the deadline LATER (extensions / corrigenda) and fill empty fields.
 * - mode "update" (a reviewed JSON file): also overwrite assessment fields that the file provides, and set the
 *   deadline it gives; a Go / No-go decision is applied only while the lead is still Undecided.
 */
export function planUpdate(existing: Record<string, unknown>, incoming: IngestLead, row: Record<string, unknown>, mode: 'insert' | 'update'): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const given = (k: string) => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '';
  const oldD = existing.deadline ? String(existing.deadline).slice(0, 10) : null;
  const newD = incoming.deadline;
  if (newD && newD !== oldD && (mode === 'update' || !oldD || newD > oldD)) {
    patch.deadline = newD;
    patch.deadline_note = incoming.deadline_note || (oldD ? `Deadline moved from ${oldD} to ${newD} (${incoming.source || 'crawler'})` : null);
  } else if (mode === 'update' && given('deadline_note') && incoming.deadline_note !== (existing.deadline_note ?? null)) patch.deadline_note = incoming.deadline_note;
  for (const k of REFRESHABLE) {
    if (k === 'deadline_note') continue;
    const v = (incoming as unknown as Record<string, unknown>)[k];
    if (v === null || v === undefined || !given(k)) continue;
    if (k === 'rfp_status' && ['Requested', 'Received'].includes(String(existing.rfp_status))) continue; // the team's own progress wins
    const cur = existing[k];
    if (mode === 'update' ? cur !== v : (cur === null || cur === undefined || cur === '')) patch[k] = v;
  }
  if (mode === 'update' && (existing.decision ?? 'Undecided') === 'Undecided' && text(row.decision, 20) !== (existing.decision ?? 'Undecided')) {
    const d = text(row.decision, 20);
    if (d === 'Go' || d === 'No-go') { patch.decision = d; if (given('decision_reason')) patch.decision_reason = text(row.decision_reason, 1000); }
  }
  return patch;
}
