// Dates are shown in India time.
export function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return Math.round((Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - Date.parse(todayIST() + 'T00:00:00Z')) / 864e5);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'Asia/Kolkata' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (isNaN(mins)) return '';
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function dueLabel(iso: string | null | undefined): { text: string; tone: 'urgent' | 'soon' | 'normal' | 'muted' } {
  const d = daysLeft(iso);
  if (d === null) return { text: 'Rolling / not stated', tone: 'muted' };
  if (d < 0) return { text: `Closed ${-d} d ago`, tone: 'muted' };
  if (d === 0) return { text: 'Closes today', tone: 'urgent' };
  if (d === 1) return { text: '1 day left', tone: 'urgent' };
  return { text: `${d} days left`, tone: d <= 7 ? 'urgent' : d <= 14 ? 'soon' : 'normal' };
}

export function nameOf(members: { id: string; full_name: string | null; email: string }[], id: string | null | undefined): string {
  if (!id) return '';
  const m = members.find(x => x.id === id);
  return m ? (m.full_name || m.email) : 'Former member';
}

export function initials(name: string): string {
  return name.split(/[\s.@]+/).filter(p => /^[A-Za-z]/.test(p)).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
}
