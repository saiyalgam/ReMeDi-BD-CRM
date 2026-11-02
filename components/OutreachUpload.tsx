'use client';
// Spreadsheet upload for events, contacts met, pre-leads and cohorts: upload → map columns → clean and check
// duplicates → assign owners → import. Files are read in the browser; only the cleaned rows are sent to the server,
// which checks permissions again (assigning to other people needs outreach.assign).
import { useActionState, useMemo, useState } from 'react';
import { outreachImportAction } from '@/app/outreach-actions';
import { readSpreadsheet, type Sheet } from '@/lib/sheet';
import type { ImportTarget, OutreachImportResult } from '@/lib/outreach';

type Kind = 'text' | 'long' | 'date' | 'number' | 'email' | 'phone' | 'owner' | 'meeting' | 'prestatus' | 'cohortstatus' | 'importance';
interface FieldDef { key: string; label: string; kind: Kind; required?: boolean; guess: RegExp }

const FIELDS: Record<ImportTarget, FieldDef[]> = {
  contacts: [
    { key: 'name', label: 'Person', kind: 'text', guess: /^(full )?(name|pocs?|contact( person| name)?|person( met)?|attendee|delegate)$/i },
    { key: 'organisation', label: 'Organisation', kind: 'text', guess: /^(org|organi[sz]ations?( name)?|company( name)?|institution|institute|firm|affiliation|hospital|university)$/i },
    { key: 'title', label: 'Title / designation', kind: 'text', guess: /^(title|designation|role|position|job title)$/i },
    { key: 'phone', label: 'Phone', kind: 'phone', guess: /^(phone|mobile|cell|contact( no| number)?|phone mobile|mobile phone|phone number|mobile number|whatsapp)$/i },
    { key: 'email', label: 'Email', kind: 'email', guess: /^(e ?mail|email id|email address(es)?|mail)$/i },
    { key: 'met_on', label: 'Date met', kind: 'date', guess: /^(date|date met|met on|meeting date)$/i },
    { key: 'meeting_status', label: 'Meeting status', kind: 'meeting', guess: /^(meeting|status|meeting status|met)$/i },
    { key: 'details', label: 'Details / discussion', kind: 'long', guess: /^(details|notes?|remarks?|discussion|updates?|comments?|query( interest( raised)?)?|interest( raised)?|requirement|ask)$/i },
    { key: 'next_action', label: 'Next action', kind: 'long', guess: /^((suggested )?next( action| step)?s?|follow ?up( action)?|action( item)?)$/i },
    { key: 'owner', label: 'Owner (name)', kind: 'owner', guess: /^(owner|lead owner|assigned to)$/i },
    { key: 'introducer', label: 'Introducer / warm intro via', kind: 'text', guess: /^(introducer|intro(duced)? by|via|referred by)$/i }
  ],
  events: [
    { key: 'name', label: 'Event name', kind: 'text', required: true, guess: /^(name of the event|event( name)?|conference|name)$/i },
    { key: 'dates_text', label: 'Dates', kind: 'text', guess: /^dates?$/i },
    { key: 'apply_by_text', label: 'Application deadline', kind: 'text', guess: /deadline/i },
    { key: 'importance', label: 'Importance', kind: 'importance', guess: /^(importance|priority)$/i },
    { key: 'location', label: 'Location', kind: 'text', guess: /^(location|city|venue|place)$/i },
    { key: 'purpose', label: 'Purpose / expected output', kind: 'long', guess: /^purpose/i },
    { key: 'participation', label: 'Participating as', kind: 'text', guess: /participation/i },
    { key: 'personnel_text', label: 'Personnel', kind: 'text', guess: /^(personnel|people|team)$/i },
    { key: 'cost_estimate', label: 'Cost estimate (₹)', kind: 'number', guess: /^cost estimate/i },
    { key: 'actual_output', label: 'Actual output', kind: 'long', guess: /^actual output/i }
  ],
  preleads: [
    { key: 'task', label: 'Task', kind: 'text', required: true, guess: /^task$/i },
    { key: 'opportunity', label: 'Opportunity details', kind: 'long', guess: /^opportunity( details)?$/i },
    { key: 'status', label: 'Status', kind: 'prestatus', guess: /^(completion status|status)$/i },
    { key: 'steps', label: 'Steps', kind: 'long', guess: /^(steps|next steps?)$/i },
    { key: 'owner', label: 'Owner (name)', kind: 'owner', guess: /^(owner|assigned to)$/i },
    { key: 'due_on', label: 'Due date', kind: 'date', guess: /^(due( date)?|deadline)$/i }
  ],
  cohorts: [
    { key: 'name', label: 'Cohort / programme', kind: 'text', required: true, guess: /^(cohorts?|programme|program|name)$/i },
    { key: 'updates', label: 'Updates', kind: 'long', guess: /^(updates?|status|notes)$/i },
    { key: 'contact', label: 'Contact', kind: 'text', guess: /^(contact|poc)$/i },
    { key: 'deadline', label: 'Deadline', kind: 'date', guess: /^(deadline|due)$/i }
  ]
};
const TARGET_LABEL: Record<ImportTarget, string> = { contacts: 'contacts', events: 'events', preleads: 'pre-leads', cohorts: 'cohorts' };
const TARGET_LONG: Record<ImportTarget, string> = { contacts: 'People met (contacts / PoCs)', events: 'Events or conferences', preleads: 'Pre-leads', cohorts: 'Cohorts / programmes' };
/** Where columns that are not mapped end up, so nothing in the sheet is lost. */
const NOTES_FIELD: Record<ImportTarget, string> = { contacts: 'details', events: 'purpose', preleads: 'opportunity', cohorts: 'updates' };
/** "Phone / Mobile" → "phone mobile", "Query / Interest Raised" → "query interest raised" */
const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SERIAL = /^(s ?no|sr ?no|sl ?no|serial( no)?|no|sno|#|)$/;
/** How well a header row fits each kind of list (number of columns recognised). */
function fitScore(hdr: unknown[], t: ImportTarget): number { return FIELDS[t].filter(f => hdr.some(h => f.guess.test(norm(h)))).length; }
/** Find the header row: the first of the top 30 rows with 3+ filled cells that matches the most known column names. */
function findHeader(rows: unknown[][], targets: ImportTarget[]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    if (r.filter(c => String(c ?? '').trim()).length < 2) continue;
    const sc = Math.max(...targets.map(t => fitScore(r, t)));
    if (sc > bestScore) { best = i; bestScore = sc; }
  }
  return best;
}
/** A title in the rows above the header (e.g. "CBR AI Conclave"), used to name a new event. */
function sheetTitle(rows: unknown[][], headerRow: number, fallback: string): string {
  for (let i = 0; i < headerRow; i++) { const cells = (rows[i] || []).map(c => String(c ?? '').trim()).filter(Boolean); if (cells.length === 1 && cells[0]!.length <= 120) return cells[0]!; }
  return fallback;
}

