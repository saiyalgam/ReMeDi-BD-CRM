import { accessAddAction, accessRemoveAction, feedAddAction, feedRemoveAction, nameAction, orgRoleAction, roleAction } from '@/app/actions';
import Link from 'next/link';
import { ORG_ROLES } from '@/lib/types';
import { Who } from '@/components/ui';
import { getSession, lastIngest, listAccess, listFeeds, listLeads, listMembers } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';
import { isOpen } from '@/lib/views';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default async function TeamPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, members, leads, access, feeds, run] = await Promise.all([getSession(), listMembers(), listLeads(), listAccess(), listFeeds(), lastIngest()]);
  const admin = session?.user.role === 'admin';
  const msg = one(sp.msg), err = one(sp.err);

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">Team</div>
          <h1>Users &amp; access</h1>
          <p>Who can sign in, each person’s organisation role (drives permissions — see <Link href="/settings/permissions">Roles &amp; permissions</Link>), admin access, and news feeds.</p>
        </div>
      </div>
      {msg ? <div className="note ok">{msg}</div> : null}
      {err ? <div className="note err">{err}</div> : null}

      <section className="card">
        <header><div><h2>Members</h2><p>Everyone who has signed in. New people appear here after their first login.</p></div></header>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Person</th><th>Email</th><th className="r">Open leads owned</th><th className="r">Leads checked</th><th>Organisation role</th><th>System admin</th></tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td><Who name={m.full_name || m.email} /></td>
                <td className="mono">{m.email}</td>
                <td className="r">{leads.filter(l => l.assigned_to === m.id && isOpen(l)).length}</td>
                <td className="r">{leads.filter(l => l.verified_by === m.id).length}</td>
                <td>
                  {admin ? (
                    <form action={orgRoleAction} className="inline">
                      <input type="hidden" name="id" value={m.id} />
                      <select name="org_role" defaultValue={m.org_role || ''} aria-label={`Organisation role for ${m.email}`} key={m.org_role || 'none'}><option value="">Not set (BD Executive)</option>{ORG_ROLES.map(r => <option key={r}>{r}</option>)}</select>
                      <button className="btn btn-sm" type="submit">Save</button>
                    </form>
                  ) : <span className="pill">{m.org_role || 'Not set'}</span>}
                </td>
                <td>
                  {admin && m.id !== session?.user.id ? (
                    <form action={roleAction} className="inline">
                      <input type="hidden" name="id" value={m.id} />
                      <select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`} key={m.role}><option value="member">Member</option><option value="admin">Admin</option></select>
                      <button className="btn btn-sm" type="submit">Save</button>
                    </form>
                  ) : <span className="pill">{m.role === 'admin' ? 'Admin' : 'Member'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <form action={nameAction} className="inline">
          <label className="fld">Your display name<input type="text" name="full_name" defaultValue={session?.user.full_name || ''} required maxLength={80} /></label>
          <button className="btn" type="submit" style={{ alignSelf: 'end' }}>Save name</button>
        </form>
      </section>

      <div className="grid2">
        <section className="card">
          <header><div><h2>Who can sign in</h2><p>A full email or a whole domain (starting with @).</p></div></header>
          <table className="tbl"><tbody>
            {access.map(a => (
              <tr key={a.pattern}>
                <td className="mono">{a.pattern}</td><td className="muted">{a.note}</td>
                <td className="r">{admin ? <form action={accessRemoveAction}><input type="hidden" name="pattern" value={a.pattern} /><button className="btn btn-sm btn-bad" type="submit">Remove</button></form> : null}</td>
              </tr>
            ))}
          </tbody></table>
          {admin ? (
            <form action={accessAddAction} className="inline">
              <input type="text" name="pattern" placeholder="name@company.com or @company.com" aria-label="Email or domain" required />
              <input type="text" name="note" placeholder="Note (optional)" aria-label="Note" />
              <button className="btn btn-primary" type="submit">Add</button>
            </form>
          ) : <p className="muted">Only admins can change this list.</p>}
        </section>

        <section className="card">
          <header><div><h2>News feeds</h2><p>RSS or Atom feeds pulled every morning.</p></div></header>
          <table className="tbl"><tbody>
            {feeds.map(f => (
              <tr key={f.id}>
                <td><b>{f.name}</b><div className="muted" style={{ fontSize: 12 }}>{f.topic}</div></td>
                <td className="r">{admin ? <form action={feedRemoveAction}><input type="hidden" name="id" value={f.id} /><button className="btn btn-sm btn-bad" type="submit">Remove</button></form> : null}</td>
              </tr>
            ))}
          </tbody></table>
          {admin ? (
            <form action={feedAddAction} style={{ display: 'grid', gap: 8 }}>
              <input type="url" name="url" placeholder="https://… feed URL" aria-label="Feed URL" required />
              <div className="inline">
                <input type="text" name="name" placeholder="Name" aria-label="Feed name" />
                <input type="text" name="topic" placeholder="Topic (Tenders, CSR…)" aria-label="Topic" />
                <button className="btn btn-primary" type="submit">Add feed</button>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Tip: any Google News search works as a feed: https://news.google.com/rss/search?q=your+words&amp;hl=en-IN&amp;gl=IN&amp;ceid=IN:en</p>
            </form>
          ) : null}
        </section>
      </div>

      <section className="card">
        <header><div><h2>Crawler connection</h2><p>The n8n workflow sends scored leads here every morning.</p></div></header>
        <dl className="facts">
          <div><dt>Endpoint</dt><dd className="mono">POST /api/ingest</dd></div>
          <div><dt>Auth header</dt><dd className="mono">Authorization: Bearer INGEST_TOKEN</dd></div>
          <div><dt>Last delivery</dt><dd>{run ? `${fmtDateTime(run.run_at)} IST: ${run.inserted} new of ${run.received}` : 'None yet'}</dd></div>
        </dl>
      </section>
    </>
  );
}
