'use client';
import { useActionState } from 'react';
import { sendMagicLink, type LoginState } from './actions';

export function LoginForm({ error }: { error?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, error ? { ok: false, message: error } : {});
  return (
    <form action={action} style={{ display: 'grid', gap: 12 }}>
      <label className="fld">Work email
        <input type="email" name="email" required autoComplete="email" placeholder="you@neurosynaptic.com" />
      </label>
      <button className="btn btn-primary" type="submit" disabled={pending} style={{ justifyContent: 'center', padding: '11px 12px' }}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {state.message ? <div className={`note ${state.ok ? 'ok' : 'err'}`} role="status">{state.message}</div> : null}
    </form>
  );
}
