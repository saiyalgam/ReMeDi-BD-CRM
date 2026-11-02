// DEMO_MODE=1 runs the CRM locally with sample data and no login (never set it on Vercel).
export const isDemo = (): boolean => process.env.DEMO_MODE === '1';

export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function supabaseSecretKey(): string | null {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** DaanVeda API key. Server code only: never import this into a client component or send it to the browser. */
export function daanvedaConfig(): { key: string; base: string } | null {
  const key = process.env.DAANVEDA_API_KEY;
  return key ? { key, base: process.env.DAANVEDA_API_BASE || 'https://api.daanveda.com/v1' } : null;
}
