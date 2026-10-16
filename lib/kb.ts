// Knowledge base (update 4): full-text evidence search, document provenance, cited claims and claim review.
// Real mode: Supabase as the signed-in person — row-level security hides Restricted rows from roles without
// kb.read_restricted and the kb_search() function runs with the caller's rights. Demo mode applies the same rules in code.
// No AI or embedding provider is called here (see integration_settings.ai_provider, which is 'none').
import { cache } from 'react';
import { isDemo } from './env';
import { supabaseServer } from './supabase/server';
import { demo, saveDemo } from './demo';
import { check, getSession, NotAllowed, requirePerm } from './data';
import { can } from './perm';
import type { ClaimReview, ClaimStatus, KbClaim, KbDoc, KbEvidence, KbHit, Session } from './types';
import { CLAIM_REVIEW, CLAIM_STATUSES } from './types';

const now = () => new Date().toISOString();
const missing = (m: string) => /does not exist|schema cache|Could not find/i.test(m);
const visible = (s: Session | null, conf: string) => conf !== 'Restricted' || can(s, 'kb.read_restricted');

export interface KbStats {
  total: number; searchable: number; bySensitivity: Record<string, number>; byExtraction: Record<string, number>;
  excluded: number; duplicates: number; needsReview: number; installed: boolean;
}

/** Counts for the summary cards. `installed` is false before update-4.sql has been run. */
export const kbStats = cache(async (): Promise<KbStats> => {
  const s = await getSession();
  const empty: KbStats = { total: 0, searchable: 0, bySensitivity: {}, byExtraction: {}, excluded: 0, duplicates: 0, needsReview: 0, installed: true };
  if (!can(s, 'kb.read')) return empty;
  let rows: Pick<KbDoc, 'confidentiality' | 'extraction_status' | 'searchable' | 'excluded_reason' | 'duplicate_of_uid' | 'review_flags'>[];
  if (isDemo()) rows = demo().kb.filter(d => visible(s, d.confidentiality));
  else {
    const sb = await supabaseServer();
    rows = [];
    for (let from = 0; from < 20000; from += 1000) {
      const res = await sb.from('kb_documents').select('confidentiality,extraction_status,searchable,excluded_reason,duplicate_of_uid,review_flags').order('id').range(from, from + 999);
      if (res.error) { if (missing(res.error.message)) return { ...empty, installed: false }; throw new Error(res.error.message); }
      rows.push(...(res.data as typeof rows));
      if ((res.data || []).length < 1000) break;
    }
  }
  const out = { ...empty, total: rows.length };
  for (const r of rows) {
    out.bySensitivity[r.confidentiality] = (out.bySensitivity[r.confidentiality] || 0) + 1;
    const ex = r.extraction_status || 'entered by hand';
    out.byExtraction[ex] = (out.byExtraction[ex] || 0) + 1;
    if (r.searchable !== false) out.searchable++;
    if (r.excluded_reason) out.excluded++;
    if (r.duplicate_of_uid) out.duplicates++;
    if ((r.review_flags || []).length) out.needsReview++;
  }
  return out;
});

/** Ranked passages for a query. Returns [] for an empty query. */
export async function searchKb(q: string, opts: { entity?: string; category?: string; limit?: number } = {}): Promise<{ hits: KbHit[]; installed: boolean }> {
  const s = await getSession();
  if (!can(s, 'kb.read') || !q.trim()) return { hits: [], installed: true };
  if (isDemo()) {
    const st = demo(); const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1 && !/^(and|or|not|the)$/.test(w));
    const hits: KbHit[] = [];
    for (const e of st.kbEvidence || []) {
      const d = st.kb.find(x => x.id === e.document_id); if (!d || !visible(s, e.confidentiality)) continue;
      if (opts.entity && d.entity !== opts.entity) continue;
      const body = e.body.toLowerCase(); const score = words.filter(w => body.includes(w)).length;
      if (!score) continue;
      let snip = e.body; for (const w of words) snip = snip.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '«$1»');
      hits.push({ evidence_id: e.id, document_id: d.id, doc_name: d.name, entity: d.entity, category: d.category || d.doc_type, confidentiality: e.confidentiality, approval: d.approval, expires_on: d.expires_on, locator: e.locator, snippet: snip, rank: score / words.length });
    }
    return { hits: hits.sort((a, b) => b.rank - a.rank).slice(0, opts.limit || 50), installed: true };
  }
  const sb = await supabaseServer();
  const res = await sb.rpc('kb_search', { q, p_entity: opts.entity || null, p_category: opts.category || null, p_limit: opts.limit || 50 });
  if (res.error) { if (missing(res.error.message)) return { hits: [], installed: false }; throw new Error(res.error.message); }
  return { hits: (res.data || []) as KbHit[], installed: true };
}

/** One document with its passages and claims. null when it does not exist or the role may not see it. */
export async function getKbDoc(id: number): Promise<{ doc: KbDoc; evidence: KbEvidence[]; claims: KbClaim[]; duplicates: KbDoc[] } | null> {
  const s = await getSession();
  if (!can(s, 'kb.read')) return null;
  if (isDemo()) {
    const st = demo(); const doc = st.kb.find(d => d.id === id);
    if (!doc || !visible(s, doc.confidentiality)) return null;
    return { doc, evidence: (st.kbEvidence || []).filter(e => e.document_id === id), claims: (st.claims || []).filter(c => c.document_id === id), duplicates: [] };
  }
  const sb = await supabaseServer();
  const d = await sb.from('kb_documents').select('*').eq('id', id).maybeSingle();
  if (d.error) throw new Error(d.error.message);
  if (!d.data) return null;
  const doc = d.data as KbDoc;
  const [ev, cl, dup] = await Promise.all([
    sb.from('kb_evidence').select('id,document_id,locator,body,confidentiality,ocr').eq('document_id', id).order('id').limit(400),
    sb.from('kb_claims').select('*').eq('document_id', id).order('claim_type').limit(400),
    doc.sha256 ? sb.from('kb_documents').select('*').eq('sha256', doc.sha256).neq('id', id).limit(50) : Promise.resolve({ data: [], error: null })
  ]);
  return {
    doc,
    evidence: ev.error ? [] : (ev.data as KbEvidence[]),
    claims: cl.error ? [] : (cl.data as KbClaim[]),
    duplicates: dup.error ? [] : (dup.data as KbDoc[])
  };
}

