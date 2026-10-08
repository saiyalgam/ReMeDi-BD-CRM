import { redirect } from 'next/navigation';
import { isDemo, supabaseConfig } from '@/lib/env';
import { LoginForm } from './LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (isDemo()) redirect('/');
  const { error } = await searchParams;
  return (
    <div className="login">
      <div className="box">
        <div className="eyebrow">Neurosynaptic · ReMeDi</div>
        <h1>Opportunity CRM</h1>
        <p className="muted" style={{ margin: 0 }}>Tenders, RFPs, grants, CSR calls and sector news in one place. Sign in with your work email; no password needed.</p>
        {supabaseConfig() ? <LoginForm error={error} /> : <div className="note err">The database is not connected yet. Add the Supabase environment variables and redeploy.</div>}
      </div>
    </div>
  );
}
