'use client';
export function PrintButton({ label = 'Print / Save as PDF' }: { label?: string }) {
  return <button type="button" role="menuitem" className="linklike" onClick={() => { document.querySelectorAll('details.exportmenu[open]').forEach(d => d.removeAttribute('open')); window.print(); }}>{label}</button>;
}
