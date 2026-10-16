// Google Workspace hooks. Nothing here sends anything unless an administrator configures it.
//
// Calendar: the CRM prepares the event (title, time, attendees, agenda) and opens Google Calendar's own
// "create event" page in the signed-in person's account. That person is the organiser, sees every attendee
// before saving, and adds a Google Meet link with one click (or automatically, if the Workspace admin turned on
// "Automatically add video calls to events I create"). No OAuth scope or domain-wide delegation is needed.
// A direct Calendar API integration (events.insert with conferenceData) is possible later; it needs an OAuth
// client with the calendar.events scope approved by the Workspace admin. See IMPLEMENTATION_NOTES.md.
//
// Chat: PLANNED. Update 4 removed the webhook sender: no Chat API call or webhook post is made by this release.

export interface MeetingDraft { title: string; start: string; durationMin: number; attendees: string[]; details: string; location?: string }

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-20T15:30" in India time -> Google's UTC format 20261020T100000Z */
function toGoogleUtc(localIst: string, addMin = 0): string {
  const t = Date.parse(localIst + ':00+05:30') + addMin * 60000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export function calendarTemplateUrl(m: MeetingDraft): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.title,
    dates: `${toGoogleUtc(m.start)}/${toGoogleUtc(m.start, m.durationMin)}`,
    details: m.details,
    ctz: 'Asia/Kolkata'
  });
  if (m.location) p.set('location', m.location);
  if (m.attendees.length) p.set('add', m.attendees.join(','));
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

/** Google Chat and Meet automation are PLANNED. This release makes no Chat or Meet API calls and holds no credentials
 *  for them. The status below is what the settings screen shows. */
export function chatStatus(): { configured: boolean; enabled: boolean; reason: string } {
  return { configured: false, enabled: false, reason: 'Planned — not part of this release. No messages are sent.' };
}

/** Kept for compatibility; never sends anything in this release. */
export async function postChat(_text: string): Promise<{ status: 'Not configured'; error: string }> {
  return { status: 'Not configured', error: 'Google Chat notifications are planned, not active.' };
}
