'use client';
import { useActionState, useState } from 'react';
import { jsonImportAction, type JsonImportState } from '@/app/json-import-actions';

/** Settings → Import: upload a reviewed lead file (.json) such as crm-update-2026-11-02b.json. */
export function JsonImport({ canVerify }: { canVerify: boolean }) {
  const [text, setText] = useState('');
  const [info, setInfo] = useState<{ count: number; note: string; mode: string } | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'update' | 'insert'>('insert');
  const [state, act, busy] = useActionState<JsonImportState, FormData>(jsonImportAction, {});
  const onFile = async (f?: File) => {
    setErr(''); setInfo(null); setText('');
    if (!f) return;
    try {
      const t = await f.text(); const j = JSON.parse(t);
      const rows = Array.isArray(j) ? j : j?.leads;
      if (!Array.isArray(rows)) throw new Error('Expected { "leads": [ … ] }');
      setText(t); const m = j?.mode === 'update' && canVerify ? 'update' : 'insert'; setMode(m);
      setInfo({ count: rows.length, note: typeof j?.note === 'string' ? j.note : '', mode: j?.mode || 'insert' });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <form action={act} className="jsonimp">
      <label className="fld">Lead file (.json)<input type="file" accept=".json,application/json" onChange={e => onFile(e.target.files?.[0])} /></label>
      {err ? <div className="note err" role="alert">{err}</div> : null}
      {info ? <>
        <p><b>{info.count} leads</b>{info.note ? <> · <span className="muted">{info.note}</span></> : null}</p>
        <label className="chk"><input type="radio" name="mode" value="insert" checked={mode === 'insert'} onChange={() => setMode('insert')} /> Add new leads only (existing leads keep everything)</label>
        <label className="chk"><input type="radio" name="mode" value="update" checked={mode === 'update'} disabled={!canVerify} onChange={() => setMode('update')} /> Also refresh existing leads&apos; assessment and record deadline changes as verified{canVerify ? '' : ' (needs “Verify leads”)'}</label>
        <input type="hidden" name="json" value={text} />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Importing…' : `Import ${info.count} leads`}</button>
      </> : null}
      {state.message ? <div className={`note ${state.ok ? 'ok' : 'err'}`} role={state.ok ? 'status' : 'alert'}>{state.message}</div> : null}
    </form>
  );
}
