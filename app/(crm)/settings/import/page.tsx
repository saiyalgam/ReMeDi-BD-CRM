import Link from 'next/link';
import { Denied, PageHead } from '@/components/ui';
import { getSession } from '@/lib/data';
import { can } from '@/lib/perm';
import { ImportClient } from './ImportClient';

export const metadata = { title: 'Spreadsheet import' };

export default async function ImportPage() {
  const session = await getSession();
  return (
    <>
      <PageHead eyebrow="Settings" title="Spreadsheet import" crumbs={[{ href: '/settings', label: 'Settings' }, { href: '/leads', label: 'Pipeline' }]}>
        Move opportunities from the Excel pipeline into the CRM: map the columns, check for problems and duplicates, then import. Each imported row gets its own permanent reference number.
      </PageHead>
      {can(session, 'opp.create') ? <ImportClient canVerify={can(session, 'opp.verify')} /> : <Denied>Your role cannot add opportunities. <Link href="/leads">Back to the pipeline</Link></Denied>}
    </>
  );
}
