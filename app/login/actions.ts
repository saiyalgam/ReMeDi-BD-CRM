'use server';
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

export interface LoginState { ok?: boolean; message?: string }

export async function sendMagicLink(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get('email') || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { ok: false, message: 'Enter a valid email address.' };
  const sb = await supabaseServer();
  const { data: allowed, error: rpcError } = await sb.rpc('is_email_allowed', { p_email: email });
  if (rpcError) return { ok: false, message: 'Could not reach the database. Check the Supabase settings and that schema.sql has been run.' };
  if (!allowed) return { ok: false, message: 'This email is not on the team list. Ask an admin to add it on the Team page.' };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || `${h.get('x-forwarded-proto') || 'https'}://${h.get('x-forwarded-host') || h.get('host')}`;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/confirm?next=/`, shouldCreateUser: true } });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `Check ${email} for a sign-in link. It works once and expires in an hour.` };
}
