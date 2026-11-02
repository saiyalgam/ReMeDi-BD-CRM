'use server';
import { getSession } from '@/lib/data';
import { finishTour, markFeatureSeen } from '@/lib/onboarding';

/** Finished or skipped the tour: never show it again for this version. */
export async function finishTourAction(): Promise<void> {
  const s = await getSession();
  if (s) await finishTour(s.user.id).catch(() => undefined);
}

/** Opened a feature that had a "New" badge. */
export async function featureSeenAction(key: string): Promise<void> {
  const s = await getSession();
  if (s) await markFeatureSeen(s.user.id, String(key).slice(0, 40)).catch(() => undefined);
}
