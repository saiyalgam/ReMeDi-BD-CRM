import Link from 'next/link';
import { createLeadAction } from '@/app/actions';
import { LEAD_TYPES } from '@/lib/types';

const CATEGORIES = ['Govt Tender - India', 'Intl Govt Tender (partner-led)', 'International Grant', 'Innovation Grant - India', 'CSR - India'];

export default async function NewLead({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const err = typeof sp.err === 'string' ? sp.err : '';
  return (
    <>
      <div><Link href="/leads" className="muted" style={{ fontSize: 13 }}>← All leads</Link></div>
      <div className="phead">
        <div>
          <div className="eyebrow">Leads</div>
          <h1>Add a lead</h1>
          <p>For a tender or call you heard about outside the crawler: WhatsApp, a client, GeM, a partner. It goes to Needs checking like any other lead.</p>
        </div>
      </div>
      {err ? <div className="note err" role="alert">{err}</div> : null}
      <section className="card" style={{ maxWidth: 760 }}>
        <form action={createLeadAction} className="stack">
          <label className="fld">Title *<input type="text" name="title" required placeholder="e.g. Smart Mobile Medical Unit for Jaunpur district" /></label>
          <div className="two">
            <label className="fld">Type
              <select name="lead_type" defaultValue="Tender">{LEAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
            </label>
            <label className="fld">Category
              <select name="category" defaultValue={CATEGORIES[0]}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
            </label>
          </div>
          <div className="two">
            <label className="fld">Buyer / funder<input type="text" name="funder_buyer" /></label>
            <label className="fld">Country / state<input type="text" name="country" /></label>
          </div>
          <div className="two">
            <label className="fld">Deadline<input type="date" name="deadline" /></label>
            <label className="fld">Value<input type="text" name="amount" placeholder="e.g. ₹7.5 Cr, EMD ₹7.5 lakh" /></label>
          </div>
          <div className="two">
            <label className="fld">Reference<input type="text" name="ref_no" placeholder="e.g. GEM/2026/B/8124756" /></label>
            <label className="fld">Where you heard of it<input type="text" name="source" placeholder="e.g. WhatsApp from TenderDetail" /></label>
          </div>
          <label className="fld">Link<input type="url" name="url" placeholder="https://" /></label>
          <label className="fld">Summary<textarea name="summary" rows={3} placeholder="Scope in a sentence or two" /></label>
          <div className="inline"><button className="btn btn-primary" type="submit">Add lead</button><Link className="btn" href="/leads">Cancel</Link></div>
        </form>
      </section>
    </>
  );
}
