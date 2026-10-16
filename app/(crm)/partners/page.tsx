import Link from 'next/link';
import { ExportMenu } from '@/components/Export';
import { partnerAction } from '@/app/actions';
import { Badge, Denied, Empty, Notes, PageHead, VTONE } from '@/components/ui';
import { getSession, listLeads } from '@/lib/data';
import { listLeadPartners, listPartners } from '@/lib/data-ext';
import { can } from '@/lib/perm';
import { PARTNER_RELATIONSHIP, PARTNER_VERIFICATION } from '@/lib/types';

export const metadata = { title: 'Partners' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default async function PartnersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, partners, links, leads] = await Promise.all([getSession(), listPartners(), listLeadPartners(), listLeads()]);
  if (!can(session, 'partners.read')) return <><PageHead title="Partners" /><Denied>Your role cannot see the partner directory.</Denied></>;
  const q = one(sp.q).toLowerCase(), ver = one(sp.verification), rel = one(sp.relationship), geo = one(sp.geo).toLowerCase(), cap = one(sp.cap).toLowerCase();
  const rows = partners.filter(p =>
    (!q || [p.name, p.aliases, p.category, p.capabilities, p.health_domains, p.source_note].join(' ').toLowerCase().includes(q))
    && (!ver || p.verification === ver) && (!rel || p.relationship === rel)
    && (!geo || (p.geography || '').toLowerCase().includes(geo)) && (!cap || [p.capabilities, p.health_domains, p.category].join(' ').toLowerCase().includes(cap)));
  const byLead = new Map(leads.map(l => [l.id, l]));
  return (
    <>
      <PageHead eyebrow="Network & evidence" title="Partner directory" crumbs={[{ href: '/', label: 'Dashboard' }]} tools={<ExportMenu kind="partners" params={sp} canExport={can(session, 'opp.export')} />}>
        Organisations and people we have worked with, are talking to, or have only heard of. Names from workbooks and conversations start as “needs confirmation”: none is treated as a current partner until verified.
      </PageHead>
      <Notes sp={sp} />
      <form method="get" className="filters" aria-label="Search partners">
        <input type="search" name="q" defaultValue={one(sp.q)} placeholder="Search name, alias, capability, source…" aria-label="Search" />
        <input type="text" name="cap" defaultValue={one(sp.cap)} placeholder="Capability / health domain" aria-label="Capability or health domain" />
        <input type="text" name="geo" defaultValue={one(sp.geo)} placeholder="Geography" aria-label="Geography" />
        <select name="verification" defaultValue={ver} aria-label="Verification"><option value="">Any verification</option>{PARTNER_VERIFICATION.map(v => <option key={v}>{v}</option>)}</select>
        <select name="relationship" defaultValue={rel} aria-label="Relationship status"><option value="">Any relationship</option>{PARTNER_RELATIONSHIP.map(v => <option key={v}>{v}</option>)}</select>
        <button className="btn btn-primary" type="submit">Search</button><Link className="btn" href="/partners">Clear</Link>
      </form>
      <p className="legal">Legend: <Badge tone="ok" icon="✓">Verified</Badge> <Badge tone="q" icon="?">Needs confirmation</Badge> <Badge tone="bad" icon="!">Unidentified</Badge> · relationship: Current, Past, Prospective, To confirm.</p>
      {rows.length ? (
        <div className="pcards">
          {rows.map(p => {
            const opps = links.filter(x => x.partner_id === p.id);
            return (
              <Link key={p.id} href={`/partners/${p.id}`} className={`pcard${p.verification !== 'Verified' ? ' unv' : ''}`}>
                <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 2, minWidth: 0 }}><h3>{p.name}</h3><span className="muted" style={{ fontSize: 12.5 }}>{p.kind}{p.aliases ? ` · also “${p.aliases}”` : ''}</span></div>
                  <Badge tone={VTONE[p.verification]} icon={p.verification === 'Verified' ? '✓' : p.verification === 'Unidentified' ? '!' : '?'}>{p.verification}</Badge>
                </div>
                <div className="inline" style={{ gap: 4 }}>{(p.capabilities || '').split(/[;,]\s*/).filter(Boolean).slice(0, 4).map(c => <span key={c} className="mini-chip">{c}</span>)}{!p.capabilities ? <span className="muted" style={{ fontSize: 12.5 }}>Capabilities not recorded</span> : null}</div>
                <dl className="kv" style={{ gridTemplateColumns: '96px minmax(0,1fr)', fontSize: 12.5 }}>
                  <dt>Relationship</dt><dd>{p.relationship}</dd>
                  <dt>Geography</dt><dd>{p.geography || '—'}</dd>
                  <dt>Opportunities</dt><dd>{opps.length ? opps.map(o => byLead.get(o.lead_id)?.ref_code).filter(Boolean).join(', ') : '—'}</dd>
                  <dt>Evidence</dt><dd>{p.prior_collaboration ? 'Prior collaboration recorded' : 'None on file'}</dd>
                </dl>
                {p.source_note ? <span className="legal">Source: {p.source_note}</span> : null}
              </Link>
            );
          })}
        </div>
      ) : <Empty title="No partners match">Clear the filters or add a partner below.</Empty>}
      {can(session, 'partners.edit') ? (
        <details className="drawer">
          <summary>+ Add a partner (starts as “needs confirmation”)</summary>
          <form action={partnerAction} className="body stack">
            <div className="two"><label className="fld">Name <span className="req">*</span><input type="text" name="name" required /></label><label className="fld">Organisation or person<select name="kind" defaultValue="Organisation"><option>Organisation</option><option>Person</option></select></label></div>
            <div className="two"><label className="fld">Category<input type="text" name="category" placeholder="e.g. System integrator, NGO, OEM" /></label><label className="fld">Geography<input type="text" name="geography" /></label></div>
            <label className="fld">Capabilities <span className="hint-text">(comma separated; only what a source supports)</span><input type="text" name="capabilities" /></label>
            <label className="fld">Where the name came from <span className="req">*</span><input type="text" name="source_note" required placeholder="e.g. Pipeline workbook 29 Sep 2026, J&K tender row" /></label>
            <div><button className="btn btn-primary" type="submit">Add partner</button></div>
          </form>
        </details>
      ) : null}
    </>
  );
}
