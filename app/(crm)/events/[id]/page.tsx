import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventChecklistAction, eventSaveAction, learningAction } from '@/app/outreach-actions';
import { AddContact, ContactTable } from '@/components/ContactTable';
import { OutreachUpload } from '@/components/OutreachUpload';
import { Denied, Notes } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { fmtDate, nameOf, todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { listBdEvents, listContacts, listLearnings } from '@/lib/outreach';
import { crore, fmtCr } from '@/lib/tracker';
import { EVENT_IMPORTANCE, EVENT_STATUSES, PARTICIPATION } from '@/lib/types';

type P = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS = [['overview', 'Overview & checklist'], ['contacts', 'Contacts met'], ['learnings', 'Learnings'], ['report', 'Post-event report']] as const;

export default async function EventPage({ params, searchParams }: { params: P; searchParams: SP }) {
  const { id } = await params; const sp = await searchParams;
  const [session, events, contacts, learnings, members, leads] = await Promise.all([getSession(), listBdEvents(), listContacts(), listLearnings(), listMembers(), listLeads()]);
  if (!can(session, 'outreach.read')) return <Denied>Your role cannot see events.</Denied>;
  const ev = events.find(e => e.id === Number(id));
  if (!ev) notFound();
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || 'overview';
  const canEdit = can(session, 'outreach.edit'); const canAssign = can(session, 'outreach.assign');
  const me = session!.user.id;
  const met = contacts.filter(c => c.event_id === ev.id);
  const conv = met.filter(c => c.converted_lead);
  const value = conv.reduce((a, c) => a + (crore(leads.find(l => l.id === c.converted_lead)?.amount) || 0), 0);
  const fast = met.filter(c => c.meeting_status !== 'To contact').length;
  const back = `/events/${ev.id}?tab=${tab}`;
  const people = members.map(m => ({ id: m.id, name: m.full_name || m.email, email: m.email }));
  const today = todayIST();
  const applyDays = ev.apply_by ? Math.round((Date.parse(ev.apply_by) - Date.parse(today)) / 864e5) : null;

  return (
    <>
      <div className="phead">
        <div>
          <nav aria-label="Breadcrumb" className="muted crumbs"><Link href="/events">Events</Link> / {ev.name}</nav>
          <h1>{ev.name}</h1>
          <p>{[ev.dates_text || (ev.starts_on && fmtDate(ev.starts_on)), ev.location, ev.participation && `as ${ev.participation}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="inline"><span className={`imp imp-${ev.importance.toLowerCase()}`}>{ev.importance}</span><span className="badge b-out">{ev.status}</span></div>
      </div>
      <Notes sp={sp} />
      {applyDays != null && applyDays >= 0 && applyDays <= 7 && ['Planned', 'Preparing'].includes(ev.status) ? <div className="note err" role="alert">Application deadline in {applyDays} day{applyDays === 1 ? '' : 's'} ({fmtDate(ev.apply_by)}).</div> : null}

      <div className="kpis">
        <div className="kpi"><small>Contacts met</small><b>{met.length}</b></div>
        <div className="kpi"><small>Contacted</small><b>{fast}</b><span className="sub">{met.length ? Math.round(100 * fast / met.length) : 0}% have moved past “To contact”</span></div>
        <div className="kpi"><small>Leads created</small><b>{conv.length}</b></div>
        <div className="kpi"><small>Pipeline value</small><b>{fmtCr(value)}</b></div>
        <div className="kpi"><small>Cost (actual / estimate)</small><b>{ev.cost_actual != null ? '₹' + ev.cost_actual.toLocaleString('en-IN') : '—'}</b><span className="sub">estimate {ev.cost_estimate != null ? '₹' + ev.cost_estimate.toLocaleString('en-IN') : '—'}</span></div>
      </div>

      <nav className="tabs" aria-label="Event sections">
        {TABS.map(([k, label]) => <Link key={k} className="tab" href={`/events/${ev.id}?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{label}{k === 'contacts' ? ` (${met.length})` : ''}</Link>)}
      </nav>

      {tab === 'overview' ? (
        <div className="grid2">
          <section className="card">
            <header><h2>Pre-event checklist</h2><p>{ev.checklist.filter(c => c.done).length} of {ev.checklist.length} done</p></header>
            <ul className="checklist">
              {ev.checklist.map((c, i) => (
                <li key={i} className={c.done ? 'done' : undefined}>
                  {canEdit ? <form action={eventChecklistAction}><input type="hidden" name="id" value={ev.id} /><input type="hidden" name="index" value={i} /><button className="tick" name="op" value="toggle" aria-label={c.done ? `Mark “${c.item}” not done` : `Mark “${c.item}” done`}>{c.done ? '✓' : ''}</button></form> : <span className="tick">{c.done ? '✓' : ''}</span>}
                  <span className="ci">{c.item}<small>{[nameOf(members, c.owner), c.due && `due ${fmtDate(c.due)}`].filter(Boolean).join(' · ')}</small></span>
                  {canEdit ? <form action={eventChecklistAction}><input type="hidden" name="id" value={ev.id} /><input type="hidden" name="index" value={i} /><button className="btn-link" name="op" value="remove">Remove</button></form> : null}
                </li>
              ))}
              {!ev.checklist.length ? <li className="muted">No items yet. Typical: deck, brochures, meeting requests, travel, application.</li> : null}
            </ul>
            {canEdit ? (
              <form action={eventChecklistAction} className="inline">
                <input type="hidden" name="id" value={ev.id} /><input type="hidden" name="op" value="add" />
                <input type="text" name="item" placeholder="Add an item" aria-label="Checklist item" />
                <select name="owner" aria-label="Owner"><option value="">Owner</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select>
                <input type="date" name="due" aria-label="Due" />
                <button className="btn btn-sm">Add</button>
              </form>
            ) : null}
          </section>
          <section className="card">
            <header><h2>Event details</h2></header>
            {canEdit ? (
              <form action={eventSaveAction} className="formgrid">
                <input type="hidden" name="id" value={ev.id} /><input type="hidden" name="return" value={back} />
                <label className="fld wide">Name<input type="text" name="name" defaultValue={ev.name} /></label>
                <label className="fld">Starts<input type="date" name="starts_on" defaultValue={ev.starts_on || ''} /></label>
                <label className="fld">Ends<input type="date" name="ends_on" defaultValue={ev.ends_on || ''} /></label>
                <label className="fld">Dates as written<input type="text" name="dates_text" defaultValue={ev.dates_text || ''} /></label>
                <label className="fld">Apply by<input type="date" name="apply_by" defaultValue={ev.apply_by || ''} /></label>
                <label className="fld">Importance<select name="importance" defaultValue={ev.importance}>{EVENT_IMPORTANCE.map(x => <option key={x}>{x}</option>)}</select></label>
                <label className="fld">Status<select name="status" defaultValue={ev.status}>{EVENT_STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
                <label className="fld">Location<input type="text" name="location" defaultValue={ev.location || ''} /></label>
                <label className="fld">Participating as<select name="participation" defaultValue={ev.participation || 'Visitor'}>{PARTICIPATION.map(x => <option key={x}>{x}</option>)}</select></label>
                <label className="fld">Cost estimate (₹)<input type="text" inputMode="numeric" name="cost_estimate" defaultValue={ev.cost_estimate ?? ''} /></label>
                <label className="fld">Cost actual (₹)<input type="text" inputMode="numeric" name="cost_actual" defaultValue={ev.cost_actual ?? ''} /></label>
                <label className="fld wide">Purpose / expected output<textarea name="purpose" defaultValue={ev.purpose || ''} /></label>
                <fieldset className="fld wide"><legend>Personnel</legend><input type="hidden" name="personnel_present" value="1" /><div className="rr">{members.map(m => <label key={m.id} className="chk"><input type="checkbox" name="personnel" value={m.id} defaultChecked={ev.personnel.includes(m.id)} />{m.full_name || m.email}</label>)}</div>{ev.personnel_text ? <small className="muted">From the spreadsheet: {ev.personnel_text}</small> : null}</fieldset>
                <div className="wide"><button className="btn btn-primary" type="submit">Save</button></div>
              </form>
            ) : <p>{ev.purpose || '—'}</p>}
          </section>
        </div>
      ) : null}

      {tab === 'contacts' ? (
        <>
          <section className="card tbl-card">
            <header><h2>Contacts met</h2><p>Assign each one, set a follow-up within 48 hours, and convert the promising ones to leads.</p></header>
            <ContactTable contacts={met} members={members} events={events} back={back} canEdit={canEdit} canAssign={canAssign} meId={me} />
          </section>
          {canEdit ? <>
            <details className="card"><summary><h2 className="inline-h">Add a contact</h2></summary><AddContact back={back} eventId={ev.id} members={members} canAssign={canAssign} meId={me} /></details>
            <section className="card"><header><h2>Upload contacts from Excel</h2><p>For example the “AVPN meetings” sheet: Name, Meeting?, Org, Title, Phone, Email, Date, Details. Duplicates are matched by email, then by organisation + name.</p></header>
              <OutreachUpload target="contacts" eventId={ev.id} people={people} me={me} canAssign={canAssign} existingKeys={contacts.map(c => c.email ? 'e:' + c.email.toLowerCase() : 'o:' + String(c.organisation || '').toLowerCase() + '|' + String(c.name || '').toLowerCase())} />
            </section>
          </> : null}
        </>
      ) : null}

      {tab === 'learnings' ? (
        <section className="card">
          <header><h2>Learnings</h2><p>Winners, models and what they mean for us.</p></header>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Year</th><th>Winners / notable organisations</th><th>Model</th><th>Learnings for us</th></tr></thead>
            <tbody>{learnings.filter(l => l.event_id === ev.id).map(l => <tr key={l.id}><td>{l.year}</td><td>{l.winners}</td><td>{l.model}</td><td>{l.learnings}</td></tr>)}</tbody></table></div>
          {canEdit ? (
            <form action={learningAction} className="formgrid">
              <input type="hidden" name="event_id" value={ev.id} /><input type="hidden" name="return" value={`/events/${ev.id}?tab=learnings`} />
              <label className="fld">Year<input type="text" name="year" /></label>
              <label className="fld">Winners<input type="text" name="winners" /></label>
              <label className="fld">Model<input type="text" name="model" /></label>
              <label className="fld wide">Learnings<textarea name="learnings" /></label>
              <div className="wide"><button className="btn btn-primary btn-sm">Add learning</button></div>
            </form>
          ) : null}
        </section>
      ) : null}

      {tab === 'report' ? (
        <section className="card">
          <header><h2>Post-event report</h2><p>Close the event once follow-ups are assigned.</p></header>
          <dl className="facts">
            <div><dt>Contacts captured</dt><dd>{met.length}</dd></div>
            <div><dt>Contacted so far</dt><dd>{fast} ({met.length ? Math.round(100 * fast / met.length) : 0}%)</dd></div>
            <div><dt>Leads created</dt><dd>{conv.length}</dd></div>
            <div><dt>Pipeline value</dt><dd>{fmtCr(value)}</dd></div>
            <div><dt>Cost per lead</dt><dd>{conv.length && ev.cost_actual ? '₹' + Math.round(ev.cost_actual / conv.length).toLocaleString('en-IN') : '—'}</dd></div>
          </dl>
          {canEdit ? (
            <form action={eventSaveAction} className="formgrid">
              <input type="hidden" name="id" value={ev.id} /><input type="hidden" name="return" value={back} />
              <label className="fld wide">Actual output<textarea name="actual_output" defaultValue={ev.actual_output || ''} /></label>
              <label className="fld">Cost actual (₹)<input type="text" inputMode="numeric" name="cost_actual" defaultValue={ev.cost_actual ?? ''} /></label>
              <label className="fld">Effectiveness (1–5)<select name="effectiveness" defaultValue={ev.effectiveness ?? ''}><option value="">—</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
              <label className="fld">Status<select name="status" defaultValue={ev.status}>{EVENT_STATUSES.map(x => <option key={x}>{x}</option>)}</select></label>
              <div className="wide"><button className="btn btn-primary">Save report</button></div>
            </form>
          ) : <p>{ev.actual_output || '—'}</p>}
        </section>
      ) : null}
    </>
  );
}