export interface ClaimFilter { review?: string; status?: string; type?: string; entity?: string; conflicts?: boolean; q?: string; docId?: number }

/** Claims for the review screen and the evidence picker (newest documents first). */
export async function listClaims(f: ClaimFilter = {}, limit = 300): Promise<{ claims: (KbClaim & { doc_name?: string; doc_expires?: string | null })[]; installed: boolean }> {
  const s = await getSession();
  if (!can(s, 'kb.read')) return { claims: [], installed: true };
  if (isDemo()) {
    const st = demo();
    const rows = (st.claims || []).filter(c => visible(s, c.confidentiality)
      && (!f.review || c.review_status === f.review) && (!f.status || c.claim_status === f.status) && (!f.type || c.claim_type === f.type)
      && (!f.entity || c.entity === f.entity) && (!f.conflicts || !!c.conflict_group) && (!f.docId || c.document_id === f.docId)
      && (!f.q || c.statement.toLowerCase().includes(f.q.toLowerCase())));
    return { claims: rows.slice(0, limit).map(c => ({ ...c, doc_name: st.kb.find(d => d.id === c.document_id)?.name, doc_expires: st.kb.find(d => d.id === c.document_id)?.expires_on ?? null })), installed: true };
  }
  const sb = await supabaseServer();
  let q = sb.from('kb_claims').select('*, kb_documents(name, expires_on)').order('conflict_group', { ascending: true, nullsFirst: false }).order('id', { ascending: false }).limit(limit);
  if (f.review) q = q.eq('review_status', f.review);
  if (f.status) q = q.eq('claim_status', f.status);
  if (f.type) q = q.eq('claim_type', f.type);
  if (f.entity) q = q.eq('entity', f.entity);
  if (f.conflicts) q = q.not('conflict_group', 'is', null);
  if (f.docId) q = q.eq('document_id', f.docId);
  if (f.q) q = q.ilike('statement', `%${f.q.replace(/[%_]/g, '')}%`);
  const res = await q;
  if (res.error) { if (missing(res.error.message)) return { claims: [], installed: false }; throw new Error(res.error.message); }
  type Row = KbClaim & { kb_documents?: { name: string; expires_on: string | null } | null };
  return { claims: (res.data as Row[]).map(({ kb_documents, ...c }) => ({ ...c, doc_name: kb_documents?.name, doc_expires: kb_documents?.expires_on ?? null })), installed: true };
}

/** Claims by id (for showing linked evidence beside eligibility clauses). */
export async function claimsById(ids: number[]): Promise<Map<number, KbClaim & { doc_name?: string; doc_expires?: string | null }>> {
  const out = new Map<number, KbClaim & { doc_name?: string; doc_expires?: string | null }>();
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return out;
  const s = await getSession();
  if (!can(s, 'kb.read')) return out;
  if (isDemo()) {
    const st = demo();
    for (const c of st.claims || []) if (want.includes(c.id) && visible(s, c.confidentiality)) {
      const d = st.kb.find(x => x.id === c.document_id); out.set(c.id, { ...c, doc_name: d?.name, doc_expires: d?.expires_on ?? null });
    }
    return out;
  }
  const sb = await supabaseServer();
  const res = await sb.from('kb_claims').select('*, kb_documents(name, expires_on)').in('id', want);
  if (res.error) return out;
  for (const r of res.data as (KbClaim & { kb_documents?: { name: string; expires_on: string | null } | null })[]) {
    const { kb_documents, ...c } = r; out.set(c.id, { ...c, doc_name: kb_documents?.name, doc_expires: kb_documents?.expires_on ?? null });
  }
  return out;
}

/** A person confirms, rejects or queries a machine-proposed claim. "validated" needs a confirmation. */
export async function reviewClaim(id: number, review: ClaimReview, status: ClaimStatus | null, note: string | null): Promise<void> {
  const s = await requirePerm('kb.review_claims', 'review company claims');
  if (!(CLAIM_REVIEW as readonly string[]).includes(review)) throw new Error('Unknown review status.');
  if (status && !(CLAIM_STATUSES as readonly string[]).includes(status)) throw new Error('Unknown claim status.');
  if (status === 'validated' && review !== 'confirmed') throw new Error('Only a confirmed claim can be marked validated.');
  if ((review === 'rejected' || review === 'needs_info') && !note) throw new Error('Say why, so the next person knows what is wrong or missing.');
  if (isDemo()) {
    const st = demo(); const c = (st.claims || []).find(x => x.id === id);
    if (!c) throw new Error('Claim not found.');
    if (!visible(s, c.confidentiality)) throw new NotAllowed('Restricted claim.');
    Object.assign(c, { review_status: review, ...(status ? { claim_status: status } : {}), review_note: note, reviewed_by: s.user.id, reviewed_at: now(), updated_at: now() });
    saveDemo(st); return;
  }
  const sb = await supabaseServer();
  check(await sb.from('kb_claims').update({ review_status: review, ...(status ? { claim_status: status } : {}), review_note: note }).eq('id', id).select('id'));
}
