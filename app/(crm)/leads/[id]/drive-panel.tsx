// Google Drive folder for one opportunity (update 4). Shows honest states: not configured / not connected /
// no root folder / folder not created / creating / ready / error. Never claims Drive works without a connection.
import Link from 'next/link';
import { driveFolderAction, driveLinkAction, driveUnlinkAction } from '@/app/actions';
import { Badge, Denied } from '@/components/ui';
import { driveStatus, leadDrive } from '@/lib/drive-data';
import { fmtDateTime, nameOf } from '@/lib/format';
import { can } from '@/lib/perm';
import { DRIVE_SUBFOLDERS, KB_CONFIDENTIALITY, type Lead, type Member, type Session } from '@/lib/types';

export async function DrivePanel({ lead: l, session: s, members }: { lead: Lead; session: Session; members: Member[] }) {
  const [st, { folder, files, installed }] = await Promise.all([driveStatus(), leadDrive(l.id)]);
  const ret = `/leads/${l.id}?tab=documents`;
  let state: { tone: 'ok' | 'warn' | 'bad' | 'neu'; label: string; text: string };
  if (s.demo) state = { tone: 'neu', label: 'Not available in demo', text: 'Google Drive works only on a real deployment with an administrator connection.' };
  else if (!st.installed || !installed) state = { tone: 'neu', label: 'Not installed', text: 'Run supabase/update-4.sql to enable opportunity folders.' };
  else if (st.problems.length) state = { tone: 'neu', label: 'Not configured', text: 'An administrator must add the Google Drive settings to the deployment (see README).' };
  else if (st.connection?.status !== 'Connected') state = { tone: 'warn', label: 'Not connected', text: 'An administrator connects Google Drive on Settings › Integrations.' };
  else if (!st.settings?.drive_root_id) state = { tone: 'warn', label: 'No root folder', text: 'An administrator chooses the “CRM Opportunities” root folder on Settings › Integrations.' };
  else if (!folder) state = { tone: 'neu', label: 'No folder yet', text: 'Create the folder now — you do not need to wait for the Go / No-go decision.' };
  else if (folder.status === 'Ready') state = { tone: 'ok', label: 'Folder ready', text: `Last checked ${folder.last_synced_at ? fmtDateTime(folder.last_synced_at) : '—'}.` };
  else if (folder.status === 'Error') state = { tone: 'bad', label: 'Folder error', text: folder.error || 'Creating the folder failed.' };
  else state = { tone: 'warn', label: 'Creating…', text: 'The folder is being created. Reload in a moment; if it stays here, try again.' };
  const canCreate = can(s, 'drive.folder') && st.ready;
  const canLink = can(s, 'drive.link') && !s.demo && st.installed && installed;
  return (
    <section className="card" aria-labelledby="drv-h">
      <header>
        <div><h2 id="drv-h">Google Drive folder</h2><p>One folder per opportunity, named by its reference: <span className="mono-sm">{l.ref_code || 'OPP-…'} - {l.title.slice(0, 40)}</span>, with six subfolders. Sharing is never changed by the CRM.</p></div>
        <Badge tone={state.tone}>{state.label}</Badge>
      </header>
      <p style={{ margin: 0, fontSize: 13.5 }}>{state.text}</p>
      {folder?.status === 'Ready' && folder.folder_url ? (
        <div className="inline" style={{ flexWrap: 'wrap', gap: 6 }}>
          <a className="btn btn-sm" href={folder.folder_url} target="_blank" rel="noreferrer">Open folder ↗</a>
          {DRIVE_SUBFOLDERS.map(n => folder.subfolders[n] ? <a key={n} className="mini-chip" href={`https://drive.google.com/drive/folders/${folder.subfolders[n]}`} target="_blank" rel="noreferrer">{n}</a> : <span key={n} className="mini-chip muted">{n} (missing)</span>)}
        </div>
      ) : null}
      {canCreate && folder?.status !== 'Ready' ? (
        <form action={driveFolderAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={ret} />
          <button className="btn btn-primary" type="submit">{folder ? 'Try again' : 'Create Go / No-go Drive folder'}</button>
          <span className="hint-text"> Safe to press twice: existing folders are reused.</span>
        </form>
      ) : folder?.status === 'Ready' && canCreate ? (
        <form action={driveFolderAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={ret} /><button className="btn btn-sm" type="submit">Check / repair folders</button></form>
      ) : !can(s, 'drive.folder') && !s.demo ? <p className="hint-text" style={{ margin: 0 }}>Your role cannot create Drive folders (permission “Create the Drive folder for an opportunity”).</p> : null}

      <h3 className="h" style={{ marginBottom: 0 }}>Linked Drive files</h3>
      {files.length ? (
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>File</th><th>Subfolder</th><th>Sensitivity</th><th>How</th><th>Added</th><th /></tr></thead>
          <tbody>{files.map(f => (
            <tr key={f.id}>
              <td className="t">{f.web_url ? <a href={f.web_url} target="_blank" rel="noreferrer">{f.name} ↗</a> : f.name}{f.note ? <div className="sub">{f.note}</div> : null}{f.kb_document_id ? <div className="sub"><Link href={`/knowledge/${f.kb_document_id}`}>Knowledge-base record</Link></div> : null}</td>
              <td className="sub">{f.subfolder || '—'}</td>
              <td><Badge tone={f.sensitivity === 'Restricted' ? 'bad' : 'neu'}>{f.sensitivity}</Badge></td>
              <td>{f.mode === 'Copy' ? 'Copied' : 'Linked'}{f.verified ? <div className="sub">checked in Drive{f.modified_time ? ` · modified ${fmtDateTime(f.modified_time)}` : ''}</div> : <div className="sub" style={{ color: 'var(--warning-text)' }}>not verified</div>}</td>
              <td className="sub">{nameOf(members, f.linked_by)}<br />{fmtDateTime(f.created_at)}</td>
              <td>{canLink ? <form action={driveUnlinkAction}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="fid" value={f.id} /><input type="hidden" name="return" value={ret} /><button className="btn btn-sm" type="submit" title="Removes the link in the CRM only">Unlink</button></form> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No Drive files linked yet.</p>}
      {canLink ? (
        <details className="drawer">
          <summary>+ Link or copy a Drive file</summary>
          <form action={driveLinkAction} className="body stack">
            <input type="hidden" name="id" value={l.id} /><input type="hidden" name="return" value={ret} />
            <div className="two">
              <label className="fld">Drive link or file ID <span className="req">*</span><input type="text" name="file" required placeholder="https://drive.google.com/file/d/…" /></label>
              <label className="fld">File name <span className="hint-text">(used if the CRM cannot read it)</span><input type="text" name="name" /></label>
            </div>
            <div className="two">
              <label className="fld">Subfolder<select name="subfolder" defaultValue="02 Company evidence"><option value="">—</option>{DRIVE_SUBFOLDERS.map(n => <option key={n}>{n}</option>)}</select></label>
              <label className="fld">Sensitivity<select name="sensitivity" defaultValue="Internal">{KB_CONFIDENTIALITY.filter(c => c !== 'Restricted' || can(s, 'kb.read_restricted')).map(c => <option key={c}>{c}</option>)}</select></label>
            </div>
            <div className="two">
              <label className="fld">How<select name="mode" defaultValue="Link"><option value="Link">Link only (file stays where it is)</option>{st.settings?.copy_policy === 'copy_internal' ? <option value="Copy">Copy into the opportunity folder</option> : null}</select></label>
              <label className="fld">Knowledge-base record no. <span className="hint-text">(optional)</span><input type="number" name="kb_document_id" min={1} /></label>
            </div>
            <label className="fld">Note<input type="text" name="note" placeholder="Why this file matters for the bid" /></label>
            <p className="hint-text" style={{ margin: 0 }}>Restricted files are never copied. Linking does not change who can open the file in Google Drive.</p>
            <div><button className="btn btn-primary" type="submit">Save</button></div>
          </form>
        </details>
      ) : !s.demo && !can(s, 'drive.link') ? <Denied>Your role cannot link Drive files.</Denied> : null}
    </section>
  );
}
