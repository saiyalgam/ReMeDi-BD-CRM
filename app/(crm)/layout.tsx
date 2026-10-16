import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { NavLinks } from '@/components/NavLinks';
import { AutoSubmitSelect } from '@/components/AutoSubmit';
import { Avatar, Icon, TYPE_COLOR } from '@/components/ui';
import { demoActAsAction } from '@/app/actions';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listDeadlines, listTasks } from '@/lib/data-ext';
import { isDemo, supabaseConfig } from '@/lib/env';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import { LEAD_TYPES, SLUG_OF, TYPE_LABEL } from '@/lib/types';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isDemo() && !supabaseConfig()) return <SetupNeeded />;
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.isMember) return <NotApproved email={session.user.email} />;

  const [leads, tasks, deadlines, members] = await Promise.all([listLeads(), listTasks(), listDeadlines(), session.demo ? listMembers() : Promise.resolve([])]);
  const open = leads.filter(l => isOpen(l));
  const name = session.user.full_name || session.user.email;
  const me = session.user.id;
  const reviewCount = open.filter(l => l.verification === 'Unverified').length
    + leads.filter(l => l.approval_status === 'Pending').length
    + deadlines.filter(d => d.kind === 'Amendment' && !d.verified && !d.rejected).length;
  const myTasks = tasks.filter(t => t.assignee === me && (t.status === 'Open' || t.status === 'In progress')).length;

  return (
    <div className="shell">
      <aside className="rail">
        <Link href="/" className="brandtile" aria-label="ReMeDi Opportunity CRM — dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ncpl" src="/brand/neurosynaptic-logo.png" alt="Neurosynaptic Communications" width={94} height={149} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="remedi" src="/brand/remedi-wordmark.png" alt="ReMeDi" width={876} height={380} />
          <span>Opportunity CRM · NCPL</span>
        </Link>
        <Suspense>
          <NavLinks title="Desk" items={[
            { href: '/', label: 'Dashboard', icon: <Icon name="home" /> },
            { href: '/review', label: 'Review queue', count: reviewCount, icon: <Icon name="inbox" />, match: '/review' },
            { href: '/my', label: 'My leads', icon: <Icon name="user" />, match: '/my' },
            { href: '/tasks', label: 'Tasks', count: myTasks, icon: <Icon name="check" />, match: '/tasks' }
          ]} />
          <NavLinks title="Pipeline" items={[
            { href: '/leads', label: 'All opportunities', count: open.length, icon: <Icon name="list" /> },
            { href: '/intake', label: 'Crawler intake', count: open.filter(l => l.verification === 'Unverified').length, icon: <Icon name="upload" />, match: '/intake' },
            ...LEAD_TYPES.map(t => ({ href: `/leads?type=${SLUG_OF[t]}`, label: TYPE_LABEL[t], color: TYPE_COLOR[t], count: open.filter(l => l.lead_type === t).length }))
          ]} />
          <NavLinks title="Network & evidence" items={[
            { href: '/partners', label: 'Partners', icon: <Icon name="users" />, match: '/partners' },
            { href: '/knowledge', label: 'Knowledge base', icon: <Icon name="book" />, match: '/knowledge' }
          ]} />
          <NavLinks title="Insight" items={[
            { href: '/activity', label: 'Team activity', icon: <Icon name="pulse" />, match: '/activity' },
            ...(can(session, 'reports.read') ? [{ href: '/reports', label: 'Reports', icon: <Icon name="chart" />, match: '/reports' }] : []),
            { href: '/news', label: 'News', icon: <Icon name="news" />, match: '/news' },
            { href: '/strategy', label: 'Strategy', icon: <Icon name="target" />, match: '/strategy' }
          ]} />
          <NavLinks title="Settings" items={[
            { href: '/settings', label: 'Settings', icon: <Icon name="gear" />, match: '/settings' },
            { href: '/team', label: 'Users & access', icon: <Icon name="users" />, match: '/team' }
          ]} />
        </Suspense>
        <div className="me">
          <div className="who"><Avatar name={name} /><div><b>{name}</b><span>{session.orgRole}{session.user.role === 'admin' ? ' · admin' : ''}</span></div></div>
          {session.demo ? (
            <form action={demoActAsAction} className="demo-as">
              <span>Demo: view as</span>
              <AutoSubmitSelect name="as" defaultValue={me} label="View the demo as another sample user">
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name} — {m.org_role}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
              </AutoSubmitSelect>
            </form>
          ) : <form action="/auth/signout" method="post"><button className="btn btn-sm" type="submit">Sign out</button></form>}
        </div>
      </aside>
      <main className="main" id="main">
        <div className="print-head" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/remedi-wordmark.png" alt="" />
          <div className="ph-meta"><b>ReMeDi Opportunity CRM</b> · Internal — Neurosynaptic Communications<br />Printed by {name} ({session.orgRole}) · {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
        </div>
        {session.demo ? <div className="demo-banner">Demo mode: crawler leads from the supplied rounds plus entries marked [Sample]. Stored on this computer only.</div> : null}
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
      <p>Ask an admin to add your email (or your company domain) on the Users &amp; access page, then sign in again.</p>
      <form action="/auth/signout" method="post"><button className="btn" type="submit">Sign out</button></form>
    </div></div>
  );
}
