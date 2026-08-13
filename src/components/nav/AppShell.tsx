'use client';
/**
 * AppShell — the global chrome around every module page.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ Sidebar │  Workspace tabs strip         │
 *   │         ├───────────────────────────────┤
 *   │         │  Page content (children)      │
 *   └─────────────────────────────────────────┘
 *
 * Module layouts that want this shell just wrap their children with
 * <AppShell>{children}</AppShell>. They keep ownership of any top bar
 * (PlatformHomeBar etc.) and ModuleGuard above this — AppShell only owns
 * the navigation layer.
 *
 * Performance:
 *  - Listens for `fleet360:prefetch` custom events dispatched by the
 *    Sidebar's per-row mouseenter handlers, and forwards them to
 *    router.prefetch. The Sidebar can't use useRouter() in its
 *    NavRow/SubRow helpers because they're not React components in the
 *    classic sense (no shared instance), so the event-bus pattern keeps
 *    the prefetch wiring in one place without prop-drilling the router
 *    through every row.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import WorkspaceTabs from './WorkspaceTabs';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => setToast(msg), []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Prefetch bridge: Sidebar rows fire `fleet360:prefetch` on hover,
  // AppShell owns the router instance and forwards it.
  useEffect(() => {
    const onPrefetch = (event: Event) => {
      const detail = (event as CustomEvent<{ href: string }>).detail;
      if (!detail?.href) return;
      try { router.prefetch(detail.href); } catch { /* non-fatal */ }
    };
    window.addEventListener('fleet360:prefetch', onPrefetch);
    return () => window.removeEventListener('fleet360:prefetch', onPrefetch);
  }, [router]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar onTabsFull={showToast} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <WorkspaceTabs onTabsFull={showToast} />
        <div className="relative flex-1 overflow-y-auto bg-slate-950">
          {children}
          {toast && (
            <div className="pointer-events-none absolute left-1/2 bottom-6 z-50 -translate-x-1/2">
              <div className="pointer-events-auto rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-200 shadow-xl">
                {toast}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
