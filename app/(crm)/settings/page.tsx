import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { getSession } from '@/lib/data';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const s = await getSession();
  const admin = s?.user.role === 'admin';
  const items: [string, string, string, boolean][] = [
    ['/team', 'Users & access', 'Who can sign in, organisation roles and admin access, news feeds.', true],
    ['/settings/permissions', 'Roles & permissions', 'The permission matrix by role, with open policy questions marked.', true],
    ['/settings/scoring', 'Scoring rules', 'Scorecard criteria and weights per opportunity type.', true],
    ['/settings/integrations', 'Integrations & notifications', 'Google Drive opportunity folders, Calendar hand-off, Meet and Chat (planned), crawler connection.', true],
    ['/settings/import', 'Spreadsheet import', 'Bring the Excel pipeline into the CRM with column mapping and duplicate checks.', true]
  ];
  return (
    <>
      <PageHead eyebrow="Settings" title="Settings" crumbs={[{ href: '/', label: 'Dashboard' }]}>
        {admin ? 'You are an administrator: you can change these settings.' : 'Most settings can be changed by administrators only; you can view them.'}
      </PageHead>
      <div className="pcards">
        {items.map(([href, title, desc]) => <Link key={href} href={href} className="pcard"><h3>{title}</h3><span className="muted" style={{ fontSize: 13.5 }}>{desc}</span></Link>)}
      </div>
    </>
  );
}
