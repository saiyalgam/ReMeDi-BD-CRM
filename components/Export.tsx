// Export menu shown in each screen's header: Excel / CSV downloads (only for roles with the export permission) and
// Print / Save as PDF (everyone — it prints exactly what the person can already see).
import { PrintButton } from './PrintButton';

type Params = Record<string, string | string[] | undefined>;

function query(params: Params, extra: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === 'format' || k === 'sheet' || v == null || v === '') continue;
    (Array.isArray(v) ? v : [v]).forEach(x => q.append(k, x));
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

export function ExportMenu({ kind, params = {}, canExport, id, csvSheets, label = 'Export', align = 'left' }: {
  kind: string; align?: 'left' | 'right'; params?: Params; canExport: boolean; id?: number;
  /** Multi-sheet exports: CSV holds one sheet, so list them to offer one CSV link each. */
  csvSheets?: string[]; label?: string;
}) {
  const base: Record<string, string> = id != null ? { id: String(id) } : {};
  const href = (format: string, sheet?: number) => `/export/${kind}?${query(params, { ...base, format, ...(sheet != null ? { sheet: String(sheet) } : {}) })}`;
  return (
    <details className={`exportmenu noprint${align === 'right' ? ' align-right' : ''}`}>
      <summary className="btn" aria-label={`${label}: download or print this view`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
        {label}
      </summary>
      <div className="exportmenu-pop" role="menu">
        {canExport ? (
          <>
            <a role="menuitem" href={href('xlsx')} download>Excel workbook (.xlsx)</a>
            {csvSheets && csvSheets.length > 1
              ? <div className="exportmenu-csv"><span>CSV, one sheet:</span>{csvSheets.map((n, i) => <a key={n} role="menuitem" href={href('csv', i)} download>{n}</a>)}</div>
              : <a role="menuitem" href={href('csv')} download>CSV (.csv)</a>}
            <span className="exportmenu-hint">{id != null ? "The whole record, every tab." : "Uses the filters on screen."} Logged in the audit trail.</span>
          </>
        ) : <span className="exportmenu-hint">Your role cannot download data. You can still print what you see.</span>}
        <PrintButton />
      </div>
    </details>
  );
}
