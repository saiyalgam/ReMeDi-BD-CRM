import Link from 'next/link';
import { notFound } from 'next/navigation';
import { partnerAction } from '@/app/actions';
import { Badge, Denied, Empty, Notes, PageHead, Ref, VTONE } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listLeadPartners, listPartners } from '@/lib/data-ext';
import { fmtDate, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { PARTNER_RELATIONSHIP, PARTNER_VERIFICATION } from '@/lib/types';

type SP = Promise<Record<string, string | string[] | undefined>>;
const show = (v: string | null) => (v === '__hidden__' ? 'Hidden for your role' : v || '—');

export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const [session, partners, links, leads, members] = await Promise.all([getSession(), listPartners(), listLeadPartners(), listLeads(), listMembers()]);
  if (!can(session, 'partners.read')) return <Denied>Your role cannot see the partner directory.</Denied>;
  const p = partners.find(x => x.id === id);
  if (!p) notFound();
  const opps = links.filter(x => x.partner_id === id);
  const byLead = new Map(leads.map(l => [l.id, l]));
  const sensitive = can(session, 'partners.read_sensitive');
  return (
    <>
      <PageHead eyebrow={p.kind} title={p.name} crumbs={[{ href: '/partners', label: 'Partners' }]}
        actions={<><Badge tone={VTONE[p.verification]}>{p.verification}</Badge><Badge tone="out">{p.relationship}</Badge></>}>
        {p.aliases ? `Also recorded as “${p.aliases}”. ` : ''}{p.source_note ? `Source: ${p.source_note}` : ''}
      </PageHead>
      <Notes sp={sp} />
      {p.verification !== 'Verified' ? <div className="note warn">Not verified. Do not describe this organisation as a partner in a bid until its identity, capabilities and evidence are confirmed.</div> : null}
      <div className="grid-2-1">
        <section className="card">
          <header><h2>Profile</h2></header>
          <dl className="kv">
            <dt>Category</dt><dd>{p.category || '—'}</dd><dt>Capabilities</dt><dd>{p.capabilities || '—'}</dd><dt>Geography</dt><dd>{p.geography || '—'}</dd>
            <dt>Health domains</dt><dd>{p.health_domains || '—'}</dd><dt>Relationship owner</dt><dd>{nameOf(members, p.owner) || '—'}</dd><dt>Prior collaboration</dt><dd>{p.prior_collaboration || '—'}</dd>
          </dl>
          <h3 className="h" style={{ margin: '6px 0 0' }}>Sensitive</h3>
          {sensitive ? <dl className="kv"><dt>Contact</dt><dd>{show(p.contact_name)}</dd><dt>Email</dt><dd>{show(p.contact_email)}</dd><dt>Phone</dt><dd>{show(p.contact_phone)}</dd><dt>Due diligence</dt><dd>{show(p.due_diligence)}</dd><dt>Restrictions</dt><dd>{show(p.restrictions)}</dd></dl>
            : <Denied>Contacts, due-diligence notes and restrictions are hidden for your role.</Denied>}
        </section>
        <section className="card">
          <header><div><h2>Opportunities</h2><p>Each link says which gap the partner covers.</p></div></header>
          {opps.length ? <ul className="feed">{opps.map(o => { const l = byLead.get(o.lead_id); return l ? <li key={o.id} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}><span><Ref code={l.ref_code} /> <Link href={`/leads/${l.id}?tab=partners`}>{l.title}</Link><div className="muted" style={{ fontSize: 12.5 }}>{o.need} · {o.gap_type || 'gap'}: {o.gap_note} · {o.status}</div></span></li> : null; })}</ul> : <Empty title="Not linked to any opportunity" />}
        </section>
      </div>
      {can(session, 'partners.edit') ? (
        <details className="drawer">
          <summary>Edit partner</summary>
          <form action={partnerAction} className="body stack" key={p.updated_at}>
            <input type="hidden" name="pid" value={p.id} />
            <div className="two"><label className="fld">Name<input type="text" name="name" defaultValue={p.name} required /></label><label className="fld">Also known as<input type="text" name="aliases" defaultValue={p.aliases || ''} /></label></div>
            <div className="two"><label className="fld">Verification<select name="verification" defaultValue={p.verification}>{PARTNER_VERIFICATION.map(v => <option key={v}>{v}</option>)}</select></label><label className="fld">Relationship<select name="relationship" defaultValue={p.relationship}>{PARTNER_RELATIONSHIP.map(v => <option key={v}>{v}</option>)}</select></label></div>
            <div className="two"><label className="fld">Category<input type="text" name="category" defaultValue={p.category || ''} /></label><label className="fld">Geography<input type="text" name="geography" defaultValue={p.geography || ''} /></label></div>
            <label className="fld">Capabilities<input type="text" name="capabilities" defaultValue={p.capabilities || ''} /></label>
            <label className="fld">Health domains<input type="text" name="health_domains" defaultValue={p.health_domains || ''} /></label>
            <label className="fld">Relationship owner<select name="owner" defaultValue={p.owner || ''}><option value="">—</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
            <label className="fld">Prior collaboration (evidence)<textarea name="prior_collaboration" rows={2} defaultValue={p.prior_collaboration || ''} /></label>
            <label className="fld">Source / how verified <span className="hint-text">(required to mark Verified)</span><input type="text" name="source_note" defaultValue={p.source_note || ''} /></label>
            {sensitive ? <>
              <div className="two"><label className="fld">Contact<input type="text" name="contact_name" defaultValue={p.contact_name || ''} /></label><label className="fld">Email<input type="email" name="contact_email" defaultValue={p.contact_email || ''} /></label></div>
              <label className="fld">Phone<input type="tel" name="contact_phone" defaultValue={p.contact_phone || ''} /></label>
              <label className="fld">Due diligence<textarea name="due_diligence" rows={2} defaultValue={p.due_diligence || ''} /></label>
              <label className="fld">Restrictions<input type="text" name="restrictions" defaultValue={p.restrictions || ''} /></label>
            </> : null}
            <p className="hint-text" style={{ margin: 0 }}>“Current” is only allowed for a verified partner. Last changed {fmtDate(p.updated_at)}.</p>
            <div><button className="btn btn-primary" type="submit">Save</button></div>
          </form>
        </details>
      ) : null}
    </>
  );
}
