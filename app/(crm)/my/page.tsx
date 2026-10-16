import Link from 'next/link';
import { meetingAction, relNoteAction, relationshipAction } from '@/app/actions';
import { Badge, DecisionPill, Denied, Due, Empty, FollowUp, Notes, PageHead, Ref, StagePill } from '@/components/ui';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listEvents, listRelNotes, listRelationships, listTasks } from '@/lib/data-ext';
import { fmtDate, fmtDateTime, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import { REL_STATUSES, type Relationship } from '@/lib/types';

export const metadata = { title: 'My leads' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const hidden = (v: string | null) => v === '__hidden__';

export default async function MyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, leads, members, rels, notes, tasks, events] = await Promise.all([getSession(), listLeads(), listMembers(), listRelationships(), listRelNotes(), listTasks(), listEvents()]);
  const me = session!.user.id;
  const mine = leads.filter(l => l.assigned_to === me && isOpen(l)).sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  const own = rels.filter(r => r.owner === me);
  const shared = rels.filter(r => r.owner !== me);
  const selId = Number(sp.rel) || null;
  const sel = rels.find(r => r.id === selId) || null;
  const myTasks = tasks.filter(t => t.assignee === me && (t.status === 'Open' || t.status === 'In progress'));
  const due = own.filter(r => r.next_followup && r.status !== 'Closed').sort((a, b) => String(a.next_followup).localeCompare(String(b.next_followup)));
  const filter = typeof sp.f === 'string' ? sp.f : 'all';
  const shown = own.filter(r => filter === 'all' ? r.status !== 'Closed' : filter === 'due' ? r.next_followup && r.next_followup <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) : filter === 'linked' ? !!r.linked_lead : r.status === 'Closed');
  const tomorrow = new Date(Date.now() + 5.5 * 3600e3 + 864e5).toISOString().slice(0, 10) + 'T11:00';

  return (
    <>
      <PageHead eyebrow="Desk" title="My leads & relationships" crumbs={[{ href: '/', label: 'Dashboard' }]}>
        Your own opportunities and personal relationships — kept apart from the shared pipeline until you link them to an opportunity.
      </PageHead>
      <Notes sp={sp} />
      <div className="note warn" style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}>
        <span><b>Private by default.</b> Contacts and notes are visible only to you. “Shared with leadership” shows the organisation, status and follow-up date to roles allowed to see shared relationships — never the contact details or notes.</span>
      </div>

      <div className="grid-2-1">
        <section className="card" aria-labelledby="rel-h">
          <header><div><h2 id="rel-h">Personal relationships</h2><p>{due.filter(r => (r.next_followup || '') <= new Date().toISOString().slice(0, 10)).length} follow-up(s) due or overdue.</p></div></header>
          <nav className="views" aria-label="Relationship views">
            {[['all', 'Active'], ['due', 'Follow-up this week'], ['linked', 'Linked to an opportunity'], ['closed', 'Closed']].map(([k, label]) => <Link key={k} className="view" href={`/my?f=${k}`} aria-current={filter === k ? 'page' : undefined}>{label}</Link>)}
          </nav>
          {shown.length ? (
            <div className="tbl-wrap"><table className="tbl plain">
              <thead><tr><th>Organisation · contact</th><th>Status</th><th>Last touch</th><th>Next follow-up</th><th>Opportunity</th></tr></thead>
              <tbody>{shown.map(r => (
                <tr key={r.id} className={r.id === selId ? 'sel' : ''}>
                  <td className="t"><Link href={`/my?rel=${r.id}${filter !== 'all' ? `&f=${filter}` : ''}`}>{r.organisation}</Link><div className="sub">{[r.contact_name, r.contact_role].filter(Boolean).join(', ') || '—'}</div>{r.visibility !== 'Private' ? <Badge tone="info">Shared with leadership</Badge> : null}</td>
                  <td>{r.status}</td>
                  <td className="mono-sm">{r.last_touch ? fmtDate(r.last_touch) : '—'}</td>
                  <td><FollowUp date={r.next_followup} />{r.next_action ? <div className="sub">{r.next_action}</div> : null}</td>
                  <td>{r.linked_lead ? <Link href={`/leads/${r.linked_lead}`} className="ref">{leads.find(l => l.id === r.linked_lead)?.ref_code || 'Open'}</Link> : <span className="muted">—</span>}</td>
                </tr>))}</tbody>
            </table></div>
          ) : <Empty title="No relationships in this view">Add the people and organisations you are personally building a relationship with.</Empty>}
          {shared.length ? <>
            <h3 className="h" style={{ margin: '6px 0 0' }}>Shared with leadership by others</h3>
            <ul className="feed">{shared.map(r => <li key={r.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span><b>{r.organisation}</b> <span className="muted">· {nameOf(members, r.owner)} · {r.status}</span></span><FollowUp date={r.next_followup} /></li>)}</ul>
          </> : null}
        </section>

        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          {sel ? <RelationshipPanel r={sel} mine={sel.owner === me} notes={notes.filter(n => n.relationship_id === sel.id)} leads={leads} canMeet={can(session, 'integrations.use')} tomorrow={tomorrow} events={events.filter(e => e.relationship_id === sel.id)} /> : null}
          <details className="drawer" open={!own.length && !sel}>
            <summary>+ Add a personal lead</summary>
            <form action={relationshipAction} className="body stack">
              <label className="fld">Organisation <span className="req">*</span><input type="text" name="organisation" required placeholder="e.g. State health department" /></label>
              <div className="two"><label className="fld">Contact person<input type="text" name="contact_name" /></label><label className="fld">Role<input type="text" name="contact_role" /></label></div>
              <div className="two"><label className="fld">Email<input type="email" name="contact_email" /></label><label className="fld">Phone<input type="tel" name="contact_phone" /></label></div>
              <div className="two"><label className="fld">Next follow-up<input type="date" name="next_followup" /></label><label className="fld">Status<select name="status" defaultValue="New">{REL_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label></div>
              <label className="fld">Next action<input type="text" name="next_action" placeholder="e.g. send the one-page note" /></label>
              <label className="fld">Visibility<select name="visibility" defaultValue="Private"><option>Private</option><option>Shared with leadership</option></select></label>
              <div><button className="btn btn-primary" type="submit">Add</button></div>
            </form>
          </details>
        </div>
      </div>

      <section className="card" aria-labelledby="mo-h">
        <header><div><h2 id="mo-h">Opportunities I own</h2><p>{mine.length} open · {myTasks.length} open task(s) assigned to me.</p></div><Link href="/leads?assignee=me">Open in pipeline</Link></header>
        {mine.length ? (
          <div className="tbl-wrap"><table className="tbl plain">
            <thead><tr><th>Opportunity</th><th>Deadline</th><th>Stage</th><th>Decision</th><th>Next follow-up</th></tr></thead>
            <tbody>{mine.map(l => <tr key={l.id}><td className="t"><Ref code={l.ref_code} /> <Link href={`/leads/${l.id}`}>{l.title}</Link></td><td><Due deadline={l.deadline} /></td><td><StagePill s={l.stage} /></td><td><DecisionPill d={l.decision} approval={l.approval_status} always /></td><td><FollowUp date={l.next_followup} /></td></tr>)}</tbody>
          </table></div>
        ) : <Empty title="You own no open opportunities" action={{ href: '/leads?assignee=none', label: 'See unassigned opportunities' }} />}
      </section>
    </>
  );
}

