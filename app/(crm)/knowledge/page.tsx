import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { claimReviewAction, kbAction } from '@/app/actions';
import { Badge, Denied, Empty, Notes, PageHead } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { listKb, listRequirements } from '@/lib/data-ext';
import { kbStats, listClaims, searchKb } from '@/lib/kb';
import { daysLeft, fmtDate, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { CLAIM_REVIEW, CLAIM_STATUSES, KB_CONFIDENTIALITY, KB_ENTITIES, KB_TYPES, type KbDoc } from '@/lib/types';

export const metadata = { title: 'Knowledge base' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
const PAGE = 100;

/** Splits ts_headline output («term») into text and <mark> without using raw HTML. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return <>{parts.map((p, i) => p.startsWith('«') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</>;
}

function SensBadge({ d }: { d: Pick<KbDoc, 'confidentiality' | 'excluded_reason'> }) {
  if (d.excluded_reason) return <Badge tone="bad" icon="⦸" title={d.excluded_reason}>Excluded</Badge>;
  return d.confidentiality === 'Restricted' ? <Badge tone="bad" icon="🔒">Restricted</Badge> : d.confidentiality === 'Confidential' ? <Badge tone="warn">Confidential</Badge> : <Badge tone="neu">Internal</Badge>;
}

export default async function KnowledgePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = one(sp.view) || 'documents';
  const q = one(sp.q).trim(), ent = one(sp.entity), ty = one(sp.type), state = one(sp.state), sens = one(sp.sens), ex = one(sp.ex);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [session, { docs, hiddenRestricted }, members, reqs, stats] = await Promise.all([getSession(), listKb(), listMembers(), listRequirements(), kbStats()]);
  if (!can(session, 'kb.read')) return <><PageHead title="Knowledge base" /><Denied>Your role cannot see the company evidence library. Ask an administrator for the “See company evidence” permission.</Denied></>;
  const search = view === 'documents' && q ? await searchKb(q, { entity: ent || undefined }) : { hits: [], installed: stats.installed };
  const claimF = { review: one(sp.review) || (view === 'claims' && !one(sp.all) ? 'pending' : ''), status: one(sp.cstatus), type: one(sp.ctype), entity: ent, conflicts: one(sp.conflicts) === '1', q: view === 'claims' ? q : '' };
  const claims = view === 'claims' ? await listClaims(claimF) : { claims: [], installed: stats.installed };
  const ql = q.toLowerCase();
  const rows = docs.filter(d => (!ql || [d.name, d.tags, d.summary, d.doc_type, d.source_path, d.category].join(' ').toLowerCase().includes(ql)) && (!ent || d.entity === ent) && (!ty || d.doc_type === ty)
    && (!sens || (sens === 'Excluded' ? !!d.excluded_reason : d.confidentiality === sens && !d.excluded_reason))
    && (!ex || (ex === 'review' ? (d.review_flags || []).length > 0 : (d.extraction_status || 'entered by hand') === ex))
    && (!state || (state === 'expired' ? (daysLeft(d.expires_on) ?? 1) < 0 : state === 'soon' ? ((daysLeft(d.expires_on) ?? 999) >= 0 && (daysLeft(d.expires_on) ?? 999) <= 30) : d.approval === state)));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const used = (id: number) => reqs.filter(r => r.evidence_doc === id).length;
  const expired = docs.filter(d => (daysLeft(d.expires_on) ?? 1) < 0).length;
  const soon = docs.filter(d => { const x = daysLeft(d.expires_on); return x !== null && x >= 0 && x <= 30; }).length;
  const qs = (patch: Record<string, string>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ view, q, entity: ent, type: ty, state, sens, ex, ...patch })) if (v) u.set(k, v); return `/knowledge?${u}`; };
  const reviewer = can(session, 'kb.review_claims');
  return (
    <>
      <PageHead eyebrow="Network & evidence" title="Knowledge base" crumbs={[{ href: '/', label: 'Dashboard' }]} tools={<ExportMenu kind="knowledge" params={sp} canExport={can(session, 'opp.export')} />}>
        Company evidence for bids, with the source of every statement: document, page, sheet or slide. NCPL, ReMeDi Foundation and RKF documents are not interchangeable.
      </PageHead>
      <Notes sp={sp} />
      <div className="note warn"><span>Never store patient clinical data, passwords, private keys or other secrets here. Documents detected as patient-related or secret are listed as <b>Excluded</b>: their text is not stored, searched or sent anywhere. No AI or embedding service is used.</span></div>
      {!stats.installed ? <div className="note"><span>Search, provenance and claims need <span className="mono-sm">supabase/update-4.sql</span>. Until then this page shows the evidence records only.</span></div> : null}

      <nav className="rtabs" aria-label="Knowledge base views">
        <Link className="rtab" href="/knowledge" aria-current={view === 'documents' ? 'page' : undefined}>Documents & search</Link>
        <Link className="rtab" href="/knowledge?view=claims" aria-current={view === 'claims' ? 'page' : undefined}>Claims to review</Link>
      </nav>

      {view === 'documents' ? <>
        <div className="stats">
          <Link className="stat" href={qs({ state: 'Approved', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Approved for bids</small><b>{docs.filter(d => d.approval === 'Approved').length}</b></Link>
          <Link className="stat" href={qs({ state: 'Draft', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Draft — needs approval</small><b>{docs.filter(d => d.approval === 'Draft').length}</b></Link>
          <Link className="stat" href={qs({ ex: 'review', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Flagged for a person</small><b style={{ color: stats.needsReview ? 'var(--warning-text)' : undefined }}>{stats.needsReview}</b></Link>
          <Link className="stat" href={qs({ state: 'soon', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Expiring in 30 days</small><b style={{ color: soon ? 'var(--warning-text)' : undefined }}>{soon}</b></Link>
          <Link className="stat" href={qs({ state: 'expired', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Expired</small><b style={{ color: expired ? 'var(--critical-text)' : undefined }}>{expired}</b></Link>
          <Link className="stat" href={qs({ sens: 'Excluded', page: '' })} style={{ color: 'inherit', textDecoration: 'none' }}><small>Excluded (no text kept)</small><b>{stats.excluded}</b></Link>
        </div>
        <form method="get" className="filters" aria-label="Search evidence">
          <input type="search" name="q" defaultValue={q} placeholder='Search text: e.g. ISO 13485, "turnover", CE certificate…' aria-label="Search" />
          <select name="entity" defaultValue={ent} aria-label="Entity"><option value="">Any entity</option>{KB_ENTITIES.map(e => <option key={e}>{e}</option>)}</select>
          <select name="type" defaultValue={ty} aria-label="Type"><option value="">Any type</option>{KB_TYPES.map(e => <option key={e}>{e}</option>)}</select>
          <select name="sens" defaultValue={sens} aria-label="Sensitivity"><option value="">Any sensitivity</option>{KB_CONFIDENTIALITY.map(e => <option key={e}>{e}</option>)}<option>Excluded</option></select>
          <select name="ex" defaultValue={ex} aria-label="Extraction"><option value="">Any extraction result</option>{Object.keys(stats.byExtraction).sort().map(e => <option key={e} value={e}>{e} ({stats.byExtraction[e]})</option>)}<option value="review">Flagged for review</option></select>
          <button className="btn btn-primary" type="submit">Search</button><Link className="btn" href="/knowledge">Clear</Link>
        </form>
        {hiddenRestricted ? <Denied>{hiddenRestricted} restricted record(s) (financial, statutory, banking or personal) are hidden for your role.</Denied> : null}

        {q ? (
          <section className="card" aria-labelledby="hits-h">
            <header><div><h2 id="hits-h">Passages matching “{q}”</h2><p>Full-text search over extracted text. Each result cites its document and location. {can(session, 'kb.read_restricted') ? '' : 'Restricted passages are not searched for your role.'}</p></div><Badge tone="neu">{search.hits.length} found</Badge></header>
            {!search.installed ? <p className="muted" style={{ margin: 0 }}>Text search is available after update-4.sql and the document loader have run.</p>
              : search.hits.length ? (
                <ol className="hits">{search.hits.map(h => (
                  <li key={h.evidence_id}>
                    <div className="inline" style={{ justifyContent: 'space-between', gap: 8 }}><Link href={`/knowledge/${h.document_id}#e${h.evidence_id}`}><b>{h.doc_name}</b></Link><span className="inline" style={{ gap: 6 }}><SensBadge d={{ confidentiality: h.confidentiality, excluded_reason: null }} /><Badge tone={h.approval === 'Approved' ? 'ok' : 'q'}>{h.approval}</Badge></span></div>
                    <div className="sub">{h.entity} · {h.category || '—'} · <span className="mono-sm">{h.locator}</span>{h.expires_on && (daysLeft(h.expires_on) ?? 1) < 0 ? <> · <span style={{ color: 'var(--critical-text)' }}>expired {fmtDate(h.expires_on)}</span></> : null}</div>
                    <p className="quote" style={{ margin: '4px 0 0' }}><Snippet text={h.snippet} /></p>
                  </li>
                ))}</ol>
              ) : <Empty title="No passage matches">Try fewer or different words, quotes for an exact phrase, or remove the entity filter. Passages from documents whose text could not be extracted are not searchable — see “Flagged for a person”.</Empty>}
          </section>
        ) : null}

        {q && !rows.length ? null : <section className="tbl-card">
          {q ? <header style={{ padding: '10px 12px 0' }}><b>Documents whose name, path or tags match</b></header> : null}
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Document</th><th>Entity</th><th>Type</th><th>Sensitivity</th><th>Text</th><th>Version · expiry</th><th>Status</th><th>Used in</th></tr></thead>
            <tbody>{shown.map(d => {
              const x = daysLeft(d.expires_on);
              return (
                <tr key={d.id}>
                  <td className="t" style={{ minWidth: 240 }}><Link href={`/knowledge/${d.id}`}><b>{d.name}</b></Link>{d.duplicate_of_uid ? <> <Badge tone="neu">Duplicate copy</Badge></> : null}{d.summary ? <div className="sub">{d.summary}</div> : null}{d.source_path || d.location ? <div className="sub mono-sm" style={{ wordBreak: 'break-all' }}>{d.container_path ? `${d.container_path} › ` : ''}{d.source_path || d.location}</div> : null}</td>
                  <td>{d.entity}</td><td>{d.doc_type}{d.category ? <div className="sub">{d.category}</div> : null}</td>
                  <td><SensBadge d={d} /></td>
                  <td className="sub">{d.extraction_status ? <>{d.extraction_status.replace(/_/g, ' ')}{(d.review_flags || []).length ? <div style={{ color: 'var(--warning-text)' }}>needs a look</div> : null}</> : 'entered by hand'}</td>
                  <td className="mono-sm">{d.version || '—'}<br />{d.expires_on ? x !== null && x < 0 ? <Badge tone="bad" icon="!">Expired {fmtDate(d.expires_on)}</Badge> : x !== null && x <= 30 ? <Badge tone="warn">Expires {fmtDate(d.expires_on)}</Badge> : fmtDate(d.expires_on) : d.expiry_text ? <span title="Validity text found in the document; confirm and enter the date">“{d.expiry_text}”?</span> : '—'}</td>
                  <td><Badge tone={d.approval === 'Approved' ? 'ok' : d.approval === 'Draft' ? 'q' : 'neu'}>{d.approval}</Badge><div className="sub">{nameOf(members, d.owner) || ''}</div></td>
                  <td className="r">{used(d.id) ? `${used(d.id)} clause(s)` : <span className="muted">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {!rows.length ? <Empty title="No documents match">Clear a filter, or add an evidence record below.</Empty> : null}
          {rows.length > PAGE ? (
            <nav className="pager" aria-label="Pages">
              <span className="muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} of {rows.length}</span>
              {page > 1 ? <Link className="btn btn-sm" href={qs({ page: String(page - 1) })}>← Previous</Link> : null}
              {page * PAGE < rows.length ? <Link className="btn btn-sm" href={qs({ page: String(page + 1) })}>Next →</Link> : null}
            </nav>
          ) : null}
        </section>}

        {can(session, 'kb.edit') ? (
          <details className="drawer">
            <summary>+ Add an evidence record by hand</summary>
            <form action={kbAction} className="body stack">
              <div className="two"><label className="fld">Name <span className="req">*</span><input type="text" name="name" required /></label><label className="fld">Entity <span className="req">*</span><select name="entity" defaultValue="NCPL">{KB_ENTITIES.map(e => <option key={e}>{e}</option>)}</select></label></div>
              <div className="two"><label className="fld">Type<select name="doc_type" defaultValue="Credential / certificate">{KB_TYPES.map(e => <option key={e}>{e}</option>)}</select></label><label className="fld">Owner<select name="owner" defaultValue={session!.user.id}>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label></div>
              <div className="two"><label className="fld">Document date<input type="date" name="doc_date" /></label><label className="fld">Expires<input type="date" name="expires_on" /></label></div>
              <div className="two"><label className="fld">Version<input type="text" name="version" /></label><label className="fld">Sensitivity<select name="confidentiality" defaultValue="Internal"><option>Internal</option>{stats.installed ? <option>Confidential</option> : null}{can(session, 'kb.read_restricted') ? <option>Restricted</option> : null}</select></label></div>
              <label className="fld">Where the file lives<input type="text" name="location" placeholder="Folder path or document link" /></label>
              <label className="fld">Tags<input type="text" name="tags" placeholder="e.g. turnover, eligibility, ISO" /></label>
              <label className="fld">Summary<textarea name="summary" rows={2} /></label>
              <label className="fld">Approval<select name="approval" defaultValue="Draft"><option>Draft</option>{can(session, 'kb.approve') ? <option>Approved</option> : null}<option>Superseded</option></select></label>
              <div><button className="btn btn-primary" type="submit">Add record</button></div>
            </form>
          </details>
        ) : null}
      </> : null}

      {view === 'claims' ? <>
        <p className="muted" style={{ margin: 0 }}>Each claim is one sentence copied from a document, with its page, sheet or slide. Claims are machine-proposed: nothing is “validated” until a reviewer confirms it. Where documents disagree, the claims share a conflict group and all versions are kept for a person to resolve.</p>
        <form method="get" className="filters" aria-label="Filter claims">
          <input type="hidden" name="view" value="claims" />
          <input type="search" name="q" defaultValue={q} placeholder="Words in the claim…" aria-label="Search claims" />
          <select name="review" defaultValue={claimF.review} aria-label="Review"><option value="">Any review state</option>{CLAIM_REVIEW.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select>
          <select name="cstatus" defaultValue={claimF.status} aria-label="Claim status"><option value="">Any claim status</option>{CLAIM_STATUSES.map(r => <option key={r}>{r}</option>)}</select>
          <select name="ctype" defaultValue={claimF.type} aria-label="Claim type"><option value="">Any type</option>{['certification', 'registration', 'financial', 'reach', 'performance', 'partnership', 'deployment', 'award'].map(t => <option key={t}>{t}</option>)}</select>
          <select name="entity" defaultValue={ent} aria-label="Entity"><option value="">Any entity</option>{KB_ENTITIES.map(e => <option key={e}>{e}</option>)}</select>
          <label className="inline" style={{ gap: 4 }}><input type="checkbox" name="conflicts" value="1" defaultChecked={claimF.conflicts} /> Conflicts only</label>
          <input type="hidden" name="all" value="1" />
          <button className="btn btn-primary" type="submit">Filter</button><Link className="btn" href="/knowledge?view=claims">Reset</Link>
        </form>
        {!claims.installed ? <Empty title="Claims are not installed">Run update-4.sql and load an ingest run with scripts/kb_ingest/load_supabase.py.</Empty> : claims.claims.length ? (
          <section className="tbl-card"><div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>#</th><th>Claim and citation</th><th>Type</th><th>Status</th><th>Review</th>{reviewer ? <th>Reviewer action</th> : null}</tr></thead>
            <tbody>{claims.claims.map(c => (
              <tr key={c.id} id={`c${c.id}`}>
                <td className="mono-sm">{c.id}</td>
                <td className="t" style={{ minWidth: 300 }}>“{c.statement}”<div className="sub"><Link href={`/knowledge/${c.document_id}#c${c.id}`}>{c.doc_name || 'source'}</Link> · <span className="mono-sm">{c.locator}</span> · {c.entity}{c.conflict_group ? <> · <Link href={`/knowledge?view=claims&conflicts=1&all=1&q=`} title="Other claims in this group disagree">conflict {c.conflict_group}</Link></> : null}</div>{c.confidentiality === 'Restricted' ? <Badge tone="bad">Restricted</Badge> : null}</td>
                <td>{c.claim_type}{c.subject ? <div className="sub">{c.subject}{c.value != null ? `: ${c.value.toLocaleString('en-IN')}` : ''}</div> : null}</td>
                <td><Badge tone={c.claim_status === 'validated' ? 'ok' : c.claim_status === 'expired' ? 'bad' : c.claim_status === 'unverified' ? 'q' : 'info'}>{c.claim_status}</Badge></td>
                <td><Badge tone={c.review_status === 'confirmed' ? 'ok' : c.review_status === 'rejected' ? 'bad' : c.review_status === 'needs_info' ? 'warn' : 'neu'}>{c.review_status.replace('_', ' ')}</Badge>{c.review_note ? <div className="sub">{c.review_note}</div> : null}{c.reviewed_by ? <div className="sub">{nameOf(members, c.reviewed_by)}</div> : null}</td>
                {reviewer ? <td style={{ minWidth: 230 }}>
                  <form action={claimReviewAction} className="stack" style={{ gap: 4 }}>
                    <input type="hidden" name="claim" value={c.id} /><input type="hidden" name="return" value={qs({})} />
                    <select name="review" defaultValue={c.review_status === 'pending' ? 'confirmed' : c.review_status} aria-label="Review">{CLAIM_REVIEW.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select>
                    <select name="status" defaultValue={c.claim_status} aria-label="Claim status">{CLAIM_STATUSES.map(r => <option key={r}>{r}</option>)}</select>
                    <input type="text" name="note" placeholder="Note (required to reject / ask)" aria-label="Note" defaultValue={c.review_note || ''} />
                    <button className="btn btn-sm" type="submit">Save review</button>
                  </form>
                </td> : null}
              </tr>
            ))}</tbody>
          </table></div></section>
        ) : <Empty title="No claims match">{claimF.review === 'pending' ? 'Nothing is waiting for review with these filters.' : 'Change the filters.'}</Empty>}
        {!reviewer ? <p className="hint-text">Your role can read claims but not review them (permission “Confirm or reject extracted company claims”).</p> : null}
      </> : null}
    </>
  );
}
