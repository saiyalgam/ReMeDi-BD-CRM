import Link from 'next/link';
import { newsAction, refreshNewsAction } from '@/app/actions';
import { getSession, listFeeds, listNews } from '@/lib/data';
import { ago } from '@/lib/format';
import type { NewsItem } from '@/lib/types';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default async function NewsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = one(sp.view) || 'review';
  const topic = one(sp.topic);
  const q = one(sp.q).toLowerCase();
  const msg = one(sp.msg);
  const [session, news, feeds] = await Promise.all([getSession(), listNews(), listFeeds()]);
  const topics = [...new Set(feeds.map(f => f.topic).filter(Boolean))] as string[];

  const byView = (n: NewsItem) => view === 'all' ? true : view === 'relevant' ? n.relevance === 'Relevant' : view === 'hidden' ? n.relevance === 'Not relevant' : n.relevance === 'Unreviewed';
  const rows = news.filter(n => byView(n) && (!topic || n.topic === topic) && (!q || (n.title + ' ' + (n.summary || '') + ' ' + (n.source || '')).toLowerCase().includes(q)))
    .sort((a, b) => view === 'review' ? (b.auto_score - a.auto_score) || (b.published_at || '').localeCompare(a.published_at || '') : (b.published_at || '').localeCompare(a.published_at || ''));
  const count = (v: string) => news.filter(n => v === 'all' ? true : v === 'relevant' ? n.relevance === 'Relevant' : v === 'hidden' ? n.relevance === 'Not relevant' : n.relevance === 'Unreviewed').length;
  const link = (patch: Record<string, string>) => { const p = new URLSearchParams({ ...(view ? { view } : {}), ...(topic ? { topic } : {}), ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return '/news?' + p.toString(); };

  return (
    <>
      <div className="phead">
        <div>
          <div className="eyebrow">Market</div>
          <h1>Sector news</h1>
          <p>Telemedicine, procurement, CSR and digital-health stories from {feeds.filter(f => f.active).length} {feeds.filter(f => f.active).length === 1 ? 'feed' : 'feeds'}, refreshed every morning at 7:00 IST.</p>
        </div>
        {session?.user.role === 'admin' ? <form action={refreshNewsAction}><button className="btn btn-primary" type="submit">Fetch news now</button></form> : null}
      </div>
      {msg ? <div className="note ok">{msg}</div> : null}

      <nav className="tabs" aria-label="News view">
        {[['review', 'To review'], ['relevant', 'Relevant'], ['hidden', 'Not relevant'], ['all', 'All']].map(([v, label]) => (
          <Link key={v} className="tab" href={link({ view: v })} aria-current={view === v ? 'page' : undefined}>{label} <span className="n">{count(v)}</span></Link>
        ))}
      </nav>

      <form className="filters" method="get" action="/news">
        <input type="hidden" name="view" value={view} />
        <input type="search" name="q" defaultValue={one(sp.q)} placeholder="Search headlines…" aria-label="Search news" />
        <select name="topic" defaultValue={topic} aria-label="Topic">
          <option value="">All topics</option>
          {topics.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
      </form>

      <div className="news">
        {rows.length ? rows.slice(0, 150).map(n => (
          <article key={n.id} className="nitem">
            <div style={{ minWidth: 0 }}>
              <a className="h" href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a>
              <div className="meta">
                {n.source ? <span>{n.source}</span> : null}
                <span>{ago(n.published_at) || 'date unknown'}</span>
                {n.topic ? <span>{n.topic}</span> : null}
                {n.auto_score >= 3 && n.relevance === 'Unreviewed' ? <span className="hint">Likely relevant</span> : null}
              </div>
              {n.summary ? <p>{n.summary}</p> : null}
            </div>
            <form action={newsAction} className="inline">
              <input type="hidden" name="id" value={n.id} />
              {n.relevance !== 'Relevant' ? <button className="btn btn-sm btn-good" name="relevance" value="Relevant" type="submit">✓ Relevant</button> : null}
              {n.relevance !== 'Not relevant' ? <button className="btn btn-sm" name="relevance" value="Not relevant" type="submit">Not relevant</button> : null}
              {n.relevance !== 'Unreviewed' ? <button className="btn btn-sm" name="relevance" value="Unreviewed" type="submit">Undo</button> : null}
            </form>
          </article>
        )) : (
          <div className="empty">{news.length ? 'Nothing here for these filters.' : 'No news yet. The daily job fills this list at 7:00 IST; an admin can press “Fetch news now”.'}</div>
        )}
      </div>
    </>
  );
}