function RelationshipPanel({ r, mine, notes, leads, canMeet, tomorrow, events }: { r: Relationship; mine: boolean; notes: { id: number; body: string; created_at: string }[]; leads: { id: number; ref_code: string | null; title: string }[]; canMeet: boolean; tomorrow: string; events: { id: number; title: string; status: string; created_at: string }[] }) {
  if (!mine) return <section className="card"><header><h2>{r.organisation}</h2></header><Denied>Shared by its owner for visibility only. Contact details and notes stay with the owner.</Denied></section>;
  return (
    <section className="card" aria-labelledby="rp-h">
      <header><div><h2 id="rp-h">{r.organisation}</h2><p>{r.contact_name ? `${r.contact_name}${r.contact_role ? ', ' + r.contact_role : ''}` : 'No contact recorded'}</p></div><Badge tone={r.visibility === 'Private' ? 'neu' : 'info'}>{r.visibility}</Badge></header>
      <dl className="kv"><dt>Email</dt><dd>{hidden(r.contact_email) ? 'Hidden' : r.contact_email || '—'}</dd><dt>Phone</dt><dd>{hidden(r.contact_phone) ? 'Hidden' : r.contact_phone || '—'}</dd><dt>Last touch</dt><dd>{r.last_touch ? fmtDate(r.last_touch) : '—'}</dd><dt>Next follow-up</dt><dd><FollowUp date={r.next_followup} /></dd></dl>
      <details className="drawer"><summary>Edit</summary>
        <form action={relationshipAction} className="body stack" key={r.updated_at}>
          <input type="hidden" name="rid" value={r.id} />
          <label className="fld">Organisation<input type="text" name="organisation" defaultValue={r.organisation} required /></label>
          <div className="two"><label className="fld">Contact<input type="text" name="contact_name" defaultValue={r.contact_name || ''} /></label><label className="fld">Role<input type="text" name="contact_role" defaultValue={r.contact_role || ''} /></label></div>
          <div className="two"><label className="fld">Email<input type="email" name="contact_email" defaultValue={r.contact_email || ''} /></label><label className="fld">Phone<input type="tel" name="contact_phone" defaultValue={r.contact_phone || ''} /></label></div>
          <div className="two"><label className="fld">Last touch<input type="date" name="last_touch" defaultValue={r.last_touch || ''} /></label><label className="fld">Next follow-up<input type="date" name="next_followup" defaultValue={r.next_followup || ''} /></label></div>
          <div className="two"><label className="fld">Status<select name="status" defaultValue={r.status}>{REL_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label><label className="fld">Visibility<select name="visibility" defaultValue={r.visibility}><option>Private</option><option>Shared with leadership</option></select></label></div>
          <label className="fld">Next action<input type="text" name="next_action" defaultValue={r.next_action || ''} /></label>
          <label className="fld">Linked opportunity<select name="linked_lead" defaultValue={r.linked_lead ? String(r.linked_lead) : ''}><option value="">Not linked</option>{leads.map(l => <option key={l.id} value={l.id}>{l.ref_code} · {l.title.slice(0, 60)}</option>)}</select></label>
          <p className="hint-text" style={{ margin: 0 }}>Linking shows the opportunity team that you hold this relationship — not your notes or contacts.</p>
          <div><button className="btn btn-primary" type="submit">Save</button></div>
        </form>
      </details>
      <div>
        <b style={{ fontSize: 13.5 }}>Private notes</b>
        <form action={relNoteAction} style={{ display: 'grid', gap: 6, marginTop: 6 }}><input type="hidden" name="rid" value={r.id} /><textarea name="body" rows={2} required placeholder="What was discussed; this also updates the last-touch date" aria-label="Private note" /><div><button className="btn btn-sm" type="submit">Add note</button></div></form>
        <ul className="feed">{notes.map(n => <li key={n.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span><span className="when">{fmtDateTime(n.created_at)}</span></li>)}</ul>
      </div>
      {canMeet ? (
        <details className="drawer"><summary>Schedule a meeting</summary>
          <form action={meetingAction} className="body stack">
            <input type="hidden" name="relationship_id" value={r.id} /><input type="hidden" name="return" value={`/my?rel=${r.id}`} />
            <label className="fld">Title<input type="text" name="title" required defaultValue={`Neurosynaptic × ${r.organisation}`} /></label>
            <div className="two"><label className="fld">Starts (IST)<input type="datetime-local" name="start" required defaultValue={tomorrow} /></label><label className="fld">Minutes<input type="number" name="duration" defaultValue={30} min={15} max={480} step={15} /></label></div>
            <label className="fld">Attendees (emails)<input type="text" name="attendees" defaultValue={hidden(r.contact_email) ? '' : r.contact_email || ''} /></label>
            <label className="fld">Agenda<textarea name="details" rows={2} defaultValue={r.next_action || ''} /></label>
            <label className="chk"><input type="checkbox" name="confirm" /> I checked the attendees and details</label>
            <p className="hint-text" style={{ margin: 0 }}>Opens Google Calendar in your account; you are the organiser and add the Meet link there. Nothing is sent until you save the event in Google.</p>
            <div><button className="btn btn-primary" type="submit">Open in Google Calendar</button></div>
          </form>
          {events.length ? <ul className="feed" style={{ padding: '0 16px 12px' }}>{events.map(e => <li key={e.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}><span>{e.title}</span><span className="when">{e.status} · {fmtDate(e.created_at)}</span></li>)}</ul> : null}
        </details>
      ) : null}
    </section>
  );
}
