import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { SetPinForm } from '@/components/PinForm';
import { getSession } from '@/lib/data';
import { getPin } from '@/lib/pin';
import { FRESH_COOKIE, pinSecret, verifyToken } from '@/lib/pin-cookie';

export const metadata = { title: 'Set your PIN' };

export default async function SetPinPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await connection();
  const session = await getSession();
  if (!session) redirect('/login');
  const next = (await searchParams).next || '/';
  if (!pinSecret()) redirect('/');
  let row, problem: string | null = null;
  try { row = await getPin(session.user.id); } catch (e) { problem = (e as Error).message; }
  const fresh = await verifyToken('fresh', (await cookies()).get(FRESH_COOKIE)?.value, session.user.id);
  const mode = !row ? 'create' : fresh ? 'reset' : row.locked ? 'locked' : 'change';
  return (
    <div className="login">
      <div className="box">
        <div className="eyebrow">ReMeDi Lead Tracker</div>
        <h1>{mode === 'create' ? 'Create your PIN' : mode === 'change' ? 'Change your PIN' : 'Set a new PIN'}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {mode === 'create' ? 'You only need your email link once on this browser. After that, open the CRM with this 6-digit PIN.' : 'Use 6 digits that are not repeated or in sequence. Do not reuse your bank or phone PIN.'}
        </p>
        {problem ? <div className="note err">{problem}</div>
          : mode === 'locked' ? <div className="note err">Your PIN is locked. Sign out, sign in with your email link, and come back here within 15 minutes.</div>
          : <SetPinForm next={next} needCurrent={mode === 'change'} />}
        <div className="pin-alt">
          {mode === 'change' ? <Link href="/">Cancel</Link> : null}
          <form action="/auth/signout" method="post"><button className="linkbtn" type="submit">Sign out</button></form>
        </div>
      </div>
    </div>
  );
}
