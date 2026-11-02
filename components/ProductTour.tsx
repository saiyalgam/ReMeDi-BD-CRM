'use client';
// First-login product tour with coach marks (update 7).
// Shown once per person per TOUR_VERSION: finishing or skipping it is saved on the server, so it does not
// come back on the next login or on another device. "Take the tour again" in the account menu replays it.
// Each step points at an element marked data-tour="…" with a spotlight and a card next to it.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { finishTourAction } from '@/app/onboarding-actions';

export interface TourStep { target?: string; title: string; body: string }

const PAD = 6;

export function ProductTour({ steps, open: initiallyOpen, name }: { steps: TourStep[]; open: boolean; name: string }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i]!;

  // "Take the tour again" (account menu) dispatches this event
  useEffect(() => {
    const replay = () => { setI(0); setOpen(true); };
    window.addEventListener('remedi:tour', replay);
    return () => window.removeEventListener('remedi:tour', replay);
  }, []);

  const measure = useCallback(() => {
    if (!open || !step.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const r = el?.getBoundingClientRect();
    if (!el || !r || r.width === 0 || r.height === 0) { setRect(null); return; } // hidden (e.g. phone layout): show the card centred
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setRect(el.getBoundingClientRect());
  }, [open, step.target]);

  useLayoutEffect(() => { measure(); }, [measure, i]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, measure]);

  const close = useCallback(() => { setOpen(false); void finishTourAction(); }, []);
  const next = useCallback(() => { if (i >= steps.length - 1) close(); else setI(i + 1); }, [i, steps.length, close]);
  const back = useCallback(() => setI(Math.max(0, i - 1)), [i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, next, back]);

  if (!open) return null;

  // Place the card beside the highlighted element: to the right of the sidebar, below things in the top bar.
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight, cw = Math.min(360, vw - 32);
    if (rect.right + 16 + cw < vw && rect.left < vw / 3) cardStyle = { left: rect.right + 16, top: Math.min(Math.max(16, rect.top - 8), vh - 260) };
    else cardStyle = { left: Math.min(Math.max(16, rect.left + rect.width / 2 - cw / 2), vw - cw - 16), top: Math.min(rect.bottom + 14, vh - 260) };
  }
  const first = i === 0, last = i === steps.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {rect
        ? <div className="tour-spot" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} aria-hidden="true" />
        : <div className="tour-dim" aria-hidden="true" />}
      <div className={`tour-card${rect ? '' : ' center'}`} style={cardStyle}>
        <div className="tour-top">
          <span className="tour-tag">{first ? 'Product tour' : last ? 'All set' : `Step ${i} of ${steps.length - 2}`}</span>
          <button type="button" className="tour-x" onClick={close} aria-label="Close the tour">×</button>
        </div>
        <h3 id="tour-title">{first ? step.title.replace('{name}', name.split(' ')[0] || name) : step.title}</h3>
        <p id="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden="true">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'done' : ''} />)}</div>
        <div className="tour-actions">
          {first ? <button type="button" className="btn" onClick={close}>Skip for now</button> : <button type="button" className="btn" onClick={back}>Back</button>}
          <button type="button" className="btn btn-primary" onClick={next} autoFocus>{first ? 'Show me around' : last ? 'Start working' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}

/** Account-menu item that replays the tour on this page. */
export function ReplayTourButton() {
  return <button type="button" onClick={() => { (document.activeElement as HTMLElement | null)?.closest('details')?.removeAttribute('open'); window.dispatchEvent(new Event('remedi:tour')); }}>Take the product tour again</button>;
}
