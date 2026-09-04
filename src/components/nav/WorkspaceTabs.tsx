'use client';
/**
 * Workspace tabs — the horizontal strip pinned above the page area.
 *
 * Renders open tabs from the global store. Clicking a tab routes to its
 * href; × closes; the active route always maps 1:1 to a tab key.
 *
 * Side effect — auto-open on URL change: when the pathname changes (sidebar
 * click, browser back/forward, typed URL, deep link), this ensures a tab
 * exists for it and marks it active. When the cap is reached on a fresh
 * deep link, it surfaces the cap message instead of opening.
 */

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { resolveRoute } from '@/lib/nav/modules';
import {
  activateTab, closeTab, openTab, useWorkspaceTabs, WorkspaceTabsFullError,
} from './workspace-tabs-store';

interface Props {
  onTabsFull?: (message: string) => void;
}

export default function WorkspaceTabs({ onTabsFull }: Props) {
  const { tabs, activeKey } = useWorkspaceTabs();
  const router = useRouter();
  const pathname = usePathname() ?? '';

  // Auto-sync: opening any URL the registry knows about pins a tab.
  useEffect(() => {
    const resolved = resolveRoute(pathname);
    if (!resolved) return;
    try {
      openTab({ key: resolved.href, label: resolved.label, moduleId: resolved.moduleId, iconName: resolved.icon.displayName ?? 'Circle' });
    } catch (err) {
      if (err instanceof WorkspaceTabsFullError) onTabsFull?.(err.message);
    }
  }, [pathname, onTabsFull]);

  if (tabs.length === 0) return null;

  const handleClick = (href: string) => {
    activateTab(href);
    if (pathname !== href) router.push(href);
  };

  const handleClose = (href: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const wasActive = activeKey === href;
    closeTab(href);
    if (wasActive) {
      // After close, the store has switched activeKey internally; route to it.
      const next = (window as unknown as { __nextActiveTab?: string }).__nextActiveTab; // not used; read from store on next tick
      // Read the next active from the store snapshot — useSyncExternalStore
      // is synchronous, so the listener has already fired by now.
      const all = JSON.parse(window.sessionStorage.getItem('fleet360-workspace-tabs-v1') ?? '{}');
      const target: string | null = (all?.activeKey as string | null) ?? null;
      if (target && target !== pathname) router.push(target);
      else if (!target) router.push('/platform');
      void next;
    }
  };

  return (
    <div className="flex min-h-[38px] items-stretch gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] backdrop-blur-xl px-2">
      {tabs.map(t => {
        const isActive = t.key === activeKey;
        return (
          <div
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(t.key)}
            className={`group flex max-w-[220px] cursor-pointer select-none items-center gap-2 rounded-t-lg px-3.5 py-1.5 text-[12px] transition-all ${
              isActive
                ? 'border-t-2 border-t-cyan-400 bg-[var(--bg-canvas)] text-cyan-500 font-bold shadow-md'
                : 'border-t-2 border-t-transparent text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
            }`}
            title={t.label}
          >
            <span className="truncate">{t.label}</span>
            <button
              type="button"
              onClick={(e) => handleClose(t.key, e)}
              aria-label={`Close ${t.label}`}
              className="-mr-1 ml-1 rounded-md p-0.5 text-[var(--text-faint)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)] transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
