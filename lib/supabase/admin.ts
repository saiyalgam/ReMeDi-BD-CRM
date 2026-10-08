import { createClient } from '@supabase/supabase-js';
import { supabaseConfig, supabaseSecretKey } from '../env';

/** Server-only client with the secret key. Used by the crawler ingest API and the news job; bypasses row-level security. */
export function supabaseAdmin() {
  const cfg = supabaseConfig();
  const secret = supabaseSecretKey();
  if (!cfg || !secret) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createClient(cfg.url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
