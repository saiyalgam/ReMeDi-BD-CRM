import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { NavLinks } from '@/components/NavLinks';
import { AutoSubmitSelect } from '@/components/AutoSubmit';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, Icon } from '@/components/ui';
import { demoActAsAction } from '@/app/actions';
import { getSession, listLeads, listMembers } from '@/lib/data';
import { listDeadlines, listTasks } from '@/lib/data-ext';
import { listBdEvents, myFollowups } from '@/lib/outreach';
import { isDemo, supabaseConfig } from '@/lib/env';
import { todayIST } from '@/lib/format';
import { can } from '@/lib/perm';
import { isOpen } from '@/lib/views';
import { lockAction } from '@/app/pin-actions';
import { getPin } from '@/lib/pin';
import { pinSecret } from '@/lib/pin-cookie';
import { ProductTour, ReplayTourButton, type TourStep } from '@/components/ProductTour';
import { getOnboarding, TOUR_VERSION } from '@/lib/onboarding';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await connection();
  if (!isDemo() && !supabaseConfig()) return <SetupNeeded />;
  const session = await getSession();
  if (!session) redirect('/login');
  // TPIN: everyone sets a PIN once after their first email sign-in (skipped if update-6.sql is not installed yet).
  if (pinSecret() && !(await getPin(session.user.id).catch(() => true))) redirect('/set-pin');
  if (!session.isMember) return <NotApproved email={session.user.email} />;

  const me = session.user.id;
  const today = todayIST();
  const [leads, tasks, deadlines, members, events, fu, ob] = await Promise.all([
    listLeads(), listTasks(), listDeadlines(), session.demo ? listMembers() : Promise.resolve([]), listBdEvents(), myFollowups(me), getOnboarding(me)
  ]);
  // First login after this release: product tour once; "New" badges until each new page is opened.
  const showTour = !!ob && ob.tour_version !== TOUR_VERSION;
  const isNew = (k: string) => !!ob && !ob.seen_features.includes(k);
  const open = leads.filter(l => isOpen(l));
  const name = session.user.full_name || session.user.email;
  const reviewCount = open.filter(l => l.verification === 'Unverified').length
    + leads.filter(l => l.approval_status === 'Pending').length
    + deadlines.filter(d => d.kind === 'Amendment' && !d.verified && !d.rejected).length;
  const myTasks = tasks.filter(t => t.assignee === me && (t.status === 'Open' || t.status === 'In progress')).length;
  const due = fu.contacts.filter(c => c.followup_on! <= today).length + fu.preLeads.filter(p => p.due_on && p.due_on <= today).length
    + tasks.filter(t => t.assignee === me && (t.status === 'Open' || t.status === 'In progress') && t.due_on && t.due_on <= today).length;
  const upcoming = events.filter(e => !['Closed', 'Skipped'].includes(e.status) && (!e.ends_on || e.ends_on >= today)).length;
  const openTaskLeads = new Set(tasks.filter(t => t.lead_id && (t.status === 'Open' || t.status === 'In progress')).map(t => t.lead_id));
  const health = open.length ? Math.round(100 * open.filter(l => l.next_followup || l.next_step || openTaskLeads.has(l.id)).length / open.length) : 0;
  const outreach = can(session, 'outreach.read');

  return (
    <div className="shell v5">
      <aside className="rail" aria-label="Main navigation">
        <Link href="/" className="brandmark" aria-label="ReMeDi Lead Tracker — dashboard">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/remedi-wordmark.png" alt="ReMeDi" width={876} height={380} />
          <span>Lead Tracker</span>
        </Link>
        <Suspense>
          <NavLinks title="Main menu" items={[
            { href: '/', label: 'Dashboard', icon: <Icon name="home" /> },
            { href: '/tracker', label: 'Lead Tracker', count: open.length, icon: <Icon name="board" />, match: '/tracker', tour: 'nav-tracker', feature: 'tracker', isNew: isNew('tracker') },
            { href: '/followups', label: 'My follow-ups', count: due || undefined, alert: due > 0, icon: <Icon name="bell" />, match: '/followups', feature: 'followups', isNew: isNew('followups') },
            ...(outreach ? [
              { href: '/pre-leads', label: 'Pre-Leads', icon: <Icon name="flag" />, match: '/pre-leads', tour: 'nav-preleads', feature: 'preleads', isNew: isNew('preleads') },
              { href: '/events', label: 'Events', count: upcoming || undefined, icon: <Icon name="calendar" />, match: '/events', tour: 'nav-events', feature: 'events', isNew: isNew('events') },
              { href: '/people', label: 'People & PoCs', icon: <Icon name="users" />, match: '/people', tour: 'nav-people', feature: 'people', isNew: isNew('people') }
            ] : []),
            { href: '/review', label: 'Review queue', count: reviewCount, icon: <Icon name="inbox" />, match: '/review' },
            { href: '/leads?type=tender', label: 'Tenders', icon: <Icon name="list" /> },
            { href: '/leads?type=grant,csr', label: 'Grants & CSR', icon: <Icon name="award" /> },
            ...(outreach ? [{ href: '/cohorts', label: 'Cohorts', icon: <Icon name="target" />, match: '/cohorts', feature: 'cohorts', isNew: isNew('cohorts') }] : []),
            { href: '/partners', label: 'Partners', icon: <Icon name="users" />, match: '/partners' },
            ...(can(session, 'reports.read') ? [{ href: '/reports', label: 'Reports', icon: <Icon name="chart" />, match: '/reports' }] : [])
          ]} />
          <NavLinks title="Pipeline detail" items={[
            { href: '/leads', label: 'All opportunities', count: open.length, icon: <Icon name="list" /> },
            { href: '/intake', label: 'Crawler intake', count: open.filter(l => l.verification === 'Unverified').length, icon: <Icon name="upload" />, match: '/intake' },
            { href: '/tasks', label: 'Tasks', count: myTasks, icon: <Icon name="check" />, match: '/tasks' },
            { href: '/my', label: 'My relationships', icon: <Icon name="user" />, match: '/my' },
            { href: '/knowledge', label: 'Knowledge base', icon: <Icon name="book" />, match: '/knowledge' }
          ]} />
          <NavLinks title="Others" items={[
            { href: '/activity', label: 'Team activity', icon: <Icon name="pulse" />, match: '/activity' },
            { href: '/news', label: 'News', icon: <Icon name="news" />, match: '/news' },
            { href: '/strategy', label: 'Strategy', icon: <Icon name="target" />, match: '/strategy' },
            { href: '/settings', label: 'Settings', icon: <Icon name="gear" />, match: '/settings' },
            { href: '/team', label: 'Users & access', icon: <Icon name="users" />, match: '/team' }
          ]} />
        </Suspense>
        <div className="healthcard">
          <div><small>Pipeline health</small><b>{health}%</b></div>
          <span className="bar"><i style={{ width: `${health}%` }} /></span>
          <p>{health}% of open leads have a next step scheduled.</p>
          <p className="tag-line">ReMeDi · Enabling Healthcare. Anytime. Anywhere.</p>
        </div>
        {session.demo ? (
          <form action={demoActAsAction} className="demo-as">
            <span>Demo: view as</span>
            <AutoSubmitSelect name="as" defaultValue={me} label="View the demo as another sample user">
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name} — {m.org_role}{m.role === 'admin' ? ' (admin)' : ''}</option>)}
            </AutoSubmitSelect>
          </form>
        ) : null}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <form action="/leads" className="topsearch" role="search" data-tour="search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="q">Search leads, organisations, people</label>
            <input id="q" name="q" type="search" placeholder="Search leads, organisations, people…" autoComplete="off" />
            <input type="hidden" name="show" value="all" />
          </form>
          <details className="quickadd" data-tour="quickadd">
            <summary className="btn btn-primary"><Icon name="plus" />Quick Add</summary>
            <div className="qa-menu" role="menu">
              {can(session, 'opp.create') ? <Link role="menuitem" href="/leads/new">New lead</Link> : null}
              {can(session, 'outreach.edit') ? <Link role="menuitem" href="/people?add=1">New contact</Link> : null}
              {can(session, 'outreach.edit') ? <Link role="menuitem" href="/events?add=1">New event</Link> : null}
              {can(session, 'outreach.edit') ? <Link role="menuitem" href="/pre-leads?add=1">New pre-lead</Link> : null}
              {can(session, 'tasks.create') ? <Link role="menuitem" href="/tasks">New task</Link> : null}
              {can(session, 'opp.create') ? <Link role="menuitem" href="/settings/import">Import leads (Excel)</Link> : null}
              {can(session, 'opp.create') ? <Link role="menuitem" href="/settings/import#json">Upload lead file (JSON)</Link> : null}
            </div>
          </details>
          <div className="topright">
            <Link href="/followups" className="iconbtn" aria-label={`My follow-ups: ${due} due`} title="My follow-ups" data-tour="bell">
              <Icon name="bell" />{due ? <span className="dotcount">{due > 99 ? '99+' : due}</span> : null}
            </Link>
            <ThemeToggle />
            <div className="userchip">
              <Avatar name={name} />
              <div><b>{name}</b><span>{session.orgRole}{session.user.role === 'admin' ? ' · admin' : ''}</span></div>
              <details className="usermenu" data-tour="account">
                <summary className="iconbtn" aria-label="Account menu" title="Account"><Icon name="lock" /></summary>
                <div className="usermenu-pop">
                  <ReplayTourButton />
                  {pinSecret() ? <form action={lockAction}><button type="submit">Lock now (PIN to reopen)</button></form> : null}
                  {pinSecret() ? <Link href="/set-pin">Change PIN</Link> : null}
                  {!session.demo ? <form action="/auth/signout" method="post"><button type="submit">Sign out (email link next time)</button></form> : null}
                </div>
              </details>
            </div>
          </div>
        </header>
        <main className="main" id="main">
          <div className="print-head" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/remedi-wordmark.png" alt="" />
            <div className="ph-meta"><b>ReMeDi Lead Tracker</b> · Internal — Neurosynaptic Communications<br />Printed by {name} ({session.orgRole}) · {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
          </div>
          {session.demo ? <div className="demo-banner">Demo mode: crawler leads from the supplied rounds plus entries marked [Sample]. Stored on this computer only.</div> : null}
          {children}
        </main>
        <ProductTour open={showTour} name={name} steps={tourSteps(outreach, !!pinSecret())} />
      </div>
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

/** The tour for this release. Steps whose element is missing for a role (or on a phone) show as a centred card. */
function tourSteps(outreach: boolean, pin: boolean): TourStep[] {
  return [
    { title: 'Welcome, {name}. Here is what is new', body: 'The CRM has a new look and new tools for the whole pipeline: a Lead Tracker board, events and the people you meet, follow-ups, and PIN unlock. This takes about a minute and appears only once.' },
    { target: 'nav-tracker', title: 'Lead Tracker', body: 'Your Excel pipeline as a board. Drag a card to move it from Lead Identified to Won, filter by category, owner, size or geography, and see counts and ₹ value by status. Switch to Table view for the spreadsheet layout.' },
    { target: 'search', title: 'Search everything', body: 'Find any lead, buyer, organisation or person from here.' },
    { target: 'quickadd', title: 'Quick Add', body: 'Add a lead, contact, event, pre-lead or task in two clicks, or import an Excel sheet or a JSON lead file.' },
    { target: 'bell', title: 'Your follow-ups', body: 'The red count is what is due today or overdue across your contacts, pre-leads, tasks and leads. Click it for the full list.' },
    ...(outreach ? [
      { target: 'nav-events', title: 'Events', body: 'Plan conferences, track deadlines and checklists, and upload the sheet of people you met. The CRM recognises the columns, creates the event and lets you assign everyone, even round-robin.' },
      { target: 'nav-people', title: 'People & PoCs', body: 'Everyone you have met. Select rows to take them, assign them or set follow-ups, and convert a promising contact into a lead.' },
      { target: 'nav-preleads', title: 'Pre-Leads and Cohorts', body: 'Early ideas that are not yet opportunities, and the accelerator or cohort programmes you have applied to. Convert a pre-lead to a lead when it firms up.' }
    ] : []),
    { target: 'account', title: pin ? 'PIN, lock and this tour' : 'Your account', body: pin ? 'Lock the CRM when you step away, change your PIN, or take this tour again from here. Pages marked “New” in the menu lose the badge once you open them.' : 'Take this tour again from here. Pages marked “New” in the menu lose the badge once you open them.' },
    { title: 'You are all set', body: 'Start with the Lead Tracker, or upload the contacts from your last event under Events.' }
  ];
}

