import Link from 'next/link';
import { notFound } from 'next/navigation';
import { claimReviewAction } from '@/app/actions';
import { Badge, Denied, Empty, Notes, PageHead } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { getKbDoc } from '@/lib/kb';
import { daysLeft, fmtDate, fmtDateTime, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { CLAIM_REVIEW, CLAIM_STATUSES } from '@/lib/types';

export const metadata = { title: 'Evidence document' };
type P = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;
const size = (n: number | null | undefined) => (n == null ? '—' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default async function KbDocPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!can(session, 'kb.read')) return <><PageHead title="Evidence document" /><Denied>Your role cannot see the company evidence library.</Denied></>;
  const got = await getKbDoc(Number(id));
  if (!got) {
    // Not found, or row-level security hid it (restricted). Do not reveal which.
    if (!can(session, 'kb.read_restricted')) return <><PageHead title="Evidence document" crumbs={[{ href: '/knowledge', label: 'Knowledge base' }]} /><Denied>This record does not exist or is restricted (financial, statutory, banking, personal or partner-confidential). Roles with “See financial, statutory, banking and personal documents” can open restricted records.</Denied></>;
    notFound();
  }
  const { doc: d, evidence, claims, duplicates } = got;
  const members = await listMembers();
  const x = daysLeft(d.expires_on);
  const reviewer = can(session, 'kb.review_claims');
  const ret = `/knowledge/${d.id}`;
  return (
    <>
      <PageHead eyebrow={`Knowledge base · ${d.entity}`} title={d.name} crumbs={[{ href: '/knowledge', label: 'Knowledge base' }]}>
        {d.summary || 'Provenance, extracted passages and cited claims for this document.'}
      </PageHead>
      <Notes sp={sp} />
      {d.excluded_reason ? <div className="note err"><span><b>Excluded from search and AI processing:</b> {d.excluded_reason}. Only this metadata is kept; no text was stored.</span></div> : null}
      {d.duplicate_of_uid ? <div className="note"><span>This is a duplicate copy (same SHA-256 as document {d.duplicate_of_uid}). Its text is searched through the original only.</span></div> : null}
      <section className="card" aria-labelledby="pv-h">
        <header><div><h2 id="pv-h">Provenance</h2><p>Where the file came from and what the ingestion did with it. The source file itself was not changed.</p></div>
          <span className="inline" style={{ gap: 6 }}>{d.confidentiality === 'Restricted' ? <Badge tone="bad">Restricted</Badge> : d.confidentiality === 'Confidential' ? <Badge tone="warn">Confidential</Badge> : <Badge tone="neu">Internal</Badge>}<Badge tone={d.approval === 'Approved' ? 'ok' : 'q'}>{d.approval}</Badge></span>
        </header>
        <dl className="facts">
          <div><dt>Document ID</dt><dd className="mono-sm">{d.doc_uid || `#${d.id} (entered by hand)`}</dd></div>
          <div><dt>Entity</dt><dd>{d.entity}{d.entity === 'Unresolved' ? <div className="sub" style={{ color: 'var(--warning-text)' }}>Owning entity not resolved — set it before use.</div> : null}</dd></div>
          <div><dt>Type · category</dt><dd>{d.doc_type}{d.category ? ` · ${d.category}` : ''}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt>Source path</dt><dd className="mono-sm" style={{ wordBreak: 'break-all' }}>{d.container_path ? <>{d.container_path} <span className="muted">›</span> </> : null}{d.source_path || d.location || '—'}</dd></div>
          <div><dt>File</dt><dd>{d.file_type ? d.file_type.toUpperCase() : '—'} · {size(d.size_bytes)}</dd></div>
          <div style={{ gridColumn: 'span 2' }}><dt>SHA-256</dt><dd className="mono-sm" style={{ wordBreak: 'break-all' }}>{d.sha256 || '—'}</dd></div>
          <div><dt>Version · date</dt><dd>{d.version || '—'}{d.doc_date ? ` · ${fmtDate(d.doc_date)}` : ''}</dd></div>
          <div><dt>Expiry</dt><dd>{d.expires_on ? x !== null && x < 0 ? <Badge tone="bad" icon="!">Expired {fmtDate(d.expires_on)}</Badge> : fmtDate(d.expires_on) : d.expiry_text ? <>Not confirmed. Text found: “{d.expiry_text}”</> : '—'}</dd></div>
          <div><dt>Sensitivity reason</dt><dd>{d.sensitivity_reason || '—'}</dd></div>
          <div><dt>Extraction</dt><dd>{d.extraction_status ? d.extraction_status.replace(/_/g, ' ') : 'entered by hand'}{d.extraction_notes ? <div className="sub">{d.extraction_notes}</div> : null}</dd></div>
          <div><dt>Processed</dt><dd>{d.processed_at ? fmtDateTime(d.processed_at) : '—'}{d.processing_version ? <div className="sub mono-sm">{d.processing_version}</div> : null}</dd></div>
          <div><dt>Flags</dt><dd>{(d.review_flags || []).length ? (d.review_flags || []).map(f => <span key={f} className="mini-chip">{f.startsWith('pii:') ? 'identifiers detected' : f.replace(/_/g, ' ')}</span>) : '—'}</dd></div>
          <div><dt>Owner</dt><dd>{nameOf(members, d.owner) || '—'}</dd></div>
          {d.drive_url ? <div><dt>Google Drive</dt><dd><a href={d.drive_url} target="_blank" rel="noreferrer">Open ↗</a></dd></div> : null}
        </dl>
        {duplicates.length ? <p className="hint-text" style={{ margin: 0 }}>Same content also at: {duplicates.map(o => <Link key={o.id} href={`/knowledge/${o.id}`} className="mini-chip">{(o.container_path ? o.container_path + ' › ' : '') + (o.source_path || o.name)}</Link>)}</p> : null}
      </section>

      <section className="card" aria-labelledby="cl-h">
        <header><div><h2 id="cl-h">Claims from this document</h2><p>Proposed by the extraction script; each one cites a location. A reviewer confirms or rejects them.</p></div><Badge tone="neu">{claims.length}</Badge></header>
        {claims.length ? <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>#</th><th>Statement</th><th>Where</th><th>Status</th><th>Review</th>{reviewer ? <th /> : null}</tr></thead>
          <tbody>{claims.map(c => (
            <tr key={c.id} id={`c${c.id}`}>
              <td className="mono-sm">{c.id}</td>
              <td className="t">“{c.statement}”{c.conflict_group ? <div className="sub" style={{ color: 'var(--warning-text)' }}>Disagrees with other documents (group {c.conflict_group}) — <Link href={`/knowledge?view=claims&all=1&conflicts=1`}>compare</Link></div> : null}</td>
              <td className="mono-sm">{c.locator}</td>
              <td><Badge tone={c.claim_status === 'validated' ? 'ok' : c.claim_status === 'expired' ? 'bad' : 'q'}>{c.claim_status}</Badge></td>
              <td>{c.review_status.replace('_', ' ')}{c.review_note ? <div className="sub">{c.review_note}</div> : null}</td>
              {reviewer ? <td><form action={claimReviewAction} className="inline" style={{ gap: 4, flexWrap: 'wrap' }}>
                <input type="hidden" name="claim" value={c.id} /><input type="hidden" name="return" value={ret} />
                <select name="review" defaultValue={c.review_status === 'pending' ? 'confirmed' : c.review_status} aria-label="Review">{CLAIM_REVIEW.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select>
                <select name="status" defaultValue={c.claim_status} aria-label="Claim status">{CLAIM_STATUSES.map(r => <option key={r}>{r}</option>)}</select>
                <input type="text" name="note" placeholder="Note" aria-label="Note" />
                <button className="btn btn-sm" type="submit">Save</button>
              </form></td> : null}
            </tr>
          ))}</tbody>
        </table></div> : <Empty title="No claims extracted">The script found no claim-like sentence, or the document text was not extracted.</Empty>}
      </section>

      <section className="card" aria-labelledby="ev-h">
        <header><div><h2 id="ev-h">Extracted passages</h2><p>Text as extracted, with its location. OCR text may contain errors: check figures against the original.</p></div><Badge tone="neu">{evidence.length}{evidence.length >= 400 ? '+' : ''}</Badge></header>
        {evidence.length ? <ol className="hits">{evidence.map(e => (
          <li key={e.id} id={`e${e.id}`}><div className="sub mono-sm">{e.locator}{e.ocr ? ' · OCR' : ''}</div><p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{e.body}</p></li>
        ))}</ol> : <Empty title="No text stored">{d.excluded_reason ? 'Excluded documents never have text stored.' : 'Either the document has no extractable text (scan without OCR, image, media) or it was entered by hand.'}</Empty>}
      </section>
    </>
  );
}
