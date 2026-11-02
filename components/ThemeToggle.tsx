'use client';
import { useEffect, useState } from 'react';
import { Icon } from './ui';

/** Light / dark switch. The choice is kept in this browser only (a convenience, not a setting). */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('remedi-theme'); } catch { /* storage blocked */ }
    const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    setDark(isDark);
  }, []);
  const flip = () => {
    const next = !dark; setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('remedi-theme', next ? 'dark' : 'light'); } catch { /* storage blocked */ }
  };
  return (
    <button type="button" className="iconbtn" onClick={flip} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
