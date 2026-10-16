'use client';
import { useActionState, useMemo, useState } from 'react';
import { importRowsAction, type ImportResult } from '@/app/actions';
import { buildRows, findHeader, guessMapping, IMPORT_FIELDS, type ImportKey, type Mapping } from '@/lib/import';
import { readSpreadsheet, type Sheet } from '@/lib/sheet';

export function ImportClient({ canVerify }: { canVerify: boolean }) {
  const [file, setFile] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, act, pending] = useActionState<ImportResult | null, FormData>(importRowsAction, null);

  const sheet = sheets[sheetIdx];
  const headerRow = sheet?.rows[header] || [];
  const rows = useMemo(() => (sheet ? buildRows(sheet.rows, header, mapping) : []), [sheet, header, mapping]);

  async function onFile(f: File | undefined) {
    setError(''); setSheets([]); if (!f) return;
    if (f.size > 15 * 1024 * 1024) { setError('That file is larger than 15 MB.'); return; }
    setBusy(true);
    try {
      const s = (await readSpreadsheet(f)).filter(x => x.rows.some(r => r.some(c => String(c || '').trim())));
      if (!s.length) throw new Error('No data found in this file.');
      setFile(f.name); setSheets(s); pickSheet(s, 0);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  function pickSheet(s: Sheet[], i: number) {
    setSheetIdx(i);
    const h = findHeader(s[i]!.rows); setHeader(h); setMapping(guessMapping(s[i]!.rows[h] || []));
  }
  const setField = (k: ImportKey, v: string) => setMapping(m => { const n = { ...m }; if (v === '') delete n[k]; else n[k] = Number(v); return n; });
  const withProblems = rows.filter(r => r.problems.length).length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section className="card" aria-labelledby="s1">
        <header><div><h2 id="s1">1. Choose the file</h2><p>Excel (.xlsx) or CSV. The file is read in your browser; only the rows you import are sent.</p></div></header>
        <label className="fld">Spreadsheet<input type="file" accept=".xlsx,.csv" onChange={e => onFile(e.currentTarget.files?.[0])} aria-describedby="filehint" /></label>
        <span id="filehint" className="hint-text">Tip: the BD pipeline workbook (Leads Tracking sheet) is recognised automatically — S. No., Name of the Project, Category, Size (Cr.), Present State, Lead Owner, Geography, Details, Comments, Partner(s).</span>
        {busy ? <div className="sk" style={{ width: '40%' }} aria-label="Reading file" /> : null}
        {error ? <div className="note err" role="alert">{error}</div> : null}
      </section>

      {sheet ? (
        <section className="card" aria-labelledby="s2">
          <header><div><h2 id="s2">2. Map the columns</h2><p>{file} · {sheets.length} sheet(s). Check the guesses; unmapped columns are ignored.</p></div></header>
          <div className="two">
            <label className="fld">Sheet<select value={sheetIdx} onChange={e => pickSheet(sheets, Number(e.target.value))}>{sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}</select></label>
            <label className="fld">Header row<select value={header} onChange={e => { const h = Number(e.target.value); setHeader(h); setMapping(guessMapping(sheet.rows[h] || [])); }}>{sheet.rows.slice(0, 30).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 80)}</option>)}</select></label>
          </div>
          <div className="tbl-wrap"><table className="tbl plain">
            <thead><tr><th>CRM field</th><th>Spreadsheet column</th></tr></thead>
            <tbody>{IMPORT_FIELDS.map(f => (
              <tr key={f.key}><td>{f.label}{'required' in f && f.required ? <span className="req" style={{ color: 'var(--critical-text)' }}> *</span> : null}</td>
                <td><select value={mapping[f.key] ?? ''} onChange={e => setField(f.key, e.target.value)} aria-label={`Column for ${f.label}`}><option value="">— not imported —</option>{headerRow.map((h, i) => h ? <option key={i} value={i}>{String(h).slice(0, 60)}</option> : null)}</select></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      ) : null}

      {sheet && mapping.title !== undefined ? (
        <section className="card" aria-labelledby="s3">
          <header><div><h2 id="s3">3. Check and import</h2><p>{rows.length} row(s) read{withProblems ? `, ${withProblems} with warnings` : ''}. Totals and summary tables in the sheet are skipped. Existing titles are never duplicated.</p></div></header>
          <div className="tbl-wrap" style={{ maxHeight: 380, overflow: 'auto' }}><table className="tbl plain">
            <thead><tr><th>Row</th><th>Title</th><th>Type</th><th>Stage</th><th>Value</th><th>Owner</th><th>Partners named</th><th>Warnings</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.line}><td className="mono-sm">{r.line}</td><td style={{ minWidth: 200 }}>{r.title}</td><td>{r.lead_type}</td><td>{r.stage || 'Identified'}{r.stageRaw && r.stageRaw !== r.stage ? <div className="sub">“{r.stageRaw}”</div> : null}</td><td>{r.value_band || r.amount || '—'}</td><td>{r.owner || '—'}</td><td>{r.partners || '—'}</td><td>{r.problems.length ? <span className="badge b-q">{r.problems.join('; ')}</span> : null}</td></tr>
            ))}</tbody>
          </table></div>
          <form action={act} className="stack">
            <input type="hidden" name="rows" value={JSON.stringify(rows)} />
            <input type="hidden" name="file" value={file} />
            {canVerify ? <label className="chk"><input type="checkbox" name="verified" defaultChecked /> These rows come from the team’s own tracking: mark them verified Correct</label> : <p className="hint-text" style={{ margin: 0 }}>Imported rows will wait in Crawler intake for verification.</p>}
            <p className="hint-text" style={{ margin: 0 }}>Owners are matched to CRM users by first name; unmatched names are noted on the record. Partner names are kept as text (“partners named”) — link them to the directory after checking them. Go / No-go decisions are never imported.</p>
            <div className="inline">
              <button className="btn" name="mode" value="check" type="submit" disabled={pending}>Check first (nothing is saved)</button>
              <button className="btn btn-primary" name="mode" value="import" type="submit" disabled={pending}>{pending ? 'Working…' : `Import ${rows.length} row(s)`}</button>
            </div>
          </form>
          {result ? (
            <div className={`note ${result.ok ? 'ok' : 'err'}`} role="status">
              <div><b>{result.message}</b>{result.skipped.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{result.skipped.slice(0, 30).map(s => <li key={s.line + s.title}>Row {s.line} {s.title ? `“${s.title.slice(0, 60)}”` : ''}: {s.reason}</li>)}</ul> : null}</div>
            </div>
          ) : null}
        </section>
      ) : sheet ? <div className="note warn">Map the “Opportunity name” column to continue.</div> : null}
    </div>
  );
}