function isoDate(v: string): string | null {
  const s = v.trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : null;
}
const meeting = (v: string) => /schedul|set up|booked/i.test(v) ? 'Scheduled' : /follow/i.test(v) ? 'Follow-up' : /no response|not received|no reply/i.test(v) ? 'No response' : /\bmet\b|done|held|completed/i.test(v) ? 'Met' : /closed|not interested/i.test(v) ? 'Closed' : 'To contact';
const preStatus = (v: string) => /convert/i.test(v) ? 'Converted' : /lost|dropped/i.test(v) ? 'Lost' : /hold/i.test(v) ? 'On hold' : /explor/i.test(v) ? 'Exploring' : /progress|ongoing/i.test(v) ? 'In progress' : 'Assigned';
const cohortStatus = (v: string) => /not selected|rejected/i.test(v) ? 'Not selected' : /joined/i.test(v) ? 'Joined' : /applied/i.test(v) ? 'Applied' : /wait/i.test(v) ? 'Waiting' : /closed/i.test(v) ? 'Closed' : 'Conversation initiated';
const importance = (v: string) => /must/i.test(v) ? 'Must' : /high/i.test(v) ? 'High' : /optional|low/i.test(v) ? 'Optional' : 'Medium';

export interface Person { id: string; name: string; email: string }

