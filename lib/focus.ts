// "10 qualified leads, not 100" (update 8).
// The focus list is the short list a person can actually decide on or discuss this week. Everything else stays in the
// CRM (All opportunities, Crawler intake) but is not counted on the dashboard, the menu or the default board.
import type { Lead } from './types';
import { daysLeft } from './format';
import { isOpen } from './views';

export const FOCUS_LIMIT = 10;
/** Crawler leads nobody has verified yet need at least this fit score to enter the focus list. */
export const FOCUS_MIN_FIT = 60;

const EARLY = ['Identified', 'Screening', 'Under consideration'];
const PRIO: Record<string, number> = { Apply: 30, Consider: 15, Review: 5 };

/** Leads already being worked on (partnering, preparing, submitted, negotiating) are always in view. */
export const inProgress = (l: Lead) => isOpen(l) && !EARLY.includes(l.stage);

/** A lead worth deciding on now: open, not expired, not a published skip, and either verified by a person or scored well. */
export function qualified(l: Lead): boolean {
  if (!isOpen(l) || !EARLY.includes(l.stage)) return false;
  if (l.decision === 'No-go') return false;
  if (['Skip', 'Watch'].includes(l.priority || '')) return false;
  const d = daysLeft(l.deadline);
  if (d !== null && d < 0) return false;
  if (l.approval_status === 'Pending') return true;
  if (l.verification === 'Correct' || l.origin === 'manual') return true;
  return (l.fit_score ?? 0) >= FOCUS_MIN_FIT;
}

/** Ranking: waiting for approval first, then priority, fit, and a closing date in the next two weeks. */
export function focusRank(l: Lead): number {
  const d = daysLeft(l.deadline);
  const urgency = d === null ? 0 : d <= 3 ? 25 : d <= 7 ? 18 : d <= 14 ? 10 : 0;
  return (l.approval_status === 'Pending' ? 60 : 0) + (PRIO[l.priority || ''] ?? 0) + (l.fit_score ?? 40) / 2 + urgency
    + (l.verification === 'Correct' ? 8 : 0);
}

/** The focus list (at most FOCUS_LIMIT) and how many other qualified leads were left out. */
export function focusLeads(leads: Lead[], limit = FOCUS_LIMIT): { top: Lead[]; more: number; parked: number } {
  const q = leads.filter(qualified).sort((a, b) => focusRank(b) - focusRank(a));
  const open = leads.filter(l => isOpen(l) && EARLY.includes(l.stage)).length;
  return { top: q.slice(0, limit), more: Math.max(0, q.length - limit), parked: Math.max(0, open - Math.min(q.length, limit)) };
}

/** Badge text for the menu: small numbers only, so a long list never shouts. */
export const badge = (n: number) => (n <= 0 ? undefined : n > 9 ? 9 : n);
