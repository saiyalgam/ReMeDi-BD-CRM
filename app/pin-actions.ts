'use server';
// TPIN: unlock the CRM with a 6-digit PIN instead of a new email sign-in link each time.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/data';
import { checkPin, getPin, pinProblem, setPin, MAX_ATTEMPTS } from '@/lib/pin';
import { FRESH_COOKIE, UNLOCK_COOKIE, UNLOCK_HOURS, cookieOptions, signToken, verifyToken } from '@/lib/pin-cookie';

export interface PinState { ok?: boolean; message?: string }

const safeNext = (v: FormDataEntryValue | null) => { const s = String(v || '/'); return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/unlock') && !s.startsWith('/set-pin') ? s : '/'; };

async function markUnlocked(userId: string) {
  const token = await signToken('unlock', userId, UNLOCK_HOURS * 3600e3);
  if (token) (await cookies()).set(UNLOCK_COOKIE, token, cookieOptions); // no maxAge: gone when the browser closes
}

export async function unlockAction(_prev: PinState, fd: FormData): Promise<PinState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const pin = String(fd.get('pin') || '').trim();
  if (!/^\d+$/.test(pin)) return { ok: false, message: 'Enter your PIN using digits only.' };
  let res;
  try { res = await checkPin(session.user.id, pin); } catch (e) { return { ok: false, message: (e as Error).message }; }
  if (res.missing) redirect('/set-pin');
  if (res.locked) return { ok: false, message: `Too many wrong attempts (${MAX_ATTEMPTS}). The PIN is locked: sign in with your email link, then set a new PIN.` };
  if (!res.ok) return { ok: false, message: `Wrong PIN. ${res.left} attempt${res.left === 1 ? '' : 's'} left before it locks.` };
  await markUnlocked(session.user.id);
  redirect(safeNext(fd.get('next')));
}

/**
 * Create, change or reset the PIN.
 * - First PIN: allowed for any signed-in user who has none yet.
 * - Change: needs the current PIN.
 * - Reset (forgotten or locked): needs an email sign-in within the last 15 minutes.
 */
export async function setPinAction(_prev: PinState, fd: FormData): Promise<PinState> {
  const session = await getSession();
  if (!session) redirect('/login');
  const uid = session.user.id;
  const jar = await cookies();
  const pin = String(fd.get('pin') || '').trim();
  const confirm = String(fd.get('confirm') || '').trim();
  const problem = pinProblem(pin);
  if (problem) return { ok: false, message: problem };
  if (pin !== confirm) return { ok: false, message: 'The two PINs do not match.' };
  let existing;
  try { existing = await getPin(uid); } catch (e) { return { ok: false, message: (e as Error).message }; }
  if (existing) {
    const fresh = await verifyToken('fresh', jar.get(FRESH_COOKIE)?.value, uid);
    if (!fresh) {
      if (existing.locked) return { ok: false, message: 'Your PIN is locked. Sign out, sign in with your email link, then set a new PIN within 15 minutes.' };
      const current = String(fd.get('current') || '').trim();
      const res = await checkPin(uid, current);
      if (!res.ok) return { ok: false, message: res.locked ? 'Too many wrong attempts: the PIN is now locked. Sign in with your email link to reset it.' : `Current PIN is wrong. ${res.left} attempt${res.left === 1 ? '' : 's'} left.` };
    }
  }
  await setPin(uid, pin);
  jar.delete(FRESH_COOKIE);
  await markUnlocked(uid);
  redirect(safeNext(fd.get('next')));
}

/** Lock this browser now; the email session stays, so the PIN unlocks it again. */
export async function lockAction() {
  (await cookies()).delete(UNLOCK_COOKIE);
  redirect('/unlock');
}
