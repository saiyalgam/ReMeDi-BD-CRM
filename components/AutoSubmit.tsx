'use client';
import type { ReactNode } from 'react';

/** A select that saves as soon as a new option is picked. */
export function AutoSubmitSelect({ name, defaultValue, label, children }: { name: string; defaultValue: string; label: string; children: ReactNode }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={label} onChange={e => e.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}
