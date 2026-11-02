// Signed "unlocked" cookie for the TPIN screen. Uses Web Crypto only, so proxy.ts and server code can both use it.
// The cookie says: this browser's signed-in user entered their PIN (or signed in by email) until <expiry>.
// It is httpOnly, has no Max-Age (cleared when the browser closes) and also carries its own expiry.

export const UNLOCK_COOKIE = 'crm_unlock';
export const FRESH_COOKIE = 'crm_fresh'; // set for 15 minutes after an email sign-in: allows setting or resetting the PIN
export const UNLOCK_HOURS = 12;
export const FRESH_MINUTES = 15;

/** The HMAC secret. Demo mode uses a fixed local value; production needs PIN_COOKIE_SECRET (otherwise the PIN gate is off). */
export function pinSecret(): string | null {
  const s = process.env.PIN_COOKIE_SECRET;
  if (s && s.length >= 32) return s;
  return process.env.DEMO_MODE === '1' ? 'demo-mode-only-pin-cookie-secret-not-for-production' : null;
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** `<kind>.<userId>.<expiresMs>.<signature>` */
export async function signToken(kind: 'unlock' | 'fresh', userId: string, ttlMs: number): Promise<string | null> {
  const secret = pinSecret();
  if (!secret) return null;
  const body = `${kind}.${userId}.${Date.now() + ttlMs}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(kind: 'unlock' | 'fresh', token: string | undefined, userId: string): Promise<boolean> {
  const secret = pinSecret();
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [k, uid, exp, sig] = parts as [string, string, string, string];
  if (k !== kind || uid !== userId || !(Number(exp) > Date.now())) return false;
  return sameString(sig, await hmac(secret, `${k}.${uid}.${exp}`));
}

export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
