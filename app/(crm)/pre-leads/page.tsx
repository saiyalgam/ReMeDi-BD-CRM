import Link from 'next/link';
import { preLeadConvertAction, preLeadSaveAction } from '@/app/outreach-actions';
import { OutreachUpload } from '@/components/OutreachUpload';
import { Denied, FollowUp, Notes } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { listPreLeads } from '@/lib/outreach';
import { PRELEAD_STATUSES } from '@/lib/types';

export const metadata = { title: 'Pre-Leads' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const TONE: Record<string, string> = { Assigned: 'b-info', Exploring: 'b-q', 'In progress': 'b-info', 'On hold': 'b-warn', Lost: 'b-neu', Converted: 'b-ok' };

export default async function PreLeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, list, members] = await Promise.all([getSession(), listPreLeads(), listMembers()]);
  if (!can(session, 'outreach.read')) return <Denied>Your role cannot see pre-leads.</Denied>;
  const me = session!.user.id; const canEdit = can(session, 'outreach.edit'); const canAssign = can(session, 'outreach.assign');
  const owners = members.filter(m => canAssign || m.id === me);
  const open = list.filter(p => !['Lost', 'Converted'].includes(p.status));
  const closed = list.filter(p => ['Lost', 'Converted'].includes(p.status));
  const people = members.map(m => ({ id: m.id, name: m.full_name || m.email, email: m.email }));
  return (
    <>
      <div className="phead">
        <div><div className="eyebrow">Outreach</div><h1>Pre-Leads</h1><p>Early opportunities being explored. Convert one to a lead when it becomes a real opportunity.</p></div>
        {canEdit ? <div className="inline"><a className="btn" href="#upload">Upload (Excel)</a><a className="btn btn-primary" href="?add=1#add">+ Add pre-lead</a></div> : null}
      </div>
      <Notes sp={sp} />
      {[['Open', open], ['Lost and converted', closed]].map(([title, rows]) => (
        <section key={title as string} className="card tbl-card">
          <header><h2>{title as string}</h2><p>{(rows as typeof list).length}</p></header>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>S. No.</th><th>Task</th><th>Opportunity details</th><th>Status</th><th>Steps</th><th>Owner</th><th>Due</th><th></th></tr></thead>
            <tbody>{(rows as typeof list).length ? (rows as typeof list).map((p, i) => (
              <tr key={p.id}>
                <td className="num">{i + 1}</td>
                <td><b>{p.task}</b></td>
                <td className="clip">{p.opportunity || '—'}</td>
                <td><span className={`badge ${TONE[p.status]}`}>{p.status}</span></td>
                <td className="clip">{p.steps || '—'}</td>
                <td>{nameOf(members, p.owner) || <span className="muted">Unassigned</span>}</td>
                <td><FollowUp date={p.due_on} /></td>
                <td className="acts">
                  {p.converted_lead ? <Link className="btn btn-sm" href={`/leads/${p.converted_lead}`}>Open lead</Link> : canEdit ? (
                    <details className="rowedit"><summary className="btn btn-sm">Edit</summary>
                      <form action={preLeadSaveAction} className="formgrid mini">
                        <input type="hidden" name="id" value={p.id} />
                        <label className="fld wide">Task<input type="text" name="task" defaultValue={p.task} /></label>
                        <label className="fld wide">Opportunity<textarea name="opportunity" defaultValue={p.opportunity || ''} /></label>
                        <label className="fld">Status<select name="status" defaultValue={p.status}>{PRELEAD_STATUSES.filter(s => s !== 'Converted').map(s => <option key={s}>{s}</option>)}</select></label>
                        <label className="fld">Owner<select name="owner" defaultValue={p.owner || ''}><option value="">Unassigned</option>{members.filter(m => canAssign || m.id === me || m.id === p.owner).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
                        <label className="fld">Due<input type="date" name="due_on" defaultValue={p.due_on || ''} /></label>
                        <label className="fld wide">Steps<textarea name="steps" defaultValue={p.steps || ''} /></label>
                        <div className="wide"><button className="btn btn-primary btn-sm">Save</button></div>
                      </form>
                      <form action={preLeadConvertAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm btn-teal">Convert to lead</button></form>
                    </details>
                  ) : null}
                </td>
              </tr>
            )) : <tr><td colSpan={8} className="muted">None.</td></tr>}</tbody>
          </table></div>
        </section>
      ))}
      {canEdit ? <>
        <details className="card" id="add" open={sp.add === '1'}><summary><h2 className="inline-h">Add a pre-lead</h2></summary>
          <form action={preLeadSaveAction} className="formgrid">
            <label className="fld wide">Task *<input type="text" name="task" required /></label>
            <label className="fld wide">Opportunity details<textarea name="opportunity" /></label>
            <label className="fld">Status<select name="status" defaultValue="Assigned">{PRELEAD_STATUSES.filter(s => s !== 'Converted').map(s => <option key={s}>{s}</option>)}</select></label>
            <label className="fld">Owner<select name="owner" defaultValue={me}><option value="">Unassigned</option>{owners.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
            <label className="fld">Due<input type="date" name="due_on" /></label>
            <label className="fld">Source<input type="text" name="source" placeholder="Event, referral, inbound…" /></label>
            <label className="fld wide">Steps<textarea name="steps" /></label>
            <div className="wide"><button className="btn btn-primary">Add pre-lead</button></div>
          </form>
        </details>
        <section className="card" id="upload"><header><h2>Upload pre-leads from Excel</h2><p>For example the “Pre-Leads Tracking” sheet (Task, Opportunity Details, Completion Status, Steps).</p></header>
          <OutreachUpload target="preleads" people={people} me={me} canAssign={canAssign} />
        </section>
      </> : null}
    </>
  );
}
