'use client';
// Kanban board for the Lead Tracker. Drag a card to another column, or use the card's "Move to" menu (keyboard friendly).
// Closing a lead (Lost / No-Go / Tanked) asks for a reason first. The server applies the same permission and Go rules
// as the stage menu on the lead page, and any refusal is shown here.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { trackerMoveAction } from '@/app/outreach-actions';
import { STATUS_COLOR, fmtCr, crore, type TrackerStatus } from '@/lib/tracker';
import { Icon } from './ui';

export interface BoardCard {
  id: number; ref: string | null; title: string; buyer: string | null; owner: string; geo: string | null; size: string | null;
  category: string; type: string; source: string; fit: number | null; priority: string | null; next: string | null;
  deadline: string | null; days: number | null; status: TrackerStatus; decision: string;
}

export function TrackerBoard({ cards, columns, closed, canMove }: { cards: BoardCard[]; columns: TrackerStatus[]; closed: TrackerStatus[]; canMove: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(cards);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<TrackerStatus | null>(null);
  const [ask, setAsk] = useState<{ id: number; to: TrackerStatus } | null>(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // a fresh server render replaces local state
  useEffect(() => { setItems(cards); }, [cards]);

  const move = (id: number, to: TrackerStatus, why = '') => {
    const card = items.find(c => c.id === id);
    if (!card || card.status === to) return;
    if (closed.includes(to) && !why) { setAsk({ id, to }); setReason(''); return; }
    const prev = items;
    setItems(items.map(c => (c.id === id ? { ...c, status: to } : c)));
    start(async () => {
      const res = await trackerMoveAction(id, to, why);
      setToast({ ok: res.ok, text: res.ok ? `${card.ref || 'Lead'} ${res.message.toLowerCase()}` : res.message });
      if (!res.ok) setItems(prev); else router.refresh();
      setTimeout(() => setToast(null), 5000);
    });
  };

  const col = (s: TrackerStatus) => items.filter(c => c.status === s);
  const sum = (list: BoardCard[]) => fmtCr(list.reduce((a, c) => a + (crore(c.size) || 0), 0));

  return (
    <div className="board-wrap">
      <div className="board" aria-busy={pending}>
        {columns.map(s => {
          const list = col(s);
          return (
            <section key={s} className={`bcol${over === s ? ' over' : ''}`} aria-label={`${s}: ${list.length} leads`}
              onDragOver={e => { if (canMove && drag != null) { e.preventDefault(); setOver(s); } }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); if (drag != null) move(drag, s); setDrag(null); }}>
              <header className="bhead">
                <i style={{ background: STATUS_COLOR[s].bg }} aria-hidden="true" />
                <b>{s}</b><span className="n">{list.length}</span><span className="v">{sum(list)}</span>
              </header>
              <div className="bcards">
                {list.map(c => <Card key={c.id} c={c} canMove={canMove} onDrag={setDrag} onMove={move} all={[...columns, ...closed]} />)}
                {!list.length ? <p className="bempty">Drop a lead here</p> : null}
              </div>
            </section>
          );
        })}
      </div>

      <details className="closed-drawer">
        <summary>Closed · {closed.map(s => `${s} ${col(s).length}`).join(' · ')}</summary>
        <div className="closed-grid">
          {closed.map(s => (
            <section key={s} className={`bcol slim${over === s ? ' over' : ''}`}
              onDragOver={e => { if (canMove && drag != null) { e.preventDefault(); setOver(s); } }}
              onDragLeave={() => setOver(o => (o === s ? null : o))}
              onDrop={e => { e.preventDefault(); setOver(null); if (drag != null) move(drag, s); setDrag(null); }}>
              <header className="bhead"><i style={{ background: STATUS_COLOR[s].bg }} aria-hidden="true" /><b>{s}</b><span className="n">{col(s).length}</span></header>
              <div className="bcards">{col(s).map(c => <Card key={c.id} c={c} canMove={canMove} onDrag={setDrag} onMove={move} all={[...columns, ...closed]} />)}</div>
            </section>
          ))}
        </div>
      </details>

      {ask ? (
        <div className="modal-back" role="presentation" onClick={() => setAsk(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="why-h" onClick={e => e.stopPropagation()}>
            <h3 id="why-h">Why is it {ask.to}?</h3>
            <p className="muted">The reason is saved on the lead&apos;s history and in the skip review.</p>
            <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Lost on price; buyer chose L1" />
            <div className="inline" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setAsk(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!reason.trim()} onClick={() => { const a = ask; setAsk(null); move(a.id, a.to, reason.trim()); }}>Move to {ask.to}</button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? <div className={`toast ${toast.ok ? 'ok' : 'err'}`} role={toast.ok ? 'status' : 'alert'}>{toast.text}</div> : null}
    </div>
  );
}

function Card({ c, canMove, onDrag, onMove, all }: { c: BoardCard; canMove: boolean; onDrag: (id: number | null) => void; onMove: (id: number, to: TrackerStatus) => void; all: TrackerStatus[] }) {
  const prio = (c.priority || '').toLowerCase();
  return (
    <article className="lcard" draggable={canMove} onDragStart={e => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; onDrag(c.id); }} onDragEnd={() => onDrag(null)}
      style={{ borderLeftColor: STATUS_COLOR[c.status].bg }}>
      <div className="lc-top">
        <Link href={`/leads/${c.id}`} className="lc-title">{c.title}</Link>
        {canMove ? (
          <label className="lc-move">
            <span className="sr-only">Move {c.ref} to</span>
            <select value="" onChange={e => { if (e.target.value) onMove(c.id, e.target.value as TrackerStatus); }} title="Move to…">
              <option value="">⋮</option>
              {all.filter(s => s !== c.status).map(s => <option key={s} value={s}>Move to {s}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <div className="lc-meta">
        <span className="mono">{c.ref}</span>
        {c.buyer ? <span title={c.buyer}>{c.buyer}</span> : null}
      </div>
      <ul className="lc-facts">
        <li><Icon name="user" />{c.owner || <em>Unassigned</em>}</li>
        {c.geo ? <li><Icon name="target" />{c.geo}</li> : null}
        {c.size ? <li><span className="rupee" aria-hidden="true">₹</span>{c.size}</li> : null}
      </ul>
      <div className="lc-chips">
        <span className="chip c-cat">{c.category}</span>
        <span className="chip c-src">{c.source}</span>
        {c.fit != null || c.priority ? <span className={`chip c-fit ${prio}`}>Fit {c.fit ?? '—'}{c.priority ? ` · ${c.priority}` : ''}</span> : null}
      </div>
      {c.next ? <p className="lc-next">{c.next}</p> : null}
      <div className="lc-foot">
        <span className={c.days != null && c.days >= 0 && c.days <= 7 ? 'soon' : undefined}><Icon name="calendar" />{c.deadline ? `Closes ${c.deadline}` : 'No deadline'}{c.days != null && c.days >= 0 && c.days <= 7 ? ` · ${c.days} d` : ''}</span>
        {c.decision === 'Go' ? <span className="go">Go</span> : null}
      </div>
    </article>
  );
}
