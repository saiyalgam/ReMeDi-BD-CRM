import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of "Authorization: Bearer <secret>". */
export function bearerOk(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7).trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
