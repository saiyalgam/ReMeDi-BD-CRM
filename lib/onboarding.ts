// First-login product tour and "New" feature badges (update 7).
// One row per user in user_onboarding: which tour version they finished, and which new features they have opened.
// Bump TOUR_VERSION when a release deserves a new tour; everyone sees it once more.
import { isDemo } from './env';
import { demo, saveDemo } from './demo';
import { supabaseServer } from './supabase/server';

export const TOUR_VERSION = '2026-11-lead-tracker';
/** Features that get a "New" badge in the menu until the person opens them. */
export const NEW_FEATURES = ['tracker', 'followups', 'preleads', 'events', 'people', 'cohorts'] as const;

export interface Onboarding { tour_version: string | null; tour_done_at: string | null; seen_features: string[] }

/** null = cannot tell (update-7.sql not installed): show no tour and no badges rather than nagging every visit. */
export async function getOnboarding(userId: string): Promise<Onboarding | null> {
  if (isDemo()) {
    const row = (demo().onboarding || []).find(o => o.user_id === userId);
    return row ? { tour_version: row.tour_version, tour_done_at: row.tour_done_at, seen_features: row.seen_features } : { tour_version: null, tour_done_at: null, seen_features: [] };
  }
  const sb = await supabaseServer();
  const { data, error } = await sb.from('user_onboarding').select('tour_version, tour_done_at, seen_features').eq('user_id', userId).maybeSingle();
  if (error) return null;
  return (data as Onboarding | null) || { tour_version: null, tour_done_at: null, seen_features: [] };
}

async function write(userId: string, patch: Partial<Onboarding>): Promise<void> {
  if (isDemo()) {
    const st = demo();
    const list = st.onboarding || [];
    const row = list.find(o => o.user_id === userId) || { user_id: userId, tour_version: null, tour_done_at: null, seen_features: [] };
    Object.assign(row, patch);
    st.onboarding = [...list.filter(o => o.user_id !== userId), row];
    saveDemo(st);
    return;
  }
  const sb = await supabaseServer();
  const cur = await getOnboarding(userId);
  const { error } = await sb.from('user_onboarding').upsert({ user_id: userId, ...(cur || {}), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error && !/does not exist/i.test(error.message)) throw new Error(error.message);
}

export async function finishTour(userId: string): Promise<void> {
  await write(userId, { tour_version: TOUR_VERSION, tour_done_at: new Date().toISOString() });
}

export async function markFeatureSeen(userId: string, key: string): Promise<void> {
  if (!(NEW_FEATURES as readonly string[]).includes(key)) return;
  const cur = await getOnboarding(userId);
  if (!cur || cur.seen_features.includes(key)) return;
  await write(userId, { seen_features: [...cur.seen_features, key] });
}
