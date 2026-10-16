import { Fragment } from 'react';
import Link from 'next/link';
import { orgRoleAction, permAction } from '@/app/actions';
import { Badge, Notes, PageHead, Who } from '@/components/ui';
import { getSession, listMembers } from '@/lib/data';
import { listRolePerms } from '@/lib/data-ext';
import { MATRIX_COLUMNS, PERMISSIONS } from '@/lib/perm';
import { ORG_ROLES } from '@/lib/types';

export const metadata = { title: 'Roles & permissions' };
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PermissionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, rows, members] = await Promise.all([getSession(), listRolePerms(), listMembers()]);
  const admin = session?.user.role === 'admin';
  const get = (role: string, p: string) => rows.find(r => r.org_role === role && r.permission === p);
  const areas = [...new Set(PERMISSIONS.map(p => p.area))];
  const open = rows.filter(r => r.status === 'Open question');
  const editing = typeof sp.edit === 'string' ? sp.edit : '';

  return (
    <>
      <PageHead eyebrow="Settings" title="Roles & permissions" crumbs={[{ href: '/settings', label: 'Settings' }]}>
        What each organisation role may read, create, edit, assign, approve, export and administer. The database enforces this matrix on every read and write — hiding a button is not the protection. System admins (a separate flag) can change everything here.
      </PageHead>
      <Notes sp={sp} />
      {open.length ? (
        <section className="verdict uncertain" aria-labelledby="oq-h">
          <h2 id="oq-h">{open.length} open policy question{open.length > 1 ? 's' : ''}</h2>
          <p style={{ margin: 0, fontSize: 13.5 }}>These defaults were chosen cautiously and still need a decision from leadership. Until then the CRM applies the value shown in the matrix.</p>
          <ul className="openlist">{[...new Set(open.map(r => r.note || r.permission))].map(n => <li key={n}>{n} <span className="muted">({open.filter(r => (r.note || r.permission) === n).map(r => `${r.org_role}: ${r.allowed ? 'allowed' : 'not allowed'}`).join('; ')})</span></li>)}</ul>
        </section>
      ) : null}

      <section className="tbl-card" aria-label="Permission matrix">
        <div className="tbl-wrap">
          <table className="tbl matrix">
            <thead><tr><th>Permission</th><th>Kind</th>{ORG_ROLES.map(r => <th key={r}>{r}</th>)}</tr></thead>
            <tbody>
              {areas.map(area => (
                <Fragment key={area}>
                  <tr><td colSpan={2 + ORG_ROLES.length} style={{ background: 'var(--surface-2)', fontWeight: 800, fontSize: 12.5, letterSpacing: '.03em' }}>{area}</td></tr>
                  {PERMISSIONS.filter(p => p.area === area).map(p => (
                    <tr key={p.key} id={p.key}>
                      <td style={{ minWidth: 260 }}>{p.label}{p.sensitive ? <> <Badge tone="neu">sensitive</Badge></> : null}<div className="sub mono-sm">{p.key}</div></td>
                      <td><Badge tone="out">{p.column}</Badge></td>
                      {ORG_ROLES.map(role => {
                        const r = get(role, p.key);
                        const cls = r?.status === 'Open question' ? 'oq' : '';
                        const isEdit = editing === `${role}:${p.key}`;
                        return (
                          <td key={role} className={cls} title={r?.note || r?.status || ''}>
                            {isEdit && admin ? (
                              <form action={permAction} style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                                <input type="hidden" name="org_role" value={role} /><input type="hidden" name="permission" value={p.key} />
                                <label className="chk"><input type="checkbox" name="allowed" defaultChecked={!!r?.allowed} /> Allowed</label>
                                <select name="status" defaultValue={r?.status || 'Proposed'} aria-label="Policy status"><option>Confirmed</option><option>Proposed</option><option>Open question</option></select>
                                <input type="text" name="note" defaultValue={r?.note || ''} placeholder="Note" aria-label="Note" style={{ width: 140 }} />
                                <span className="inline"><button className="btn btn-sm btn-primary" type="submit">Save</button><Link className="btn btn-sm" href={`/settings/permissions#${p.key}`}>Cancel</Link></span>
                              </form>
                            ) : (
                              <span style={{ display: 'inline-grid', gap: 2, justifyItems: 'center' }}>
                                {r?.allowed ? <span className="yes" aria-label="Allowed">✓</span> : <span className="no" aria-label="Not allowed">—</span>}
                                {r?.status === 'Open question' ? <span className="badge b-q" style={{ fontSize: 10.5, padding: '1px 6px' }}>open</span> : r?.status === 'Confirmed' ? <span className="sub">confirmed</span> : null}
                                {admin ? <Link href={`/settings/permissions?edit=${encodeURIComponent(`${role}:${p.key}`)}#${p.key}`} className="sub">edit</Link> : null}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tbl-foot"><span>✓ allowed · — not allowed · <span className="badge b-q" style={{ fontSize: 10.5 }}>open</span> policy not decided · “Proposed” defaults are cautious starting points nobody has signed off.</span><span>Columns map to: {MATRIX_COLUMNS.join(', ')}.</span></div>
      </section>

      <section className="card" aria-labelledby="people-h">
        <header><div><h2 id="people-h">People and their organisation role</h2><p>People without a role are treated as BD Executive (least privilege).</p></div><Link href="/team">Users &amp; access</Link></header>
        <div className="tbl-wrap"><table className="tbl plain">
          <thead><tr><th>Person</th><th>Organisation role</th><th>System admin</th></tr></thead>
          <tbody>{members.map(m => (
            <tr key={m.id}>
              <td><Who name={m.full_name || m.email} /> <span className="muted mono-sm">{m.email}</span></td>
              <td>{admin ? (
                <form action={orgRoleAction} className="inline"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="return" value="/settings/permissions" />
                  <select name="org_role" defaultValue={m.org_role || ''} aria-label={`Role for ${m.email}`}><option value="">Not set (BD Executive)</option>{ORG_ROLES.map(r => <option key={r}>{r}</option>)}</select><button className="btn btn-sm" type="submit">Save</button></form>
              ) : (m.org_role || 'Not set')}</td>
              <td>{m.role === 'admin' ? <Badge tone="info">Admin</Badge> : <span className="muted">—</span>}</td>
            </tr>))}</tbody>
        </table></div>
      </section>
    </>
  );
}
