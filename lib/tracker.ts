// Lead Tracker (update 5): the BD workbook's statuses, categories and size buckets, computed from the CRM's own fields.
// The CRM stage stays the source of truth; these are views of it, so the board and the detailed pipeline never disagree.
import type { Lead, Stage } from './types';

export const TRACKER_STATUSES = ['Lead Identified', 'Under Consideration', 'In Process', 'Negotiation', 'Won', 'Lost', 'No-Go', 'Tanked'] as const;
export type TrackerStatus = typeof TRACKER_STATUSES[number];
export const BOARD_STATUSES: TrackerStatus[] = ['Lead Identified', 'Under Consideration', 'In Process', 'Negotiation', 'Won'];
export const CLOSED_TRACKER: TrackerStatus[] = ['Lost', 'No-Go', 'Tanked'];

/** Stage colours from the design system (background / text). */
export const STATUS_COLOR: Record<TrackerStatus, { bg: string; fg: string }> = {
  'Lead Identified': { bg: '#BFE77D', fg: '#233804' },
  'Under Consideration': { bg: '#BFE77D', fg: '#233804' },
  'In Process': { bg: '#A6C7FF', fg: '#0B2D6B' },
  'Negotiation': { bg: '#FED591', fg: '#5C3500' },
  'Won': { bg: '#C6BBF9', fg: '#2E1E6B' },
  'Lost': { bg: '#D0D5DD', fg: '#344054' },
  'No-Go': { bg: '#98A2B3', fg: '#101828' },
  'Tanked': { bg: '#E0261B', fg: '#FFFFFF' }
};

const FROM_STAGE: Record<Stage, TrackerStatus> = {
  Identified: 'Lead Identified', Screening: 'Lead Identified',
  'Under consideration': 'Under Consideration', Partnering: 'Under Consideration',
  'In preparation': 'In Process', Submitted: 'In Process',
  Clarification: 'Negotiation', Won: 'Won', Lost: 'Lost', Dropped: 'No-Go', Banked: 'Tanked'
};
/** The CRM stage a board move sets. "In Process" needs an approved Go (the same rule as the stage menu). */
export const TO_STAGE: Record<TrackerStatus, Stage> = {
  'Lead Identified': 'Identified', 'Under Consideration': 'Under consideration', 'In Process': 'In preparation',
  'Negotiation': 'Clarification', 'Won': 'Won', 'Lost': 'Lost', 'No-Go': 'Dropped', 'Tanked': 'Banked'
};

export function trackerStatus(l: Pick<Lead, 'stage' | 'decision'>): TrackerStatus {
  if (l.decision === 'No-go' && !['Won', 'Lost', 'Banked'].includes(l.stage)) return 'No-Go';
  return FROM_STAGE[l.stage] || 'Lead Identified';
}

export const TRACKER_CATEGORIES = ['Govt. Business (Non-CSR)', 'CSR Project', 'Grant or Award', 'Overseas thru Partner', 'Cohort & Private'] as const;
export type TrackerCategory = typeof TRACKER_CATEGORIES[number];
export function trackerCategory(l: Pick<Lead, 'lead_type' | 'category'>): TrackerCategory {
  const c = (l.category || '').toLowerCase();
  if (l.lead_type === 'CSR' || /csr/.test(c)) return 'CSR Project';
  if (l.lead_type === 'Grant' || /grant|award|foundation/.test(c)) return 'Grant or Award';
  if (/intl|international|overseas|partner-led/.test(c)) return 'Overseas thru Partner';
  if (/cohort|private|individual/.test(c)) return 'Cohort & Private';
  return 'Govt. Business (Non-CSR)';
}

/** Value in crore from the free-text amount ("₹22 Cr", "INR 31.42 Lakhs", "Rs 1,20,00,000"). null when unknown. */
export function crore(amount: string | null | undefined): number | null {
  if (!amount) return null;
  const s = amount.replace(/,/g, '').toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|lac|k|thousand|million|mn|m)?\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]); const u = m[2] || '';
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/^(cr|crore|crores)$/.test(u)) return n;
  if (/^(l|lakh|lakhs|lac)$/.test(u)) return n / 100;
  if (/^(million|mn|m)$/.test(u)) return /usd|\$|eur|€|gbp|£/.test(s) ? null : n / 10;
  if (/^(k|thousand)$/.test(u)) return n / 1e4;
  if (/inr|rs|₹/.test(s) && n >= 1e5) return n / 1e7;
  return null;
}

export const SIZE_BUCKETS = ['Small (≤ ₹50 L)', 'Medium (₹50 L – ₹2 Cr)', 'Large (> ₹2 Cr)', 'Not estimated'] as const;
export type SizeBucket = typeof SIZE_BUCKETS[number];
export function sizeBucket(l: Pick<Lead, 'value_band' | 'amount'>): SizeBucket {
  if (l.value_band === 'Up to ₹50 lakh') return 'Small (≤ ₹50 L)';
  if (l.value_band === '₹50 lakh–₹2 crore') return 'Medium (₹50 L – ₹2 Cr)';
  if (l.value_band === 'Above ₹2 crore') return 'Large (> ₹2 Cr)';
  const c = crore(l.amount);
  if (c == null) return 'Not estimated';
  return c <= 0.5 ? 'Small (≤ ₹50 L)' : c <= 2 ? 'Medium (₹50 L – ₹2 Cr)' : 'Large (> ₹2 Cr)';
}

export function fmtCr(n: number): string {
  if (!n) return '₹0 Cr';
  return n >= 100 ? `₹${Math.round(n)} Cr` : `₹${Number(n.toFixed(2))} Cr`;
}
