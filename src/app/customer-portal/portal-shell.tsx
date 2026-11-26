'use client';

/**
 * Customer Portal frame: who is signed in, company header, page tabs.
 * Signed-out visitors go to /customer-portal/login (except the login and
 * invite setup pages themselves).
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, PlusCircle, Activity, History, Boxes, LogOut, Wrench, Loader2 } from 'lucide-react';
import { ModuleSubNav, type ModuleTab } from '@/components/ui/module-subnav';

export interface PortalMe {
  user: { id: string; email: string; fullName: string | null; role: 'ADMIN' | 'REQUESTER' | 'VIEWER' };
  customer: { id: string; code: string; name: string };
  portals: Array<'FSM' | 'TRANSPORT'>;
}

const PortalContext = createContext<PortalMe | null>(null);
export const usePortal = () => useContext(PortalContext);

const FSM_TABS: ModuleTab[] = [
  { href: '/customer-portal', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/customer-portal/new-request', label: 'New request', icon: PlusCircle },
  { href: '/customer-portal/requests', label: 'Active requests', icon: Activity },
  { href: '/customer-portal/history', label: 'Service history', icon: History },
  { href: '/customer-portal/assets', label: 'Assets and inventory', icon: Boxes },
];

const ROLE_LABEL = { ADMIN: 'Admin', REQUESTER: 'Requester', VIEWER: 'Viewer' } as const;
const PUBLIC_PAGES = ['/customer-portal/login', '/customer-portal/setup'];

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const isPublic = PUBLIC_PAGES.some((p) => pathname.startsWith(p));
  const [me, setMe] = useState<PortalMe | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isPublic) { setChecked(true); return; }
    void (async () => {
      const res = await fetch('/api/customer-portal/me', { cache: 'no-store' });
      if (res.status === 401) { router.replace(`/customer-portal/login?next=${encodeURIComponent(pathname)}`); return; }
      const data = await res.json().catch(() => null);
      if (data?.ok) setMe(data);
      setChecked(true);
    })();
  }, [isPublic, pathname, router]);

  const signOut = async () => {
    await fetch('/api/customer-portal/auth/logout', { method: 'POST' });
    router.replace('/customer-portal/login');
  };

  if (isPublic) {
    return <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] flex items-center justify-center p-4">{children}</div>;
  }
  if (!checked || !me) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center text-[var(--text-muted)]">
        {checked ? <p className="text-sm">This portal is not available for your account.</p> : <Loader2 className="w-6 h-6 animate-spin" />}
      </div>
    );
  }

  return (
    <PortalContext.Provider value={me}>
      <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500">
                <Wrench className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold">{me.customer.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">Field Service portal · Customer ID {me.customer.code}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-[var(--text-muted)]">
                {me.user.fullName ?? me.user.email} · {ROLE_LABEL[me.user.role]}
              </span>
              <button type="button" onClick={() => void signOut()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">
          {me.portals.includes('FSM') ? (
            <>
              <ModuleSubNav parent={{ label: 'Customer Portal' }} title="Field Service" tabs={me.user.role === 'VIEWER' ? FSM_TABS.filter((t) => t.href !== '/customer-portal/new-request') : FSM_TABS} />
              {children}
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Your company has the Transport portal. <Link href="/customer-portal" className="text-blue-500">Refresh</Link> once it is available.
            </p>
          )}
        </main>
      </div>
    </PortalContext.Provider>
  );
}
