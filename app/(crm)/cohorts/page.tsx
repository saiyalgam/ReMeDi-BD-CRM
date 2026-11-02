import { cohortSaveAction } from '@/app/outreach-actions';
import { OutreachUpload } from '@/components/OutreachUpload';
import { Denied, FollowUp, Notes } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { listCohorts } from '@/lib/outreach';
import { COHORT_STATUSES } from '@/lib/types';

export const metadata = { title: 'Cohorts' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const TONE: Record<string, string> = { Applied: 'b-info', Waiting: 'b-q', Joined: 'b-ok', 'Conversation initiated': 'b-out', 'Not selected': 'b-neu', Closed: 'b-neu' };

export default async function CohortsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, list, members] = await Promise.all([getSession(), listCohorts(), listMembers()]);
  if (!can(session, 'outreach.read')) return <Denied>Your role cannot see cohorts.</Denied>;
  const me = session!.user.id; const canEdit = can(session, 'outreach.edit'); const canAssign = can(session, 'outreach.assign');
  const people = members.map(m => ({ id: m.id, name: m.full_name || m.email, email: m.email }));
  return (
    <>
      <div className="phead">
        <div><div className="eyebrow">Grants & CSR</div><h1>Cohorts</h1><p>Accelerators, networks and programmes we have applied to or joined.</p></div>
        {canEdit ? <a className="btn btn-primary" href="#add">+ Add cohort</a> : null}
      </div>
      <Notes sp={sp} />
      <section className="card tbl-card">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Cohort / programme</th><th>Status</th><th>Contact</th><th>Next step</th><th>Updates</th><th>Deadline</th><th>Owner</th><th></th></tr></thead>
          <tbody>{list.length ? list.map(c => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td><td><span className={`badge ${TONE[c.status]}`}>{c.status}</span></td><td>{c.contact || '—'}</td>
              <td className="clip">{c.next_step || '—'}</td><td className="clip">{c.updates || '—'}</td><td><FollowUp date={c.deadline} /></td>
              <td>{nameOf(members, c.owner) || <span className="muted">Unassigned</span>}</td>
              <td className="acts">{canEdit ? (
                <details className="rowedit"><summary className="btn btn-sm">Edit</summary>
                  <form action={cohortSaveAction} className="formgrid mini">
                    <input type="hidden" name="id" value={c.id} />
                    <label className="fld wide">Name<input type="text" name="name" defaultValue={c.name} /></label>
                    <label className="fld">Status<select name="status" defaultValue={c.status}>{COHORT_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                    <label className="fld">Contact<input type="text" name="contact" defaultValue={c.contact || ''} /></label>
                    <label className="fld">Deadline<input type="date" name="deadline" defaultValue={c.deadline || ''} /></label>
                    <label className="fld">Owner<select name="owner" defaultValue={c.owner || ''}><option value="">Unassigned</option>{members.filter(m => canAssign || m.id === me || m.id === c.owner).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
                    <label className="fld wide">Next step<input type="text" name="next_step" defaultValue={c.next_step || ''} /></label>
                    <label className="fld wide">Updates<textarea name="updates" defaultValue={c.updates || ''} /></label>
                    <div className="wide"><button className="btn btn-primary btn-sm">Save</button></div>
                  </form>
                </details>
              ) : null}</td>
            </tr>
          )) : <tr><td colSpan={8} className="muted">No cohorts yet.</td></tr>}</tbody>
        </table></div>
      </section>
      {canEdit ? <>
        <section className="card" id="add"><header><h2>Add a cohort</h2></header>
          <form action={cohortSaveAction} className="formgrid">
            <label className="fld wide">Name *<input type="text" name="name" required /></label>
            <label className="fld">Status<select name="status" defaultValue="Conversation initiated">{COHORT_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
            <label className="fld">Contact<input type="text" name="contact" /></label>
            <label className="fld">Deadline<input type="date" name="deadline" /></label>
            <label className="fld">Owner<select name="owner" defaultValue={me}><option value="">Unassigned</option>{members.filter(m => canAssign || m.id === me).map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}</select></label>
            <label className="fld wide">Next step<input type="text" name="next_step" /></label>
            <label className="fld wide">Updates<textarea name="updates" /></label>
            <div className="wide"><button className="btn btn-primary">Add cohort</button></div>
          </form>
        </section>
        <section className="card"><header><h2>Upload cohorts from Excel</h2><p>For example the “Cohorts” sheet (Cohorts, Updates). The status is read from the update text.</p></header>
          <OutreachUpload target="cohorts" people={people} me={me} canAssign={canAssign} />
        </section>
      </> : null}
    </>
  );
}
