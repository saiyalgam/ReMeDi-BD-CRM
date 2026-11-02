import Link from 'next/link';
import { contactBulkAction, contactConvertAction, contactSaveAction } from '@/app/outreach-actions';
import { FollowUp } from '@/components/ui';
import { MEETING_STATUSES, type BdContact, type BdEvent, type Member } from '@/lib/types';

const TONE: Record<string, string> = { 'To contact': 'b-neu', Scheduled: 'b-info', 'Follow-up': 'b-q', Met: 'b-ok', 'No response': 'b-warn', Closed: 'b-neu' };

/** Contacts with bulk assign / round-robin / status / follow-up, inline edit and "convert to lead". */
export function ContactTable({ contacts, members, events, back, canEdit, canAssign, meId, showEvent }: {
  contacts: BdContact[]; members: Member[]; events: BdEvent[]; back: string; canEdit: boolean; canAssign: boolean; meId: string; showEvent?: boolean;
}) {
  const who = (id: string | null) => (id ? members.find(m => m.id === id)?.full_name || members.find(m => m.id === id)?.email || 'Former member' : '');
  const formId = `bulk-${back.replace(/\W+/g, '')}`;
  return (
    <div className="ctable">
      {canEdit ? (
        <form id={formId} action={contactBulkAction} className="bulkbar">
          <input type="hidden" name="return" value={back} />
          <b>With selected:</b>
          <button className="btn btn-sm" name="op" value="take">Take them</button>
          {canAssign ? <>
            <select name="owner" aria-label="Assign to"><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select>
            <button className="btn btn-sm" name="op" value="assign">Assign</button>
            <details className="rrpick"><summary className="btn btn-sm">Round-robin…</summary>
              <div className="rr">{members.map(m => <label key={m.id} className="chk"><input type="checkbox" name="people" value={m.id} />{m.full_name || m.email}</label>)}
                <button className="btn btn-sm btn-primary" name="op" value="roundrobin">Share between them</button></div>
            </details>
          </> : null}
          <select name="meeting_status" aria-label="Meeting status">{MEETING_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
          <button className="btn btn-sm" name="op" value="status">Set status</button>
          <input type="date" name="followup_on" aria-label="Follow-up date" />
          <button className="btn btn-sm" name="op" value="followup">Set follow-up</button>
        </form>
      ) : null}
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr>{canEdit ? <th><span className="sr-only">Select</span></th> : null}<th>Person</th><th>Organisation</th>{showEvent ? <th>Met at</th> : null}<th>Status</th><th>Owner</th><th>Follow-up</th><th>Details / next action</th><th></th></tr></thead>
        <tbody>{contacts.length ? contacts.map(c => (
          <tr key={c.id}>
            {canEdit ? <td><input type="checkbox" name="ids" value={c.id} form={formId} aria-label={`Select ${c.name || c.organisation}`} /></td> : null}
            <td><b>{c.name || '—'}</b><div className="sub muted">{c.title || ''}</div><div className="sub mono-sm">{c.email || ''}{c.phone ? ` · ${c.phone}` : ''}</div></td>
            <td>{c.organisation || '—'}{c.introducer ? <div className="sub muted">Intro via {c.introducer}</div> : null}</td>
            {showEvent ? <td>{c.event_id ? <Link href={`/events/${c.event_id}?tab=contacts`}>{events.find(e => e.id === c.event_id)?.name || 'Event'}</Link> : <span className="muted">{c.source || '—'}</span>}</td> : null}
            <td><span className={`badge ${TONE[c.meeting_status] || 'b-neu'}`}>{c.meeting_status}</span></td>
            <td>{who(c.owner) || <span className="muted">Unassigned</span>}</td>
            <td><FollowUp date={c.followup_on} /></td>
            <td className="clip">{c.details || ''}{c.next_action ? <div className="sub"><b>Next:</b> {c.next_action}</div> : null}</td>
            <td className="acts">
              {c.converted_lead ? <Link className="btn btn-sm" href={`/leads/${c.converted_lead}`}>Open lead</Link> : canEdit ? (
                <details className="rowedit"><summary className="btn btn-sm">Edit</summary>
                  <form action={contactSaveAction} className="formgrid mini">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="return" value={back} />
                    <label className="fld">Person<input type="text" name="name" defaultValue={c.name || ''} /></label>
                    <label className="fld">Organisation<input type="text" name="organisation" defaultValue={c.organisation || ''} /></label>
                    <label className="fld">Title<input type="text" name="title" defaultValue={c.title || ''} /></label>
                    <label className="fld">Email<input type="email" name="email" defaultValue={c.email || ''} /></label>
                    <label className="fld">Phone<input type="text" name="phone" defaultValue={c.phone || ''} /></label>
                    <label className="fld">Status<select name="meeting_status" defaultValue={c.meeting_status}>{MEETING_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="fld">Owner<select name="owner" defaultValue={c.owner || ''}><option value="">Unassigned</option>{members.filter(m => canAssign || m.id === meId || m.id === c.owner).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
                    <label className="fld">Follow-up<input type="date" name="followup_on" defaultValue={c.followup_on || ''} /></label>
                    <label className="fld">Introducer<input type="text" name="introducer" defaultValue={c.introducer || ''} /></label>
                    <label className="fld wide">Details<textarea name="details" defaultValue={c.details || ''} /></label>
                    <label className="fld wide">Next action<input type="text" name="next_action" defaultValue={c.next_action || ''} /></label>
                    <div className="wide"><button className="btn btn-primary btn-sm" type="submit">Save</button></div>
                  </form>
                  <form action={contactConvertAction} className="inline convert">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="return" value={back} />
                    <select name="kind" aria-label="Lead type"><option value="CSR">CSR</option><option value="Grant">Grant</option><option value="Tender">Tender</option><option value="RFP / EOI">RFP / EOI</option></select>
                    <button className="btn btn-sm btn-teal" type="submit">Convert to lead</button>
                  </form>
                </details>
              ) : null}
            </td>
          </tr>
        )) : <tr><td colSpan={9} className="muted">No contacts yet.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}

/** Small "add one contact" form. */
export function AddContact({ back, eventId, members, canAssign, meId }: { back: string; eventId?: number; members: Member[]; canAssign: boolean; meId: string }) {
  return (
    <form action={contactSaveAction} className="formgrid">
      <input type="hidden" name="return" value={back} />
      {eventId ? <input type="hidden" name="event_id" value={eventId} /> : null}
      <input type="hidden" name="source" value={eventId ? 'Event' : 'Personal network'} />
      <label className="fld">Person<input type="text" name="name" /></label>
      <label className="fld">Organisation<input type="text" name="organisation" /></label>
      <label className="fld">Title<input type="text" name="title" /></label>
      <label className="fld">Email<input type="email" name="email" /></label>
      <label className="fld">Phone<input type="text" name="phone" /></label>
      <label className="fld">Date met<input type="date" name="met_on" /></label>
      <label className="fld">Status<select name="meeting_status" defaultValue="To contact">{MEETING_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="fld">Owner<select name="owner" defaultValue={meId}><option value="">Unassigned</option>{members.filter(m => canAssign || m.id === meId).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
      <label className="fld">Follow-up<input type="date" name="followup_on" /></label>
      <label className="fld">Introducer / warm intro via<input type="text" name="introducer" /></label>
      <label className="fld wide">Details<textarea name="details" /></label>
      <label className="fld wide">Next action<input type="text" name="next_action" /></label>
      <div className="wide"><button className="btn btn-primary" type="submit">Add contact</button></div>
    </form>
  );
}
