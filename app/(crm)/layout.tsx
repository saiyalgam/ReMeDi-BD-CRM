import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { NavLinks } from '@/components/NavLinks';
import { Avatar } from '@/components/ui';
import { TYPE_COLOR } from '@/components/ui';
import { getSession, listLeads, listNews } from '@/lib/data';
import { isDemo, supabaseConfig } from '@/lib/env';
import { isOpen } from '@/lib/views';
import { LEAD_TYPES, SLUG_OF, TYPE_LABEL } from '@/lib/types';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isDemo() && !supabaseConfig()) return <SetupNeeded />;
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.isMember) return <NotApproved email={session.user.email} />;

  const [leads, news] = await Promise.all([listLeads(), listNews()]);
  const open = leads.filter(l => isOpen(l));
  const name = session.user.full_name || session.user.email;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><small>Neurosynaptic · ReMeDi</small><b>Opportunity <span>CRM</span></b></div>
        <Suspense>
          <NavLinks title="Desk" items={[
            { href: '/', label: 'Overview' },
            { href: '/leads?assignee=me', label: 'My leads', count: open.filter(l => l.assigned_to === session.user.id).length },
            { href: '/leads?verification=Unverified', label: 'Needs checking', count: open.filter(l => l.verification === 'Unverified').length }
          ]} />
          <NavLinks title="Leads" items={[
            ...LEAD_TYPES.map(t => ({ href: `/leads?type=${SLUG_OF[t]}`, label: TYPE_LABEL[t], color: TYPE_COLOR[t], count: open.filter(l => l.lead_type === t).length })),
            { href: '/leads', label: 'All leads', count: open.length }
          ]} />
          <NavLinks title="Market" items={[
            { href: '/news', label: 'News', count: news.filter(n => n.relevance === 'Unreviewed').length },
            { href: '/team', label: 'Team & settings' }
          ]} />
        </Suspense>
        <div className="me">
          <div className="who"><Avatar name={name} /><div><b>{name}</b><span>{session.demo ? 'Demo mode' : session.user.email}</span></div></div>
          {session.demo ? null : <form action="/auth/signout" method="post"><button className="btn btn-sm" type="submit">Sign out</button></form>}
        </div>
      </aside>
      <main className="main">
        {session.demo ? <div className="demo-banner">Demo mode: sample data stored on this computer only. Nothing here is shared with your team.</div> : null}
        {children}
      </main>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="login"><div className="box">
      <div className="eyebrow">Setup needed</div>
      <h1>Connect the database</h1>
      <p>Add these environment variables in Vercel (Project → Settings → Environment Variables), then redeploy:</p>
      <ul className="mono">
        <li>NEXT_PUBLIC_SUPABASE_URL</li><li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li><li>SUPABASE_SECRET_KEY</li><li>INGEST_TOKEN</li><li>CRON_SECRET</li>
      </ul>
      <p className="muted">The README in the project lists where to find each value.</p>
    </div></div>
  );
}

function NotApproved({ email }: { email: string }) {
  return (
    <div className="login"><div className="box">
      <div className="eyebrow">Access pending</div>
      <h1>{email} isn&apos;t on the team list yet</h1>
      <p>Ask an admin to add your email (or your company domain) on the Team &amp; settings page, then sign in again.</p>
      <form action="/auth/signout" method="post"><button className="btn" type="submit">Sign out</button></form>
    </div></div>
  );
}
