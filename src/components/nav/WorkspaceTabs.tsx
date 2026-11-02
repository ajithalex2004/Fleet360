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
import { useLanguage } from '@/contexts/LanguageContext';
import {
  activateTab, closeTab, openTab, useWorkspaceTabs, WorkspaceTabsFullError,
} from './workspace-tabs-store';

interface Props {
  onTabsFull?: (message: string) => void;
}

const TAB_COLOR_PALETTE = [
  {
    // 1. Sky Blue
    inactive: 'bg-sky-50/90 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/70 border-t-2 border-t-sky-300 dark:border-t-sky-700 text-sky-800 dark:text-sky-200 hover:bg-sky-100/90 dark:hover:bg-sky-900/40',
    active: 'bg-sky-100 dark:bg-sky-900/60 border border-sky-400 dark:border-sky-500 border-t-[3px] border-t-sky-600 dark:border-t-sky-400 text-sky-950 dark:text-sky-100 font-bold shadow-sm ring-1 ring-sky-400/30',
    closeBtn: 'text-sky-600/70 dark:text-sky-300/70 hover:bg-sky-200/80 dark:hover:bg-sky-800/60 hover:text-sky-900 dark:hover:text-sky-100',
  },
  {
    // 2. Emerald Mint
    inactive: 'bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 border-t-2 border-t-emerald-300 dark:border-t-emerald-700 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/90 dark:hover:bg-emerald-900/40',
    active: 'bg-emerald-100 dark:bg-emerald-900/60 border border-emerald-400 dark:border-emerald-500 border-t-[3px] border-t-emerald-600 dark:border-t-emerald-400 text-emerald-950 dark:text-emerald-100 font-bold shadow-sm ring-1 ring-emerald-400/30',
    closeBtn: 'text-emerald-600/70 dark:text-emerald-300/70 hover:bg-emerald-200/80 dark:hover:bg-emerald-800/60 hover:text-emerald-900 dark:hover:text-emerald-100',
  },
  {
    // 3. Amber Gold
    inactive: 'bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 border-t-2 border-t-amber-300 dark:border-t-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100/90 dark:hover:bg-amber-900/40',
    active: 'bg-amber-100 dark:bg-amber-900/60 border border-amber-400 dark:border-amber-500 border-t-[3px] border-t-amber-600 dark:border-t-amber-400 text-amber-950 dark:text-amber-100 font-bold shadow-sm ring-1 ring-amber-400/30',
    closeBtn: 'text-amber-600/70 dark:text-amber-300/70 hover:bg-amber-200/80 dark:hover:bg-amber-800/60 hover:text-amber-900 dark:hover:text-amber-100',
  },
  {
    // 4. Violet Lavender
    inactive: 'bg-violet-50/90 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/70 border-t-2 border-t-violet-300 dark:border-t-violet-700 text-violet-800 dark:text-violet-200 hover:bg-violet-100/90 dark:hover:bg-violet-900/40',
    active: 'bg-violet-100 dark:bg-violet-900/60 border border-violet-400 dark:border-violet-500 border-t-[3px] border-t-violet-600 dark:border-t-violet-400 text-violet-950 dark:text-violet-100 font-bold shadow-sm ring-1 ring-violet-400/30',
    closeBtn: 'text-violet-600/70 dark:text-violet-300/70 hover:bg-violet-200/80 dark:hover:bg-violet-800/60 hover:text-violet-900 dark:hover:text-violet-100',
  },
  {
    // 5. Rose Coral
    inactive: 'bg-rose-50/90 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/70 border-t-2 border-t-rose-300 dark:border-t-rose-700 text-rose-800 dark:text-rose-200 hover:bg-rose-100/90 dark:hover:bg-rose-900/40',
    active: 'bg-rose-100 dark:bg-rose-900/60 border border-rose-400 dark:border-rose-500 border-t-[3px] border-t-rose-600 dark:border-t-rose-400 text-rose-950 dark:text-rose-100 font-bold shadow-sm ring-1 ring-rose-400/30',
    closeBtn: 'text-rose-600/70 dark:text-rose-300/70 hover:bg-rose-200/80 dark:hover:bg-rose-800/60 hover:text-rose-900 dark:hover:text-rose-100',
  },
] as const;

export default function WorkspaceTabs({ onTabsFull }: Props) {
  const { tabs, activeKey } = useWorkspaceTabs();
  const { tLabel } = useLanguage();
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
    <div className="flex min-h-[40px] items-end gap-1.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] backdrop-blur-xl px-2.5 pt-1.5">
      {tabs.map((t, index) => {
        const isActive = t.key === activeKey;
        const tabLabel = tLabel(t.label);
        const palette = TAB_COLOR_PALETTE[index % TAB_COLOR_PALETTE.length];
        return (
          <div
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(t.key)}
            className={`group flex max-w-[220px] cursor-pointer select-none items-center gap-2 rounded-t-lg px-3.5 py-1.5 text-[12px] transition-all ${
              isActive ? palette.active : palette.inactive
            }`}
            title={tabLabel}
          >
            <span className="truncate">{tabLabel}</span>
            <button
              type="button"
              onClick={(e) => handleClose(t.key, e)}
              aria-label={`Close ${tabLabel}`}
              className={`-mr-1 ml-1 rtl:-ml-1 rtl:mr-1 rounded-md p-0.5 transition-colors ${palette.closeBtn}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
