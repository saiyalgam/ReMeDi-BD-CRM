import Link from 'next/link';
import { eventSaveAction } from '@/app/outreach-actions';
import { OutreachUpload } from '@/components/OutreachUpload';
import { Denied, Notes } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { fmtDate, todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { listBdEvents, listContacts } from '@/lib/outreach';
import { crore, fmtCr } from '@/lib/tracker';
import { EVENT_IMPORTANCE, EVENT_STATUSES, PARTICIPATION, type BdEvent } from '@/lib/types';

export const metadata = { title: 'Events' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const inr = (n: number | null) => (n == null ? '—' : '₹' + n.toLocaleString('en-IN'));

export default async function EventsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, events, contacts, leads, members] = await Promise.all([getSession(), listBdEvents(), listContacts(), listLeads(), listMembers()]);
  if (!can(session, 'outreach.read')) return <Denied>Your role cannot see events. Ask an admin for the “See events” permission.</Denied>;
  const today = todayIST();
  const canEdit = can(session, 'outreach.edit');
  const year = today.slice(0, 4);

  const stats = (list: BdEvent[]) => {
    const ids = new Set(list.map(e => e.id));
    const met = contacts.filter(c => c.event_id && ids.has(c.event_id));
    const conv = met.filter(c => c.converted_lead);
    const value = conv.reduce((a, c) => a + (crore(leads.find(l => l.id === c.converted_lead)?.amount) || 0), 0);
    const cost = list.reduce((a, e) => a + (e.cost_actual ?? 0), 0);
    return { planned: list.filter(e => e.status !== 'Skipped').length, actual: list.filter(e => ['Attended', 'Follow-up', 'Closed'].includes(e.status)).length,
      est: list.reduce((a, e) => a + (e.cost_estimate ?? 0), 0), cost, met: met.length, leads: conv.length, value, perLead: conv.length ? Math.round(cost / conv.length) : null };
  };
  const quarters = [1, 2, 3, 4].map(q => {
    const list = events.filter(e => e.starts_on && e.starts_on.startsWith(year) && Math.ceil(Number(e.starts_on.slice(5, 7)) / 3) === q);
    return { q, ...stats(list) };
  });
  const upcoming = events.filter(e => !['Closed', 'Skipped'].includes(e.status) && (!e.ends_on || e.ends_on >= today)).sort((a, b) => String(a.starts_on || '9').localeCompare(String(b.starts_on || '9')));
  const past = events.filter(e => !upcoming.includes(e));
  const people = members.map(m => ({ id: m.id, name: m.full_name || m.email, email: m.email }));

  return (
    <>
      <div className="phead">
        <div><div className="eyebrow">Outreach</div><h1>Events</h1><p>Plan → register before the deadline → prepare → attend → capture contacts → assign follow-ups → convert to leads → report.</p></div>
        {canEdit ? <div className="inline"><a className="btn" href="#upload">Upload events (Excel)</a><a className="btn btn-primary" href="?add=1#add">+ Add event</a></div> : null}
      </div>
      <Notes sp={sp} />

      <section className="card" aria-labelledby="q-h">
        <header><h2 id="q-h">{year} by quarter</h2><p>Planned vs attended, cost estimate vs actual, and what the events produced.</p></header>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Quarter</th><th className="r">Planned</th><th className="r">Attended</th><th className="r">Cost estimate</th><th className="r">Cost actual</th><th className="r">Contacts met</th><th className="r">Leads created</th><th className="r">Pipeline value</th><th className="r">Cost per lead</th></tr></thead>
          <tbody>{quarters.map(q => (
            <tr key={q.q}><td>Q{q.q} ({['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q.q - 1]})</td><td className="r">{q.planned}</td><td className="r">{q.actual}</td><td className="r">{inr(q.est || null)}</td><td className="r">{inr(q.cost || null)}</td><td className="r">{q.met}</td><td className="r">{q.leads}</td><td className="r">{fmtCr(q.value)}</td><td className="r">{inr(q.perLead)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <EventTable title="Upcoming and in progress" list={upcoming} contacts={contacts} today={today} />
      {past.length ? <EventTable title="Past and skipped" list={past} contacts={contacts} today={today} /> : null}

      {canEdit ? (
        <details className="card" id="add" open={sp.add === '1'}>
          <summary><h2 className="inline-h">Add an event</h2></summary>
          <form action={eventSaveAction} className="formgrid">
            <label className="fld wide">Event name *<input type="text" name="name" required /></label>
            <label className="fld">Starts<input type="date" name="starts_on" /></label>
            <label className="fld">Ends<input type="date" name="ends_on" /></label>
            <label className="fld">Dates as written<input type="text" name="dates_text" placeholder="e.g. 25–27 Aug" /></label>
            <label className="fld">Apply by<input type="date" name="apply_by" /></label>
            <label className="fld">Importance<select name="importance" defaultValue="Medium">{EVENT_IMPORTANCE.map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="fld">Status<select name="status" defaultValue="Planned">{EVENT_STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="fld">Location<input type="text" name="location" /></label>
            <label className="fld">Participating as<select name="participation" defaultValue="Visitor">{PARTICIPATION.map(x => <option key={x}>{x}</option>)}</select></label>
            <label className="fld">Cost estimate (₹)<input type="text" inputMode="numeric" name="cost_estimate" /></label>
            <label className="fld wide">Purpose / expected output<textarea name="purpose" /></label>
            <fieldset className="fld wide"><legend>Personnel</legend><input type="hidden" name="personnel_present" value="1" /><div className="rr">{people.map(p => <label key={p.id} className="chk"><input type="checkbox" name="personnel" value={p.id} />{p.name}</label>)}</div></fieldset>
            <div className="wide"><button className="btn btn-primary" type="submit">Add event</button></div>
          </form>
        </details>
      ) : null}

      {canEdit ? (
        <section className="card" id="upload" aria-labelledby="up-h">
          <header><h2 id="up-h">Upload events from Excel</h2><p>For example the “Conferences to Participate” sheet. Columns are matched automatically; check them before importing.</p></header>
          <OutreachUpload target="events" people={people} me={session!.user.id} canAssign={can(session, 'outreach.assign')} />
        </section>
      ) : null}
    </>
  );
}

function EventTable({ title, list, contacts, today }: { title: string; list: BdEvent[]; contacts: { event_id: number | null; converted_lead: number | null }[]; today: string }) {
  return (
    <section className="card tbl-card">
      <header><h2>{title}</h2><p>{list.length} event{list.length === 1 ? '' : 's'}</p></header>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Event</th><th>Dates</th><th>Apply by</th><th>Importance</th><th>Location</th><th>Status</th><th className="r">Checklist</th><th className="r">Contacts</th><th className="r">Leads</th></tr></thead>
        <tbody>{list.length ? list.map(e => {
          const done = e.checklist.filter(c => c.done).length;
          const late = e.apply_by && e.apply_by >= today && (Date.parse(e.apply_by) - Date.parse(today)) / 864e5 <= 7;
          const met = contacts.filter(c => c.event_id === e.id);
          return (
            <tr key={e.id}>
              <td><Link href={`/events/${e.id}`}><b>{e.name}</b></Link><div className="sub muted">{e.purpose || ''}</div></td>
              <td>{e.dates_text || (e.starts_on ? fmtDate(e.starts_on) : '—')}</td>
              <td>{e.apply_by ? <span className={late ? 'due urgent' : undefined}>{fmtDate(e.apply_by)}</span> : e.apply_by_text || '—'}</td>
              <td><span className={`imp imp-${e.importance.toLowerCase()}`}>{e.importance}</span></td>
              <td>{e.location || '—'}</td>
              <td><span className="badge b-out">{e.status}</span></td>
              <td className="r">{e.checklist.length ? `${done}/${e.checklist.length}` : '—'}</td>
              <td className="r">{met.length}</td>
              <td className="r">{met.filter(c => c.converted_lead).length}</td>
            </tr>
          );
        }) : <tr><td colSpan={9} className="muted">None.</td></tr>}</tbody>
      </table></div>
    </section>
  );
}
