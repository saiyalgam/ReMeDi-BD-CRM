'use client';

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" role="alert">
      <h2>Something went wrong</h2>
      <p className="muted" style={{ margin: 0 }}>{error.message || 'The page could not load.'} If this keeps happening, check that schema.sql has been run in Supabase and that your email is on the team list.</p>
      <div><button className="btn btn-primary" onClick={reset}>Try again</button></div>
    </div>
  );
}
