'use client';

/**
 * Customer Portal frame: who is signed in, company header, the switch between
 * Field Services and Transport Services (the portals the account can open),
 * and the section's page tabs. Signed-out visitors go to
 * /customer-portal/login (except the login and invite setup pages).
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, PlusCircle, Activity, History, Boxes, LogOut, Wrench, Truck, Loader2, PackageOpen, Users,
} from 'lucide-react';
import { ModuleSubNav, type ModuleTab } from '@/components/ui/module-subnav';
import { canRaiseRequests, ROLE_LABEL, type CustomerPortal, type PortalRole, type TransportCategory } from '@/lib/customer-portal/catalog';

export interface PortalMe {
  user: {
    id: string; email: string; fullName: string | null; mobile: string | null;
    roles: Partial<Record<CustomerPortal, PortalRole>>;
  };
  customer: { id: string; code: string; name: string };
  portals: CustomerPortal[];
  transportCategories: Array<{ category: TransportCategory; title: string; description: string; menu: string[]; approvalRequired: boolean }>;
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
const TRANSPORT_TABS: ModuleTab[] = [
  { href: '/customer-portal/transport', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/customer-portal/transport/new', label: 'New request', icon: PlusCircle },
  { href: '/customer-portal/transport/requests', label: 'Active requests', icon: Activity },
  { href: '/customer-portal/transport/history', label: 'History', icon: History },
];
const SECTION = {
  FSM: { label: 'Field Services', home: '/customer-portal', icon: Wrench, tabs: FSM_TABS, newHref: '/customer-portal/new-request' },
  TRANSPORT: { label: 'Transport Services', home: '/customer-portal/transport', icon: Truck, tabs: TRANSPORT_TABS, newHref: '/customer-portal/transport/new' },
} as const;

const PUBLIC_PAGES = ['/customer-portal/login', '/customer-portal/setup'];

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const isPublic = PUBLIC_PAGES.some((p) => pathname.startsWith(p));
  // The Team page belongs to no portal section.
  const isTeam = pathname.startsWith('/customer-portal/team');
  const [me, setMe] = useState<PortalMe | null>(null);
  const section: CustomerPortal = pathname.startsWith('/customer-portal/transport') ? 'TRANSPORT'
    : isTeam ? (me?.portals[0] ?? 'FSM') : 'FSM';
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

  // A section the account cannot open → the one it can.
  useEffect(() => {
    if (!me || isTeam || me.portals.includes(section) || me.portals.length === 0) return;
    router.replace(SECTION[me.portals[0]].home);
  }, [me, section, router, isTeam]);

  const signOut = async () => {
    await fetch('/api/customer-portal/auth/logout', { method: 'POST' });
    router.replace('/customer-portal/login');
  };

  if (isPublic) {
    return <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] flex items-center justify-center p-4">{children}</div>;
  }
  if (!checked || !me || !me.portals.includes(section)) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] flex items-center justify-center text-[var(--text-muted)]">
        {checked && me?.portals.length === 0 ? <p className="text-sm">No portal is available for your account yet.</p> : <Loader2 className="w-6 h-6 animate-spin" />}
      </div>
    );
  }

  const role = me.user.roles[section];
  const S = SECTION[section];
  const categoryTabs: ModuleTab[] = section === 'TRANSPORT' && me.transportCategories.some((c) => c.category === 'LOGISTICS')
    ? [{ href: '/customer-portal/transport/shipments', label: 'Shipments', icon: PackageOpen }]
    : [];
  const tabs = [...S.tabs, ...categoryTabs].filter((t) => canRaiseRequests(role) || t.href !== S.newHref);
  const isCompanyAdmin = me.portals.some((p) => me.user.roles[p] === 'ADMIN');

  return (
    <PortalContext.Provider value={me}>
      <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500">
                <S.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold">{me.customer.name}</p>
                <p className="text-[11px] text-[var(--text-muted)]">Customer Portal · Customer ID {me.customer.code}</p>
              </div>
            </div>
            {me.portals.length > 1 && (
              <nav aria-label="Portal" className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-1">
                {me.portals.map((p) => {
                  const P = SECTION[p];
                  const on = !isTeam && p === section;
                  return (
                    <Link key={p} href={P.home} aria-current={on ? 'page' : undefined}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        on ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                      <P.icon className="w-3.5 h-3.5" /> {P.label}
                    </Link>
                  );
                })}
              </nav>
            )}
            <div className="flex items-center gap-3 text-xs">
              {isCompanyAdmin && (
                <Link href="/customer-portal/team" aria-current={isTeam ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold ${
                    isTeam ? 'border-blue-500/50 bg-blue-500/10 text-blue-600' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  <Users className="w-3.5 h-3.5" /> Team
                </Link>
              )}
              <span className="text-[var(--text-muted)]">
                {me.user.fullName ?? me.user.email}{role && !isTeam ? ` · ${ROLE_LABEL[role]}` : ''}
              </span>
              <button type="button" onClick={() => void signOut()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 md:px-6 py-5 space-y-5">
          {!isTeam && <ModuleSubNav parent={{ label: 'Customer Portal' }} title={S.label} tabs={tabs} />}
          {children}
        </main>
      </div>
    </PortalContext.Provider>
  );
}
