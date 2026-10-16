// Spreadsheet import rules (pure functions; used by the import screen in the browser and checked on the server).
import type { LeadType, Stage } from './types';

export const IMPORT_FIELDS = [
  { key: 'title', label: 'Opportunity name', required: true, guess: /^(name of the project|project|opportunity|title|organi[sz]ations?|task)$/i },
  { key: 'category', label: 'Category / type', guess: /^(category|type|lead type)$/i },
  { key: 'amount_cr', label: 'Size in crore (number)', guess: /^size ?\(cr\.?\)$|^value \(cr/i },
  { key: 'amount', label: 'Value (text)', guess: /^(value|amount|total amount)$/i },
  { key: 'stage', label: 'Status / present state', guess: /^(present state|status|stage|completion status)$/i },
  { key: 'owner', label: 'Lead owner (name)', guess: /^(lead owner|owner|assigned to)$/i },
  { key: 'country', label: 'Geography', guess: /^(geography|country|state|location)$/i },
  { key: 'funder_buyer', label: 'Buyer / funder', guess: /^(buyer|funder|client|organi[sz]ation)$/i },
  { key: 'deadline', label: 'Deadline (date)', guess: /^(deadline|due date|closing date)$/i },
  { key: 'details', label: 'Details', guess: /^(details|opportunity details|description)$/i },
  { key: 'comments', label: 'Comments / updates', guess: /^(comments|updates|steps|notes)$/i },
  { key: 'partners', label: 'Partner(s)', guess: /^partner\(?s?\)?$/i },
  { key: 'url', label: 'Link', guess: /^(link|url)$/i },
  { key: 'ref_no', label: 'Tender reference', guess: /^(ref|reference|tender (id|no))/i }
] as const;
export type ImportKey = typeof IMPORT_FIELDS[number]['key'];
export type Mapping = Partial<Record<ImportKey, number>>;

/** The header row is the first row with at least three non-empty cells and a recognisable title column. */
export function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i] || [];
    if (r.filter(c => String(c || '').trim()).length >= 3 && r.some(c => IMPORT_FIELDS[0].guess.test(String(c || '').trim()))) return i;
  }
  return 0;
}

export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  header.forEach((h, i) => {
    const t = String(h || '').trim();
    for (const f of IMPORT_FIELDS) if (m[f.key] === undefined && f.guess.test(t)) { m[f.key] = i; break; }
  });
  return m;
}

const STAGE_MAP: [RegExp, Stage][] = [
  [/lead identified|identified|^new$/i, 'Identified'],
  [/under consideration|consider/i, 'Under consideration'],
  [/screen/i, 'Screening'],
  [/partner/i, 'Partnering'],
  [/in[- ]?process|in progress|preparing|in preparation|applying|assigned|exploring/i, 'In preparation'],
  [/submitted|applied/i, 'Submitted'],
  [/negotiat|clarification/i, 'Clarification'],
  [/won/i, 'Won'],
  [/lost/i, 'Lost'],
  [/bank/i, 'Banked'],
  [/drop|tank|no-?go/i, 'Dropped']
];
export function mapStage(v: string): Stage | null {
  const s = v.trim(); if (!s) return null;
  for (const [re, st] of STAGE_MAP) if (re.test(s)) return st;
  return null;
}

export function mapType(category: string): { lead_type: LeadType; category: string } {
  const c = category.trim();
  if (/csr/i.test(c)) return { lead_type: 'CSR', category: 'CSR - India' };
  if (/grant|award|foundation|cohort/i.test(c)) return { lead_type: 'Grant', category: /intl|international|overseas/i.test(c) ? 'International Grant' : 'Innovation Grant - India' };
  if (/overseas|international|intl/i.test(c)) return { lead_type: 'Tender', category: 'Intl Govt Tender (partner-led)' };
  if (/rfp|eoi|rfq/i.test(c)) return { lead_type: 'RFP / EOI', category: 'Govt Tender - India' };
  return { lead_type: 'Tender', category: 'Govt Tender - India' };
}

/** Workbook size buckets: Small (<=50 L), Medium (>50 L to 2 Cr), Large (>2 Cr). */
export function valueBand(crore: number | null): string | null {
  if (crore == null || !Number.isFinite(crore) || crore <= 0) return null;
  return crore <= 0.5 ? 'Up to ₹50 lakh' : crore <= 2 ? '₹50 lakh–₹2 crore' : 'Above ₹2 crore';
}

function excelDate(v: string): string | null {
  const s = v.trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

export interface ImportRow {
  line: number; title: string; lead_type: LeadType; category: string; stage: Stage | null; stageRaw: string;
  amount: string | null; value_band: string | null; owner: string | null; country: string | null; funder_buyer: string | null;
  deadline: string | null; summary: string | null; partners: string | null; url: string | null; ref_no: string | null; problems: string[];
}

export function buildRows(rows: string[][], header: number, m: Mapping): ImportRow[] {
  const get = (r: string[], k: ImportKey) => (m[k] === undefined ? '' : String(r[m[k]!] ?? '').replace(/\s+/g, ' ').trim());
  const out: ImportRow[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const title = get(r, 'title');
    if (!title || /^total$/i.test(title) || /^classification by/i.test(title) || /^(won|lost) leads$/i.test(title)) continue;
    if (/^s\.? ?no\.?$/i.test(String(r[0] || '').trim()) || IMPORT_FIELDS[0].guess.test(title)) continue;     // a repeated header row
    if (/^\d+(\.\d+)?$/.test(get(r, 'category'))) continue;                                                    // summary tables (count / amount columns)
    const problems: string[] = [];
    const t = mapType(get(r, 'category'));
    const stageRaw = get(r, 'stage');
    const stage = mapStage(stageRaw);
    if (stageRaw && !stage) problems.push(`Unknown status “${stageRaw}” — will start as Identified`);
    const crRaw = get(r, 'amount_cr').replace(/,/g, '');
    const cr = crRaw && Number.isFinite(Number(crRaw)) ? Number(crRaw) : null;
    if (crRaw && cr === null) problems.push(`Size “${crRaw}” is not a number`);
    const amountText = get(r, 'amount');
    const dl = get(r, 'deadline'); const deadline = excelDate(dl);
    if (dl && !deadline) problems.push(`Deadline “${dl}” is not a date`);
    const url = get(r, 'url');
    const details = [get(r, 'details'), get(r, 'comments') && `Comments: ${get(r, 'comments')}`].filter(Boolean).join(' · ');
    out.push({
      line: i + 1, title, ...t, stage, stageRaw,
      amount: cr !== null ? `₹${cr} Cr (workbook estimate)` : amountText || null, value_band: valueBand(cr),
      owner: get(r, 'owner') || null, country: get(r, 'country') || null, funder_buyer: get(r, 'funder_buyer') || null,
      deadline, summary: details || null, partners: get(r, 'partners') && !/^none$/i.test(get(r, 'partners')) ? get(r, 'partners') : null,
      url: /^https?:\/\//i.test(url) ? url : null, ref_no: get(r, 'ref_no') || null, problems
    });
  }
  return out;
}
