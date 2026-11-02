'use client';
import { useActionState } from 'react';
import { setPinAction, unlockAction, type PinState } from '@/app/pin-actions';

const pinInput = (name: string, label: string, auto = false) => (
  <label className="fld">{label}
    <input className="pin-input" type="password" name={name} inputMode="numeric" pattern="[0-9]*" maxLength={6} minLength={6} required autoComplete="off" autoFocus={auto} />
  </label>
);

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<PinState, FormData>(unlockAction, {});
  return (
    <form action={action} className="pin-form">
      <input type="hidden" name="next" value={next} />
      {pinInput('pin', 'Enter your 6-digit PIN', true)}
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Checking…' : 'Unlock'}</button>
      {state.message ? <div className="note err" role="alert">{state.message}</div> : null}
    </form>
  );
}

export function SetPinForm({ next, needCurrent }: { next: string; needCurrent: boolean }) {
  const [state, action, pending] = useActionState<PinState, FormData>(setPinAction, {});
  return (
    <form action={action} className="pin-form">
      <input type="hidden" name="next" value={next} />
      {needCurrent ? pinInput('current', 'Current PIN', true) : null}
      {pinInput('pin', 'New 6-digit PIN', !needCurrent)}
      {pinInput('confirm', 'Type it again')}
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save PIN'}</button>
      {state.message ? <div className="note err" role="alert">{state.message}</div> : null}
    </form>
  );
}
