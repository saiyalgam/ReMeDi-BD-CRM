import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card">
      <h2>Lead not found</h2>
      <p className="muted" style={{ margin: 0 }}>It may have been deleted.</p>
      <div><Link className="btn" href="/leads">Back to leads</Link></div>
    </div>
  );
}
