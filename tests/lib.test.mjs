import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLeadType, normalizeIngestRow } from '../lib/leadtype.ts';
import { parseFeed, scoreNews } from '../lib/rss.ts';

test('lead type comes from category and title', () => {
  assert.equal(deriveLeadType('Govt Tender - India', 'Supply of ECG machines'), 'Tender');
  assert.equal(deriveLeadType('Intl Govt Tender (partner-led)', 'RFP: assessment of digital readiness'), 'RFP / EOI');
  assert.equal(deriveLeadType('CSR - India', 'Request for Proposals: technology partner'), 'RFP / EOI');
  assert.equal(deriveLeadType('CSR - India', 'HCLTech Grant (next edition)'), 'CSR');
  assert.equal(deriveLeadType('International Grant', 'Call for proposals on NCDs'), 'Grant');
  assert.equal(deriveLeadType('Govt Tender - India', 'anything', 'CSR'), 'CSR');
});

test('crawler rows are cleaned before saving', () => {
  const r = normalizeIngestRow({ uid: 'R1', title: '  Kiosks  for  PHCs ', category: 'Govt Tender - India', deadline: '2026-10-28', fit_score: '81.4', url: 'javascript:alert(1)', found_on: 'yesterday' }, '2026-10-08');
  assert.ok(r.ok);
  assert.equal(r.lead.title, 'Kiosks for PHCs');
  assert.equal(r.lead.fit_score, 81);
  assert.equal(r.lead.url, null);
  assert.equal(r.lead.found_on, '2026-10-08');
  assert.equal(normalizeIngestRow({ title: 'x' }, '2026-10-08').ok, false);
  const bad = normalizeIngestRow({ uid: 'R2', title: 'y', deadline: '31/10/2026', fit_score: 'n/a' }, '2026-10-08');
  assert.ok(bad.ok && bad.lead.deadline === null && bad.lead.fit_score === null);
});

test('Google News RSS items are parsed and the publisher is split from the title', () => {
  const xml = `<rss><channel><item><title>Kiosks for 40 PHCs - The Hindu</title><link>https://news.google.com/rss/articles/abc?oc=5</link><guid isPermaLink="false">abc</guid><pubDate>Mon, 05 Oct 2026 07:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Kiosks for 40 PHCs&lt;/a&gt;&amp;nbsp;&lt;font&gt;The Hindu&lt;/font&gt;</description><source url="https://thehindu.com">The Hindu</source></item>
  <entry><title>Atom story</title><link href="https://example.org/a"/><id>tag:1</id><updated>2026-10-04T10:00:00Z</updated><summary>Short</summary></entry></channel></rss>`;
  const items = parseFeed(xml, 'Feed');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Kiosks for 40 PHCs');
  assert.equal(items[0].source, 'The Hindu');
  assert.equal(items[0].guid, 'abc');
  assert.equal(items[0].published_at, '2026-10-05T07:00:00.000Z');
  assert.equal(items[1].url, 'https://example.org/a');
  assert.equal(items[1].source, 'Feed');
});

test('relevance hint favours domain + opportunity words', () => {
  assert.ok(scoreNews('NHM invites tender for telemedicine kiosks') >= 3);
  assert.equal(scoreNews('City marathon draws record crowd'), 0);
});
