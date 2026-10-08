// Small RSS/Atom reader and relevance hint for the News page. No imports so tests can run it directly.

export interface FeedEntry { guid: string; title: string; url: string; source: string | null; published_at: string | null; summary: string | null }

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function strip(s: string): string {
  return decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}

export function parseFeed(xml: string, fallbackSource?: string): FeedEntry[] {
  const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  const out: FeedEntry[] = [];
  for (const b of blocks.slice(0, 100)) {
    let title = strip(tag(b, 'title'));
    let url = decode(tag(b, 'link')).trim();
    if (!url) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); url = m ? decode(m[1]) : ''; }
    if (!title || !/^https?:\/\//i.test(url)) continue;
    let source = strip(tag(b, 'source')) || null;
    // Google News titles end with " - Publisher"
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3)).trim();
    if (!source) source = fallbackSource || null;
    const guid = strip(tag(b, 'guid')) || strip(tag(b, 'id')) || url;
    const dateRaw = strip(tag(b, 'pubDate')) || strip(tag(b, 'published')) || strip(tag(b, 'updated')) || strip(tag(b, 'dc:date'));
    const t = Date.parse(dateRaw);
    let summary = strip(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    if (summary && (summary === title || summary.startsWith(title))) summary = '';
    out.push({ guid: guid.slice(0, 500), title: title.slice(0, 500), url: url.slice(0, 2000), source, published_at: isNaN(t) ? null : new Date(t).toISOString(), summary: summary ? summary.slice(0, 600) : null });
  }
  return out;
}

const DOMAIN = ['telemedicine', 'telehealth', 'teleconsult', 'tele-consult', 'e-sanjeevani', 'esanjeevani', 'kiosk', 'health atm', 'point-of-care', 'point of care',
  'diagnostic', 'mobile medical', 'mmu', 'ncd', 'screening', 'primary health', 'phc', 'arogya mandir', 'wellness centre', 'digital health', 'abdm', 'rural health', 'maternal', 'anaemia', 'ecg'];
const OPPORTUNITY = ['tender', 'rfp', 'bid', 'eoi', 'expression of interest', 'call for proposals', 'grant', 'csr', 'funding', 'procure', 'contract', 'empanel'];

/** 0–5: how likely a headline matters to ReMeDi. Shown as a hint; people mark the final call. */
export function scoreNews(title: string, summary?: string | null): number {
  const s = ` ${(title + ' ' + (summary || '')).toLowerCase()} `;
  const d = DOMAIN.filter(k => s.includes(k)).length;
  const o = OPPORTUNITY.filter(k => new RegExp(`\\b${k}`).test(s)).length;
  return Math.min(5, Math.min(3, d) + Math.min(2, o));
}
