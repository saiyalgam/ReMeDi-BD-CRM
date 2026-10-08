import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from '../env';

/** Supabase client acting as the signed-in person (row-level security applies). */
export async function supabaseServer() {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error('Supabase is not configured');
  const store = await cookies();
  return createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* called from a Server Component; the proxy refreshes cookies instead */ }
      }
    }
  });
}
