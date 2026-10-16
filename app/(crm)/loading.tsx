export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}><div className="sk" style={{ width: 120 }} /><div className="sk" style={{ width: '40%', height: 26 }} /></div>
      <div className="kpis">{Array.from({ length: 4 }, (_, i) => <div key={i} className="kpi"><div className="sk" style={{ width: '60%' }} /><div className="sk" style={{ width: 60, height: 32 }} /></div>)}</div>
      <div className="card">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk" style={{ width: `${90 - i * 7}%` }} />)}</div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
