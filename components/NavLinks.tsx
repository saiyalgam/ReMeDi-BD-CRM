'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export interface NavItem { href: string; label: string; count?: number; color?: string }

export function NavLinks({ title, items }: { title: string; items: NavItem[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const current = path + (sp.toString() ? '?' + sp.toString() : '');
  const isActive = (href: string) => {
    const [p, q] = href.split('?');
    if (p !== path) return false;
    if (!q) return !sp.get('type') && !sp.get('assignee');
    return new URLSearchParams(q).toString().split('&').every(kv => current.includes(kv));
  };
  return (
    <nav className="navgroup" aria-label={title}>
      <small>{title}</small>
      {items.map(it => (
        <Link key={it.href} href={it.href} className="navlink" aria-current={isActive(it.href) ? 'page' : undefined}>
          <span className="lbl">{it.color ? <i className="dot" style={{ background: it.color }} aria-hidden="true" /> : null}{it.label}</span>
          {it.count != null ? <span className="count">{it.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
