// TPIN storage and checks (server only). The PIN is never stored: only a scrypt hash with a per-user salt.
// Table user_pins (update-6.sql) has RLS on and no policies, so only the service-role client can read or write it.
import crypto from 'node:crypto';
import { isDemo } from './env';
import { demo, saveDemo } from './demo';
import { supabaseAdmin } from './supabase/admin';

export const PIN_LENGTH = 6;
export const MAX_ATTEMPTS = 5;

export interface PinRow { user_id: string; pin_hash: string; failed_count: number; locked: boolean; updated_at: string }

const WEAK = new Set(['123456', '654321', '012345', '543210', '123123', '111222', '121212', '112233', '000000']);
/** Returns a message when the PIN is not acceptable, otherwise null. */
export function pinProblem(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return `The PIN must be exactly ${PIN_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(pin) || WEAK.has(pin)) return 'That PIN is too easy to guess. Avoid repeated or sequential digits.';
  return null;
}

function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function pinMatches(pin: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pin, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function getPin(userId: string): Promise<PinRow | null> {
  if (isDemo()) return (demo().pins || []).find(p => p.user_id === userId) || null;
  const { data, error } = await supabaseAdmin().from('user_pins').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(/relation .* does not exist/i.test(error.message) ? 'Run supabase/update-6.sql to enable PIN unlock.' : error.message);
  return (data as PinRow | null) || null;
}

async function writePin(row: PinRow): Promise<void> {
  if (isDemo()) {
    const st = demo();
    st.pins = [...(st.pins || []).filter(p => p.user_id !== row.user_id), row];
    saveDemo(st);
    return;
  }
  const { error } = await supabaseAdmin().from('user_pins').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function setPin(userId: string, pin: string): Promise<void> {
  await writePin({ user_id: userId, pin_hash: hashPin(pin), failed_count: 0, locked: false, updated_at: new Date().toISOString() });
}

/** Checks a PIN and counts failures. After MAX_ATTEMPTS wrong tries the PIN is locked until the person signs in by email again. */
export async function checkPin(userId: string, pin: string): Promise<{ ok: boolean; left: number; locked: boolean; missing?: boolean }> {
  const row = await getPin(userId);
  if (!row) return { ok: false, left: 0, locked: false, missing: true };
  if (row.locked) return { ok: false, left: 0, locked: true };
  if (pinMatches(pin, row.pin_hash)) {
    if (row.failed_count) await writePin({ ...row, failed_count: 0 });
    return { ok: true, left: MAX_ATTEMPTS, locked: false };
  }
  const failed = row.failed_count + 1;
  const locked = failed >= MAX_ATTEMPTS;
  await writePin({ ...row, failed_count: failed, locked, updated_at: new Date().toISOString() });
  return { ok: false, left: Math.max(0, MAX_ATTEMPTS - failed), locked };
}

/** An email sign-in proves identity again: clear a lock so the person can set a new PIN. */
export async function clearLock(userId: string): Promise<void> {
  const row = await getPin(userId).catch(() => null);
  if (row && (row.locked || row.failed_count)) await writePin({ ...row, failed_count: 0, locked: false });
}