export function OutreachUpload({ target: initialTarget, targets, eventId, events, people, me, canAssign, existingKeys }: {
  target: ImportTarget; targets?: ImportTarget[]; eventId?: number | null; events?: { id: number; name: string }[];
  people: Person[]; me: string; canAssign: boolean; existingKeys?: string[];
}) {
  const allowed = targets && targets.length ? targets : [initialTarget];
  const [target, setTarget] = useState<ImportTarget>(initialTarget);
  const fields = FIELDS[target];
  const [fileName, setFileName] = useState('');
  const [keepOthers, setKeepOthers] = useState(true);
  const [linkEvent, setLinkEvent] = useState<string>(eventId ? String(eventId) : 'new');
  const [newEventName, setNewEventName] = useState('');
  const [detected, setDetected] = useState<ImportTarget | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIx, setSheetIx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<Record<string, number | undefined>>({});
  const [fileErr, setFileErr] = useState('');
  const [assign, setAssign] = useState<'column' | 'none' | 'me' | 'one' | 'rr'>('column');
  const [oneOwner, setOneOwner] = useState(me);
  const [rr, setRr] = useState<string[]>([]);
  const [followDays, setFollowDays] = useState(2);
  const [merge, setMerge] = useState(true);
  const [state, act, busy] = useActionState<OutreachImportResult | null, FormData>(outreachImportAction, null);

  const sheet = sheets?.[sheetIx];
  const header = sheet?.rows[headerRow] || [];

  const pickSheet = (all: Sheet[], ix: number, name = fileName) => {
    const rows = all[ix]!.rows;
    const h = findHeader(rows, allowed);
    // Which kind of list is this? Pick the allowed kind whose column names match best.
    const scores = allowed.map(t => [t, fitScore(rows[h] || [], t)] as const).sort((a, b) => b[1] - a[1]);
    const best = scores[0]![1] > (scores.find(x => x[0] === target)?.[1] ?? 0) ? scores[0]![0] : target;
    setDetected(best !== initialTarget ? best : null);
    setTarget(best);
    setSheetIx(ix); setHeaderRow(h); setMap(guessFor(best, rows[h] || []));
    setNewEventName(sheetTitle(rows, h, name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ').replace(/\bleads?\b/i, '').trim()));
  };
  const guessFor = (t: ImportTarget, hdr: unknown[]) => {
    const m: Record<string, number | undefined> = {};
    const used = new Set<number>();
    // exact matches first, then the first column that matches each field
    for (const f of FIELDS[t]) hdr.forEach((c, i) => { if (m[f.key] === undefined && !used.has(i) && f.guess.test(norm(c))) { m[f.key] = i; used.add(i); } });
    return m;
  };
  const guess = (hdr: unknown[]) => guessFor(target, hdr);
  const switchTarget = (t: ImportTarget) => { setTarget(t); if (sheet) setMap(guessFor(t, sheet.rows[headerRow] || [])); };
  /** Columns in the sheet that are not mapped to a CRM field (serial-number columns are ignored). */
  const otherCols = (sheet?.rows[headerRow] || []).map((h, i) => ({ i, h: String(h ?? '').trim() || `Column ${i + 1}` }))
    .filter(c => !Object.values(map).includes(c.i) && !SERIAL.test(norm(c.h === `Column ${c.i + 1}` ? '' : c.h)) && (sheet?.rows || []).slice(headerRow + 1).some(r => String((r || [])[c.i] ?? '').trim()));

  const ownerOf = (v: string): string | null => {
    const s = v.trim().toLowerCase(); if (!s) return null;
    const hit = people.find(p => p.name.toLowerCase() === s || p.email.toLowerCase() === s)
      || people.find(p => p.name.toLowerCase().split(/\s+/)[0] === s.split(/\s+/)[0]);
    return hit ? hit.id : null;
  };

  const parsed = useMemo(() => {
    if (!sheet) return [];
    const out: { line: number; row: Record<string, string | null>; problems: string[]; dup: boolean }[] = [];
    const seen = new Set(existingKeys || []);
    const plus = (n: number) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    for (let i = headerRow + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] || [];
      const get = (k: string) => (map[k] === undefined ? '' : String(r[map[k]!] ?? '').trim());
      if (!fields.some(f => get(f.key))) continue;
      if (/^(s\.? ?no\.?|total)$/i.test(String(r[0] || '').trim()) && fields.every(f => !get(f.key) || f.guess.test(get(f.key)))) continue;
      const row: Record<string, string | null> = {}; const problems: string[] = [];
      for (const f of fields) {
        const v = get(f.key);
        if (f.kind === 'date') { const d = isoDate(v); if (v && !d) problems.push(`${f.label}: “${v}” is not a date`); row[f.key] = d; }
        else if (f.kind === 'number') { const n = v.replace(/[,₹\s]/g, ''); row[f.key] = n && Number.isFinite(Number(n)) ? n : null; if (n && !Number.isFinite(Number(n))) problems.push(`${f.label}: “${v}” is not a number`); }
        else if (f.kind === 'phone') row[f.key] = v.replace(/\.0$/, '').replace(/^(\d+)\.(\d+)e\+?\d+$/i, m => String(Number(m))) || null;
        else if (f.kind === 'email') {
          const all = v.split(/[\s,;/]+/).filter(x => /@/.test(x)).map(x => x.toLowerCase());
          row[f.key] = all[0] || null;
          if (all.length > 1) row.details = [row.details, `Other emails: ${all.slice(1).join(', ')}`].filter(Boolean).join('\n');
          if (v && !all.length) problems.push(`Email “${v.slice(0, 40)}” not recognised`);
        }
        else if (f.kind === 'owner') { const id = ownerOf(v); row[f.key] = id; if (v && !id) problems.push(`Owner “${v}” is not a CRM user — left unassigned`); }
        else if (f.kind === 'meeting') { row[f.key] = meeting(v); if (v && !row.details) row.details = `Meeting: ${v}`; }
        else if (f.kind === 'prestatus') row[f.key] = preStatus(v);
        else if (f.kind === 'cohortstatus') row[f.key] = cohortStatus(v);
        else if (f.kind === 'importance') row[f.key] = importance(v);
        else row[f.key] = v ? (row[f.key] ? row[f.key] + '\n' + v : v) : (row[f.key] ?? null);
      }
      if (keepOthers) {
        const extra = otherCols.map(c => [c.h, String(r[c.i] ?? '').trim().replace(/\.0$/, '')] as const).filter(([, v]) => v);
        if (extra.length) { const k = NOTES_FIELD[target]; row[k] = [row[k], extra.map(([h, v]) => `${h}: ${v}`).join('\n')].filter(Boolean).join('\n'); }
      }
      if (target === 'cohorts') row.status = cohortStatus(String(row.updates || ''));
      for (const f of fields) if (f.required && !row[f.key]) problems.push(`${f.label} is empty`);
      if (target === 'contacts' && !row.name && !row.organisation) problems.push('Needs a person or an organisation');
      let dup = false;
      if (target === 'contacts') {
        const key = row.email ? 'e:' + row.email : 'o:' + String(row.organisation || '').toLowerCase() + '|' + String(row.name || '').toLowerCase();
        dup = seen.has(key); seen.add(key);
        if (!row.met_on && eventId) row.met_on = null;
        row.followup_on = plus(followDays);
        row.source = eventId || linkEvent ? 'Event' : 'Spreadsheet upload';
      }
      out.push({ line: i + 1, row, problems, dup });
    }
    return out;
  }, [sheet, headerRow, map, fields, people, existingKeys, target, eventId, followDays, keepOthers, linkEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignable = target === 'contacts' || target === 'preleads' || target === 'cohorts';
  const finalRows = parsed.filter(p => !(fields.some(f => f.required) && p.problems.some(x => x.endsWith('is empty')))).map((p, i) => {
    const row: Record<string, unknown> = { ...p.row, line: p.line };
    if (assignable) {
      if (assign === 'none') row.owner = null;
      else if (assign === 'me') row.owner = me;
      else if (assign === 'one') row.owner = oneOwner || null;
      else if (assign === 'rr') row.owner = rr.length ? rr[i % rr.length] : null;
      if (!canAssign && row.owner && row.owner !== me) row.owner = null;
    }
    return row;
  });
  const bad = parsed.length - finalRows.length;
  const previewFields = (() => { const m = fields.filter(f => map[f.key] !== undefined); return (m.length ? m : fields).slice(0, 6); })();
  const dups = parsed.filter(p => p.dup).length;

  const onFile = async (file: File | undefined) => {
    setFileErr(''); setSheets(null);
    if (!file) return;
    setFileName(file.name);
    try { const all = (await readSpreadsheet(file)).filter(s => s.rows.some(r => r && r.some(c => String(c || '').trim()))); if (!all.length) throw new Error('The file has no data.'); setSheets(all); pickSheet(all, 0, file.name); }
    catch (e) { setFileErr(e instanceof Error ? e.message : String(e)); }
  };

  const errorsCsv = () => {
    const lines = [['line', 'problem'], ...parsed.flatMap(p => p.problems.map(x => [String(p.line), x])), ...(state?.errors || []).map(e => [String(e.line), e.reason])];
    const csv = lines.map(l => l.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `upload-problems-${target}.csv`; a.click();
  };

  return (
    <div className="upload">
      <ol className="up-steps">
        <li className={sheets ? 'done' : 'on'}>Upload</li><li className={sheets ? 'on' : ''}>Map columns</li><li className={sheets ? 'on' : ''}>Check</li>{assignable ? <li className={sheets ? 'on' : ''}>Assign</li> : null}<li className={state?.ok ? 'done' : ''}>Import</li>
      </ol>
      <label className="fld">Excel (.xlsx) or CSV file
        <input type="file" accept=".xlsx,.csv" onChange={e => onFile(e.target.files?.[0])} />
      </label>
      {fileErr ? <div className="note err" role="alert">{fileErr}</div> : null}

      {sheets && sheet ? (
        <>
          {detected ? <div className="note ok" role="status">This file looks like a list of <b>{TARGET_LONG[detected]}</b>, so it will be imported as {TARGET_LABEL[detected]}. Change it below if that is wrong.</div> : null}
          <div className="up-row">
            {allowed.length > 1 ? (
              <label className="fld">This file is a list of
                <select value={target} onChange={e => switchTarget(e.target.value as ImportTarget)}>{allowed.map(t => <option key={t} value={t}>{TARGET_LONG[t]}</option>)}</select>
              </label>
            ) : null}
            {target === 'contacts' && !eventId ? (
              <label className="fld">Met at
                <select value={linkEvent} onChange={e => setLinkEvent(e.target.value)}>
                  <option value="new">A new event…</option>
                  <option value="">No event (personal network)</option>
                  {(events || []).map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </label>
            ) : null}
            {target === 'contacts' && !eventId && linkEvent === 'new' ? (
              <label className="fld">New event name<input type="text" value={newEventName} onChange={e => setNewEventName(e.target.value)} placeholder="e.g. CBR AI Conclave" /></label>
            ) : null}
          </div>
          <div className="up-row">
            {sheets.length > 1 ? (
              <label className="fld">Sheet
                <select value={sheetIx} onChange={e => pickSheet(sheets, Number(e.target.value))}>{sheets.map((s, i) => <option key={s.name + i} value={i}>{s.name} ({s.rows.length} rows)</option>)}</select>
              </label>
            ) : null}
            <label className="fld">Header row
              <input type="text" inputMode="numeric" value={headerRow + 1} onChange={e => { const n = Math.max(1, Number(e.target.value) || 1) - 1; setHeaderRow(n); setMap(guess(sheet.rows[n] || [])); }} style={{ width: 70 }} />
            </label>
          </div>

          <fieldset className="up-map">
            <legend>Map the columns ({TARGET_LABEL[target]})</legend>
            {fields.map(f => (
              <label key={f.key} className="fld">{f.label}{f.required ? ' *' : ''}
                <select value={map[f.key] ?? ''} onChange={e => setMap({ ...map, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— not in this file —</option>
                  {header.map((h, i) => <option key={i} value={i}>{String(h || `Column ${i + 1}`).slice(0, 60)}</option>)}
                </select>
              </label>
            ))}
          </fieldset>
          {otherCols.length ? (
            <label className="chk up-keep"><input type="checkbox" checked={keepOthers} onChange={e => setKeepOthers(e.target.checked)} />
              Keep the other {otherCols.length} column{otherCols.length > 1 ? 's' : ''} in {NOTES_FIELD[target] === 'details' ? 'Details' : NOTES_FIELD[target]}: <span className="muted">{otherCols.map(c => c.h).join(', ')}</span></label>
          ) : null}

          <div className="up-check">
            <b>{parsed.length} rows found</b> · {finalRows.length} ready{bad ? ` · ${bad} missing a required field` : ''}{dups ? ` · ${dups} look like existing records` : ''}
            {parsed.some(p => p.problems.length) ? <button type="button" className="btn-link" onClick={errorsCsv}>Download problems (CSV)</button> : null}
          </div>
          <div className="tbl-wrap up-preview">
            <table className="tbl">
              <thead><tr><th>Line</th>{previewFields.map(f => <th key={f.key}>{f.label}</th>)}<th>Check</th></tr></thead>
              <tbody>
                {parsed.slice(0, 40).map(p => (
                  <tr key={p.line}>
                    <td className="num">{p.line}</td>
                    {previewFields.map(f => <td key={f.key} className="clip">{f.kind === 'owner' ? (people.find(x => x.id === p.row[f.key])?.name || '') : (p.row[f.key] || '')}</td>)}
                    <td>{p.dup ? <span className="badge b-info">Existing</span> : <span className="badge b-ok">New</span>} {p.problems.length ? <span className="badge b-q" title={p.problems.join('\n')}>{p.problems.length} note{p.problems.length > 1 ? 's' : ''}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 40 ? <p className="muted">Showing the first 40 rows.</p> : null}
          </div>

          {assignable ? (
            <fieldset className="up-assign">
              <legend>Assign owners</legend>
              <label><input type="radio" name="am" checked={assign === 'column'} onChange={() => setAssign('column')} /> Use the Owner column{map.owner === undefined ? ' (not mapped: rows stay unassigned)' : ''}</label>
              <label><input type="radio" name="am" checked={assign === 'none'} onChange={() => setAssign('none')} /> Leave unassigned</label>
              <label><input type="radio" name="am" checked={assign === 'me'} onChange={() => setAssign('me')} /> Assign all to me</label>
              {canAssign ? <>
                <label><input type="radio" name="am" checked={assign === 'one'} onChange={() => setAssign('one')} /> Assign all to
                  <select value={oneOwner} onChange={e => { setOneOwner(e.target.value); setAssign('one'); }}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label><input type="radio" name="am" checked={assign === 'rr'} onChange={() => setAssign('rr')} /> Share round-robin between:</label>
                <div className="rr">{people.map(p => <label key={p.id} className="chk"><input type="checkbox" checked={rr.includes(p.id)} onChange={e => { setAssign('rr'); setRr(e.target.checked ? [...rr, p.id] : rr.filter(x => x !== p.id)); }} />{p.name}</label>)}</div>
              </> : <p className="muted">Your role can take rows yourself; assigning to others needs the “Assign contacts” permission.</p>}
              {target === 'contacts' ? <>
                <label>Follow up within <input type="text" inputMode="numeric" value={followDays} onChange={e => setFollowDays(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} style={{ width: 56 }} /> days</label>
                <label><input type="checkbox" checked={merge} onChange={e => setMerge(e.target.checked)} /> Merge rows that match an existing contact (same email, or same organisation and name) instead of skipping them</label>
              </> : null}
            </fieldset>
          ) : null}

          <form action={act} className="up-go">
            <input type="hidden" name="target" value={target} />
            <input type="hidden" name="event_id" value={eventId || (target === 'contacts' && linkEvent !== 'new' ? linkEvent : '')} />
            <input type="hidden" name="new_event_name" value={!eventId && target === 'contacts' && linkEvent === 'new' ? newEventName : ''} />
            <input type="hidden" name="merge" value={merge ? '1' : '0'} />
            <input type="hidden" name="rows" value={JSON.stringify(finalRows)} />
            <button className="btn btn-primary" type="submit" disabled={busy || !finalRows.length}>{busy ? 'Importing…' : `Import ${finalRows.length} ${TARGET_LABEL[target]}`}</button>
          </form>
        </>
      ) : null}

      {state ? (
        <div className={`note ${state.ok ? 'ok' : 'err'}`} role={state.ok ? 'status' : 'alert'}>
          {state.message}
          {state.eventId ? <> <a href={`/events/${state.eventId}?tab=contacts`}>Open the event</a></> : null}
          {state.errors.length ? <> <button type="button" className="btn-link" onClick={errorsCsv}>Download the problems (CSV)</button></> : null}
        </div>
      ) : null}
    </div>
  );
}
