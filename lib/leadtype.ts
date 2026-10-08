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

export interface IngestLead {
  uid: string; lead_type: LeadTypeName; category: string; title: string;
  funder_buyer: string | null; country: string | null; deadline: string | null; amount: string | null;
  ref_no: string | null; url: string | null; source: string | null; summary: string | null;
  fit_score: number | null; priority: string | null; eligibility: string | null; partner_needed: string | null;
  suggested_partner: string | null; why_fit: string | null; risks: string | null; next_step: string | null;
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
      why_fit: text(row.why_fit),
      risks: text(row.risks),
      next_step: text(row.next_step),
      found_on: isoDate(row.found_on) || today,
      origin: 'crawler'
    }
  };
}
