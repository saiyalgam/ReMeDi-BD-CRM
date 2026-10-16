import { criterionAction } from '@/app/actions';
import { Badge, Notes, PageHead } from '@/components/ui';
import { getSession } from '@/lib/data';
import { listCriteria } from '@/lib/data-ext';
import { SCORE_KINDS } from '@/lib/types';

export const metadata = { title: 'Scoring rules' };
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ScoringPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [session, criteria] = await Promise.all([getSession(), listCriteria()]);
  const admin = session?.user.role === 'admin';
  return (
    <>
      <PageHead eyebrow="Settings" title="Scoring rules" crumbs={[{ href: '/settings', label: 'Settings' }]}>
        Separate scorecards per opportunity type. Each criterion is scored 0–5 with a written rationale; the weighted total out of 100 supports the review and never makes the Go / No-go decision. The defaults are a starting point for the team to adjust.
      </PageHead>
      <Notes sp={sp} />
      {SCORE_KINDS.map(kind => {
        const rows = criteria.filter(c => c.kind === kind);
        const total = rows.filter(c => c.active).reduce((a, c) => a + c.weight, 0);
        return (
          <section className="card" key={kind}>
            <header><div><h2>{kind}</h2><p>Total weight {total}.</p></div></header>
            <div className="tbl-wrap"><table className="tbl plain">
              <thead><tr><th>Criterion</th><th>Guidance</th><th className="r">Weight</th><th>Active</th>{admin ? <th /> : null}</tr></thead>
              <tbody>{rows.map(c => admin ? (
                <tr key={c.id}><td colSpan={5}>
                  <form action={criterionAction} className="inline" style={{ width: '100%' }}>
                    <input type="hidden" name="cid" value={c.id} /><input type="hidden" name="kind" value={kind} />
                    <input type="text" name="criterion" defaultValue={c.criterion} aria-label="Criterion" style={{ flex: '2 1 240px' }} />
                    <input type="text" name="guidance" defaultValue={c.guidance || ''} aria-label="Guidance" placeholder="Guidance" style={{ flex: '3 1 260px' }} />
                    <input type="number" name="weight" defaultValue={c.weight} min={0} max={10} aria-label="Weight" style={{ width: 70 }} />
                    <label className="chk"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                    <button className="btn btn-sm" type="submit">Save</button>
                  </form>
                </td></tr>
              ) : (
                <tr key={c.id}><td>{c.criterion}</td><td className="muted">{c.guidance}</td><td className="r">{c.weight}</td><td>{c.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neu">Off</Badge>}</td></tr>
              ))}</tbody>
            </table></div>
            {admin ? (
              <form action={criterionAction} className="inline">
                <input type="hidden" name="kind" value={kind} />
                <input type="text" name="criterion" placeholder="New criterion" aria-label={`New criterion for ${kind}`} required />
                <input type="text" name="guidance" placeholder="Guidance" aria-label="Guidance" />
                <input type="number" name="weight" defaultValue={1} min={0} max={10} aria-label="Weight" style={{ width: 70 }} />
                <input type="hidden" name="active" value="on" />
                <button className="btn btn-sm btn-primary" type="submit">Add</button>
              </form>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
