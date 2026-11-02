import { AutoSubmitSelect } from '@/components/AutoSubmit';
import { AddContact, ContactTable } from '@/components/ContactTable';
import { OutreachUpload } from '@/components/OutreachUpload';
import { Denied, Notes } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { can } from '@/lib/perm';
import { listBdEvents, listContacts } from '@/lib/outreach';
import { MEETING_STATUSES } from '@/lib/types';

export const metadata = { title: 'People & PoCs' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default async function PeoplePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, contacts, events, members] = await Promise.all([getSession(), listContacts(), listBdEvents(), listMembers()]);
  if (!can(session, 'outreach.read')) return <Denied>Your role cannot see contacts.</Denied>;
  const me = session!.user.id;
  const f = { q: one(sp.q).toLowerCase(), owner: one(sp.owner), status: one(sp.status), event: one(sp.event) };
  const rows = contacts.filter(c => {
    if (f.owner === 'me' ? c.owner !== me : f.owner === 'none' ? !!c.owner : f.owner && c.owner !== f.owner) return false;
    if (f.status && c.meeting_status !== f.status) return false;
    if (f.event === 'none' ? !!c.event_id : f.event && String(c.event_id) !== f.event) return false;
    if (f.q && !`${c.name || ''} ${c.organisation || ''} ${c.email || ''} ${c.title || ''} ${c.details || ''}`.toLowerCase().includes(f.q)) return false;
    return true;
  });
  const orgs = new Set(contacts.map(c => (c.organisation || '').toLowerCase()).filter(Boolean)).size;
  const canEdit = can(session, 'outreach.edit'); const canAssign = can(session, 'outreach.assign');
  const back = '/people' + (Object.keys(sp).length ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]).filter(([k]) => !['msg', 'err', 'add'].includes(k)))).toString() : '');
  const people = members.map(m => ({ id: m.id, name: m.full_name || m.email, email: m.email }));
  return (
    <>
      <div className="phead">
        <div><div className="eyebrow">Outreach</div><h1>People & PoCs</h1><p>{contacts.length} contacts across {orgs} organisations: people met at events and personal-network leads.</p></div>
        {canEdit ? <div className="inline"><a className="btn" href="#upload">Upload contacts (Excel)</a><a className="btn btn-primary" href="?add=1#add">+ Add contact</a></div> : null}
      </div>
      <Notes sp={sp} />
      <form className="card filterbar" action="/people">
        <div className="fb-search"><input type="search" name="q" defaultValue={one(sp.q)} placeholder="Search name, organisation, email…" aria-label="Search contacts" /></div>
        <div className="fb-row">
          <AutoSubmitSelect name="owner" defaultValue={f.owner} label="Owner"><option value="">Owner: All</option><option value="me">Me</option><option value="none">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="status" defaultValue={f.status} label="Status"><option value="">Status: All</option>{MEETING_STATUSES.map(s => <option key={s}>{s}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="event" defaultValue={f.event} label="Event"><option value="">Source: All</option><option value="none">Personal network</option>{events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</AutoSubmitSelect>
          <button className="btn btn-sm">Apply</button>
        </div>
      </form>
      <section className="card tbl-card">
        <header><h2>Contacts</h2><p>{rows.length} shown</p></header>
        <ContactTable contacts={rows} members={members} events={events} back={back} canEdit={canEdit} canAssign={canAssign} meId={me} showEvent />
      </section>
      {canEdit ? <>
        <details className="card" id="add" open={sp.add === '1'}><summary><h2 className="inline-h">Add a contact</h2></summary><AddContact back="/people" members={members} canAssign={canAssign} meId={me} /></details>
        <section className="card" id="upload"><header><h2>Upload contacts from Excel</h2><p>For example the “Personal Leads” sheet (Organizations, PoCs, Email Addresses, Updates). To attach contacts to an event, upload them from that event’s page.</p></header>
          <OutreachUpload target="contacts" people={people} me={me} canAssign={canAssign} existingKeys={contacts.map(c => c.email ? 'e:' + c.email.toLowerCase() : 'o:' + String(c.organisation || '').toLowerCase() + '|' + String(c.name || '').toLowerCase())} />
        </section>
      </> : null}
    </>
  );
}
