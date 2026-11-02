import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { UnlockForm } from '@/components/PinForm';
import { getSession } from '@/lib/data';
import { getPin, MAX_ATTEMPTS } from '@/lib/pin';
import { pinSecret, UNLOCK_COOKIE, verifyToken } from '@/lib/pin-cookie';

export const metadata = { title: 'Unlock' };

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const session = await getSession();
  if (!session) redirect('/login');
  const next = (await searchParams).next || '/';
  if (!pinSecret()) redirect(next);
  if (await verifyToken('unlock', (await cookies()).get(UNLOCK_COOKIE)?.value, session.user.id)) redirect(next);
  let row, problem: string | null = null;
  try { row = await getPin(session.user.id); } catch (e) { problem = (e as Error).message; }
  if (!problem && !row) redirect(`/set-pin?next=${encodeURIComponent(next)}`);
  return (
    <div className="login">
      <div className="box">
        <div className="eyebrow">ReMeDi Lead Tracker</div>
        <h1>Welcome back</h1>
        <p className="muted" style={{ margin: 0 }}>Signed in as <b>{session.user.email}</b>. Enter your PIN to open the CRM on this browser.</p>
        {problem ? <div className="note err">{problem}</div>
          : row?.locked ? <div className="note err">Your PIN is locked after {MAX_ATTEMPTS} wrong attempts. Sign in with your email link, then set a new PIN.</div>
          : <UnlockForm next={next} />}
        <form action="/auth/signout" method="post" className="pin-alt">
          <button className="linkbtn" type="submit">{row?.locked ? 'Sign in with email' : 'Forgot PIN or not you? Sign in with email'}</button>
        </form>
      </div>
    </div>
  );
}
