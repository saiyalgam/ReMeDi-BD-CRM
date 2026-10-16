'use client';

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const denied = /role|not allow|permission|approved email/i.test(error.message || '');
  return (
    <div className="card" role="alert">
      <h2>{denied ? 'You do not have access to this' : 'Something went wrong'}</h2>
      <p className="muted" style={{ margin: 0 }}>{error.message || 'The page could not load.'}</p>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{denied ? 'Ask an admin to check your organisation role on Settings → Roles & permissions.' : 'Your last change may not have been saved. If this keeps happening, check that schema.sql, update-2.sql and update-3.sql have been run in Supabase.'}</p>
      <div className="inline"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/">Dashboard</a></div>
    </div>
  );
}
