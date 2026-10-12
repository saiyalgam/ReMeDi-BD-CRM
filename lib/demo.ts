// In-memory sample data for DEMO_MODE=1 (local preview only; resets when the server restarts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import raw from './demo-data.json';
import { normalizeIngestRow } from './leadtype';
import { todayIST } from './format';
import { LEAD_DEFAULTS } from './defaults';
import type { AccessRule, Activity, IngestRun, Lead, Member, NewsFeed, NewsItem } from './types';

interface DemoStore {
  members: Member[]; leads: Lead[]; activity: Activity[]; news: NewsItem[]; feeds: NewsFeed[];
  access: AccessRule[]; runs: IngestRun[]; nextId: number;
}

const ME = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-000000000002';
const B = '00000000-0000-4000-8000-000000000003';

function build(): DemoStore {
  const members: Member[] = [
    { id: ME, email: 'tej@neurosynaptic.com', full_name: 'Tej', role: 'admin' },
    { id: A, email: 'anita.sample@neurosynaptic.com', full_name: 'Anita (sample)', role: 'member' },
    { id: B, email: 'rahul.sample@neurosynaptic.com', full_name: 'Rahul (sample)', role: 'member' }
  ];
  const now = new Date().toISOString();
  const leads: Lead[] = [];
  const activity: Activity[] = [];
  let id = 1, aid = 1;
  for (const row of raw as Record<string, unknown>[]) {
    const n = normalizeIngestRow(row, todayIST());
    if (!n.ok) continue;
    const created = `${n.lead.found_on}T03:30:00.000Z`;
    leads.push({ ...LEAD_DEFAULTS, ...n.lead, id: id++, created_at: created, updated_at: created } as Lead);
    activity.push({ id: aid++, lead_id: id - 1, actor: null, action: 'created', detail: `Found by the crawler (${n.lead.source || 'unknown source'})`, created_at: created });
  }
  // A few worked examples so every screen has something to show
  const set = (uidPart: string, patch: Partial<Lead>, note?: string) => {
    const l = leads.find(x => x.title.toLowerCase().includes(uidPart.toLowerCase()));
    if (!l) return;
    Object.assign(l, patch, { updated_at: now });
    if (patch.verification) { l.verified_by = patch.verified_by ?? ME; l.verified_at = now; activity.push({ id: aid++, lead_id: l.id, actor: l.verified_by, action: 'verified', detail: patch.verification + (note ? ': ' + note : ''), created_at: now }); }
    if (patch.assigned_to) { l.assigned_at = now; activity.push({ id: aid++, lead_id: l.id, actor: ME, action: 'assigned', detail: 'Assigned to ' + members.find(m => m.id === patch.assigned_to)!.full_name, created_at: now }); }
    if (patch.decision) activity.push({ id: aid++, lead_id: l.id, actor: l.decided_by ?? ME, action: 'decision', detail: patch.decision + (patch.decision_reason ? ': ' + patch.decision_reason : ''), created_at: now });
    if (patch.stage && patch.stage !== 'New') activity.push({ id: aid++, lead_id: l.id, actor: l.assigned_to ?? ME, action: 'stage', detail: 'New → ' + patch.stage, created_at: now });
  };
  set('Catalyse Tech', { verification: 'Correct', verification_note: 'ToR read; certification evidence needed', assigned_to: ME, stage: 'Submitted' }, 'ToR read; certification evidence needed');
  set('MSRTC', { verification: 'Correct', assigned_to: A, verified_by: A, decision: 'No-go', decision_reason: 'BOOT model: we fund the set-up and the state reimburses per check-up later; EMD ₹1.52 Cr; needs a funding partner; state payment risk.', decided_by: A, decided_at: now, business_model: 'BOOT / PPP' }, 'Checked on mahatenders');
  set('health camps for construction workers', { verification: 'Correct', assigned_to: B, stage: 'Qualified', verified_by: B });
  set('MIT Solve', { verification: 'Correct', assigned_to: ME, stage: 'Preparing', decision: 'Go', decision_reason: 'Philips Foundation prize fits POC + teleconsult for maternal and cardiac care.', decided_by: ME, decided_at: now, contact_name: 'Solve team', contact_email: 'challenges@solve.mit.edu', next_followup: todayIST(), pitch_summary: 'ReMeDi kiosks bring 40+ POC tests and teleconsultation to rural primary care.' });
  set('Tele/e-ICUs', { verification: 'Incorrect', verified_by: A }, 'Tele-ICU staffing, not our product');
  set('MRI tele-reporting', { verification: 'Incorrect', verified_by: B }, 'Teleradiology only');
  set('videoconference equipment', { verification: 'Incorrect' }, 'Meeting-room AV');
  set('Pink Smart Mobile', { verification: 'Duplicate', verified_by: A }, 'Same scheme as the 5-unit SGPGIMS bid');
  set('Uttara Kannada', { verification: 'Correct', assigned_to: B, verified_by: B });
  set('KITA SEHAT', { assigned_to: A });
  set('Jhpiego', { assigned_to: B });
  set('ICMR special call', { verification: 'Correct', assigned_to: A, stage: 'Qualified', verified_by: A });

  return {
    members, leads, activity, news: [], nextId: id,
    feeds: [{ id: 1, name: process.env.DEMO_FEED_URL ? 'Demo feed' : 'Telemedicine tenders, India', url: process.env.DEMO_FEED_URL || 'https://news.google.com/rss/search?q=telemedicine+tender+India+when:14d&hl=en-IN&gl=IN&ceid=IN:en', topic: 'Tenders', active: true }],
    access: [{ pattern: '@neurosynaptic.com', note: 'Everyone with a company email' }],
    runs: [{ id: 1, run_at: '2026-10-02T01:15:00.000Z', received: 38, inserted: 38, note: 'Round 2 (Firecrawl)' }]
  };
}

// Kept in a temp file so pages, server actions and API routes (separate bundles) see the same data.
const FILE = path.join(os.tmpdir(), 'remedi-crm-demo.json');
let cached: { mtime: number; store: DemoStore } | null = null;

export function demo(): DemoStore {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (cached && cached.mtime === mtime) return cached.store;
    const store = JSON.parse(fs.readFileSync(FILE, 'utf8')) as DemoStore;
    store.leads = store.leads.map(l => ({ ...LEAD_DEFAULTS, ...l }) as Lead);
    cached = { mtime, store };
    return cached.store;
  } catch {
    const store = build();
    saveDemo(store);
    return store;
  }
}

export function saveDemo(store: DemoStore = demo()): void {
  fs.writeFileSync(FILE, JSON.stringify(store));
  cached = { mtime: fs.statSync(FILE).mtimeMs, store };
}
export const DEMO_ME = ME;
