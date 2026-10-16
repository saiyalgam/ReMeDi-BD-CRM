import { driveCopyPolicyAction, driveDisconnectAction, driveRootAction } from '@/app/actions';
import { Badge, Empty, Notes, PageHead } from '@/components/ui';
import { driveStatus } from '@/lib/drive-data';
import { can } from '@/lib/perm';
import { getSession, lastIngest, listMembers } from '@/lib/data';
import { listEvents } from '@/lib/data-ext';
import { chatStatus } from '@/lib/google';
import { fmtDateTime, nameOf } from '@/lib/format';

export const metadata = { title: 'Integrations' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function IntegrationsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, events, run, members, drive] = await Promise.all([getSession(), listEvents(), lastIngest(), listMembers(), driveStatus()]);
  const chat = chatStatus();
  const driveLabel = session?.demo ? 'Demo: not available' : !drive.installed ? 'Not installed' : drive.problems.length ? 'Not configured' : drive.connection?.status === 'Connected' ? (drive.settings?.drive_root_id ? 'Connected' : 'Connected · no root folder') : drive.connection?.status === 'Error' ? 'Error' : 'Not connected';
  const driveTone = driveLabel === 'Connected' ? 'ok' : driveLabel === 'Error' ? 'bad' : driveLabel.startsWith('Connected') ? 'warn' : 'neu';
  return (
    <>
      <PageHead eyebrow="Settings" title="Integrations & notifications" crumbs={[{ href: '/settings', label: 'Settings' }]}>
        Nothing here claims to be live without working credentials and administrator setup. Status is shown honestly below.
      </PageHead>

      <Notes sp={sp} />
      <section className="card" aria-labelledby="gd-h">
        <header>
          <div><h2 id="gd-h">Google Drive — opportunity folders</h2><p>One organisation connection. The CRM creates <span className="mono-sm">CRM Opportunities/OPP-YYYY-NNNN - Short title/</span> with six subfolders, and links or copies files. It never changes sharing and never reads anyone’s whole Drive.</p></div>
          <Badge tone={driveTone}>{driveLabel}</Badge>
        </header>
        {!drive.installed ? <p style={{ margin: 0 }}>Run <span className="mono-sm">supabase/update-4.sql</span> in Supabase first.</p> : null}
        {drive.problems.length ? <div className="note warn"><span>Not configured. Missing deployment settings (names only): <span className="mono-sm">{drive.problems.join(', ')}</span>. See README › Google Drive.</span></div> : null}
        <dl className="facts" style={{ margin: 0 }}>
          <div><dt>Connection</dt><dd>{drive.connection ? <>{drive.connection.status}{drive.connection.account_email ? ` · ${drive.connection.account_email}` : ''}{drive.connection.connected_at ? ` · since ${fmtDateTime(drive.connection.connected_at)}` : ''}</> : 'Not connected'}{drive.connection?.last_error ? <div className="sub" style={{ color: 'var(--critical-text)' }}>{drive.connection.last_error}</div> : null}</dd></div>
          <div><dt>Access requested</dt><dd className="mono-sm">{drive.connection?.scopes?.includes('auth/drive.file') ? 'drive.file (only files the CRM created or that were picked)' : drive.connection?.scopes || '—'}</dd></div>
          <div><dt>Root folder</dt><dd>{drive.settings?.drive_root_id ? <a href={drive.settings.drive_root_url || '#'} target="_blank" rel="noreferrer">{drive.settings.drive_root_name || drive.settings.drive_root_id} ↗</a> : 'Not set'}{drive.settings?.shared_drive_id ? <div className="sub">in a Shared Drive</div> : null}</dd></div>
          <div><dt>Copy policy</dt><dd>{drive.settings?.copy_policy === 'copy_internal' ? 'Internal and Confidential files may be copied; Restricted files are only linked' : 'Link only'}</dd></div>
          <div><dt>AI / embeddings</dt><dd>Off — no document text is sent to any AI or embedding provider.</dd></div>
        </dl>
        {can(session, 'drive.admin') && !session?.demo ? <>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
            {!drive.problems.length && drive.installed ? <a className="btn btn-primary" href="/api/google/drive/connect">{drive.connection?.status === 'Connected' ? 'Reconnect Google Drive' : 'Connect Google Drive'}</a> : <button className="btn" disabled title="Configure the deployment first">Connect Google Drive</button>}
            {drive.connection?.status === 'Connected' ? <form action={driveDisconnectAction}><button className="btn btn-bad" type="submit">Disconnect and delete token</button></form> : null}
          </div>
          {drive.connection?.status === 'Connected' ? <>
            <form action={driveRootAction} className="stack card">
              <h3 className="h" style={{ margin: 0 }}>Root folder</h3>
              <label className="fld">Folder link or ID <span className="hint-text">— leave empty to create “CRM Opportunities” in the connected account’s My Drive</span><input type="text" name="folder" placeholder="https://drive.google.com/drive/folders/…" /></label>
              <label className="fld">Use it as<select name="mode" defaultValue="create_under"><option value="create_under">Parent: create “CRM Opportunities” inside it</option><option value="use">The root itself</option></select></label>
              <p className="hint-text" style={{ margin: 0 }}>With the drive.file scope, an existing folder is visible only if the CRM created it or it was chosen with the Google Picker by the connected account. Prefer a Shared Drive folder that is already shared with the team: new folders inherit its sharing.</p>
              <div><button className="btn" type="submit">Verify and save</button></div>
            </form>
            <form action={driveCopyPolicyAction} className="inline card" style={{ flexWrap: 'wrap', gap: 8 }}>
              <label className="fld" style={{ minWidth: 280 }}>Copy policy<select name="copy_policy" defaultValue={drive.settings?.copy_policy || 'link_only'}><option value="link_only">Link only</option><option value="copy_internal">Allow copies of Internal / Confidential files</option></select></label>
              <button className="btn" type="submit">Save policy</button>
            </form>
          </> : null}
        </> : <p className="hint-text" style={{ margin: 0 }}>{session?.demo ? 'Demo mode: Drive is never connected.' : 'Only roles with “Connect Google Drive, choose the root folder and copy policy” can change this.'}</p>}
      </section>

      <div className="grid2">
        <section className="card">
          <header><div><h2>Google Calendar (manual hand-off)</h2><p>“Schedule a meeting” prepares the event and opens Google Calendar’s own create page in the person’s account. The CRM holds no Calendar credentials and makes no Calendar API call.</p></div><Badge tone="neu">Manual</Badge></header>
          <ul className="openlist">
            <li>The person who clicks is the organiser and checks title, time, attendees and agenda before saving in Google Calendar.</li>
            <li>Nothing is created until they press Save there.</li>
          </ul>
        </section>
        <section className="card">
          <header><div><h2>Google Meet</h2><p>Creating Meet links from the CRM.</p></div><Badge tone="neu">Planned</Badge></header>
          <p style={{ margin: 0, fontSize: 13.5 }}>Planned — not part of this release. No Meet API call is made and no credentials are stored. Until then, add the Meet link in Google Calendar when saving the event.</p>
        </section>
        <section className="card">
          <header><div><h2>Google Chat notifications</h2><p>Posting assignment and approval notices to a team space.</p></div><Badge tone="neu">Planned</Badge></header>
          <p style={{ margin: 0, fontSize: 13.5 }}>{chat.reason} Any Chat webhook settings left on an older deployment are ignored.</p>
        </section>
      </div>

      <section className="card">
        <header><div><h2>Delivery log</h2><p>Meetings prepared through the Calendar hand-off (and any older Chat notices), with their outcome.</p></div></header>
        {events.length ? (
          <div className="tbl-wrap"><table className="tbl plain">
            <thead><tr><th>When</th><th>Kind</th><th>What</th><th>By</th><th>Status</th></tr></thead>
            <tbody>{events.slice(0, 100).map(e => <tr key={e.id}><td className="mono-sm">{fmtDateTime(e.created_at)}</td><td>{e.kind === 'calendar' ? 'Calendar' : 'Chat'}</td><td>{e.title}{e.error ? <div className="sub">{e.error}</div> : null}</td><td>{nameOf(members, e.created_by)}</td><td><Badge tone={e.status === 'Sent' || e.status === 'Opened in Google' ? 'ok' : e.status === 'Failed' ? 'bad' : 'neu'}>{e.status}</Badge></td></tr>)}</tbody>
          </table></div>
        ) : <Empty title="Nothing sent or prepared yet" />}
      </section>

      <div className="grid2">
        <section className="card">
          <header><div><h2>Crawler (n8n)</h2><p>Posts leads to <span className="mono-sm">/api/ingest</span> with the ingest token.</p></div><Badge tone={run ? 'ok' : 'neu'}>{run ? 'Connected' : 'No delivery yet'}</Badge></header>
          <p style={{ margin: 0, fontSize: 13.5 }}>{run ? `Last delivery ${fmtDateTime(run.run_at)} IST: ${run.received} sent, ${run.inserted} new.` : 'Configure the crawler as described in the README.'} A later closing date reported by the crawler is recorded as an unverified amendment for the Review queue; it changes the active deadline only after someone verifies it.</p>
        </section>
        <section className="card">
          <header><div><h2>Email</h2><p>Not used for sending.</p></div><Badge tone="neu">Off</Badge></header>
          <p style={{ margin: 0, fontSize: 13.5 }}>Document requests are drafted in the CRM and sent by a person from their own mailbox (an “Open in my email app” button fills in the draft). Sign-in links use the SMTP set up in Supabase. A separate licensed “noreply” user is not needed; if automatic emails are added later, a sending alias or shared mailbox is usually enough — confirm with the Workspace admin.</p>
        </section>
      </div>
      <p className="legal">You are signed in as {session?.user.email}.</p>
    </>
  );
}
