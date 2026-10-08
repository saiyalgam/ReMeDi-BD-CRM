import { parseFeed, scoreNews } from './rss';
import type { NewsFeed } from './types';

export interface FetchedNews {
  feed_id: number; guid: string; title: string; url: string; source: string | null; topic: string | null;
  summary: string | null; published_at: string | null; auto_score: number;
}

/** Download every active feed and return parsed, scored items (skips items older than 30 days). */
export async function fetchFeeds(feeds: NewsFeed[]): Promise<{ items: FetchedNews[]; errors: string[] }> {
  const items: FetchedNews[] = [];
  const errors: string[] = [];
  const cutoff = Date.now() - 30 * 864e5;
  await Promise.all(feeds.filter(f => f.active).map(async f => {
    try {
      const res = await fetch(f.url, {
        headers: { 'User-Agent': 'ReMeDiOpportunityCRM/1.0 (+news reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const e of parseFeed(await res.text(), f.name)) {
        if (e.published_at && Date.parse(e.published_at) < cutoff) continue;
        items.push({ ...e, feed_id: f.id, topic: f.topic, auto_score: scoreNews(e.title, e.summary) });
      }
    } catch (err) {
      errors.push(`${f.name}: ${(err as Error).message}`);
    }
  }));
  // the same story often appears in several searches
  const seen = new Set<string>();
  const unique = items.filter(i => { const k = i.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k) || seen.has(i.guid)) return false; seen.add(k); seen.add(i.guid); return true; });
  return { items: unique, errors };
}
