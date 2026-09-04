'use client';
/**
 * Global collapsible navigation sidebar.
 *
 * Expanded: top-level modules as a flat list. The active module expands
 * inline to show its sub-pages indented underneath.
 *
 * Collapsed: icons only. Hovering any module reveals a flyout to the
 * right with the module's sub-pages — clicking a sub-page from the flyout
 * works identically to clicking it in the expanded sub-list.
 *
 * Every nav click does two things: opens a workspace tab (or activates an
 * existing one) AND routes Next.js to the href. The URL always mirrors
 * the active tab so back/forward and shareable links work.
 *
 * Performance notes:
 *  - Each row is a <Link> with prefetch on hover (or automatic prefetch
 *    when the link enters the viewport) instead of a router.push() call.
 *    Next.js pre-downloads the destination route's RSC payload in the
 *    background, so by the time the user clicks, the navigation
 *    effectively becomes a client-side transition with no network wait.
 *  - The onMouseEnter handler kicks off an additional explicit
 *    router.prefetch(href) on top of the default <Link> behaviour, which
 *    is a no-op in production (already prefetched) but cheap insurance
 *    against any <Link> prefetch scheduling delays.
 *  - The WorkspaceTabsFullError handling stays on the click handler —
 *    prefetch never throws it, only the tab-store op does.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pin, Settings, Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { MODULES, moduleFromPathname, type ModuleDef, type SubPage } from '@/lib/nav/modules';
import { openTab, WorkspaceTabsFullError } from './workspace-tabs-store';
import { usePermissions } from '@/contexts/PermissionContext';
import ThemeToggle from '@/components/ThemeToggle';

const COLLAPSE_KEY = 'fleet360-sidebar-collapsed-v1';
const PINNED_KEY = 'fleet360-sidebar-pinned-v1';
const HIDDEN_MODULES_KEY = 'fleet360-sidebar-hidden-modules-v1';

interface Props {
  /** Notify the AppShell when a tab open fails because the cap is reached. */
  onTabsFull?: (message: string) => void;
}

export default function Sidebar({ onTabsFull }: Props) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const activeModule = useMemo(() => moduleFromPathname(pathname), [pathname]);

  // Hide superOnly sub-pages from non-SUPER_ADMIN users. Page-level access is
  // still enforced by the API; this keeps the sidebar uncluttered.
  const { user } = usePermissions();
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';
  const visibleSubPages = (subs?: SubPage[]) =>
    subs ? subs.filter(sp => !sp.superOnly || isSuperAdmin) : undefined;

  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hiddenModules, setHiddenModules] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
      if (window.localStorage.getItem(PINNED_KEY) === '1') setPinned(true);
      const hidden = window.localStorage.getItem(HIDDEN_MODULES_KEY);
      if (hidden) setHiddenModules(new Set(JSON.parse(hidden)));
    } catch {}
  }, []);

  const toggleCollapsed = () => {
    if (pinned) return; // Don't collapse when pinned
    setCollapsed(c => {
      const next = !c;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const togglePinned = () => {
    setPinned(p => {
      const next = !p;
      try { window.localStorage.setItem(PINNED_KEY, next ? '1' : '0'); } catch {}
      if (next) setCollapsed(false); // Expand when pinned
      return next;
    });
  };

  const hideModule = (moduleId: string) => {
    setHiddenModules(prev => {
      const next = new Set(prev);
      next.add(moduleId);
      try { window.localStorage.setItem(HIDDEN_MODULES_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const unhideModule = (moduleId: string) => {
    setHiddenModules(prev => {
      const next = new Set(prev);
      next.delete(moduleId);
      try { window.localStorage.setItem(HIDDEN_MODULES_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const [flyoutFor, setFlyoutFor] = useState<string | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);

  /**
   * Prefetch the destination route. <Link prefetch> already does this
   * automatically on hover/viewport-entry, but we call it explicitly on
   * mouseenter so the prefetch is in flight by the time the user moves
   * the cursor to the link (the <Link> handler fires after the same
   * mouseenter, so this is a defensive double-prefetch that's a cheap
   * no-op once the request is in flight).
   */
  const prefetch = (href: string) => {
    try { router.prefetch(href); } catch { /* non-fatal */ }
  };

  /**
   * Programmatic nav (used by collapsed-mode flyout buttons that aren't
   * <Link> elements). Same openTab + push pattern as before — the flyout
   * is positioned with absolute styling, so we keep it as a <button> with
   * an explicit router.push for the rare case the user actually uses it.
   */
  const navigate = (moduleId: string, target: { label: string; href: string; icon: LucideIcon }) => {
    try {
      openTab({ key: target.href, label: target.label, moduleId, iconName: target.icon.displayName ?? 'Circle' });
      router.push(target.href);
      setFlyoutFor(null);
    } catch (err) {
      if (err instanceof WorkspaceTabsFullError) onTabsFull?.(err.message);
      else throw err;
    }
  };

  return (
    <aside
      className={`relative flex flex-col flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-[width] duration-150 ${collapsed ? 'w-[60px]' : 'w-56'}`}
      onMouseLeave={() => setFlyoutFor(null)}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-fleet360.png" alt="FLEET360" className="h-7 w-7 flex-shrink-0 rounded-lg object-contain" />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--text-main)]">Fleet360</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Mobility platform</div>
          </div>
        )}
        <button
          type="button"
          onClick={togglePinned}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar (keep expanded)'}
          className={`ml-auto rounded-md p-1 transition-colors ${pinned ? 'text-amber-400 bg-amber-500/10' : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'}`}
        >
          <Pin className={`h-4 w-4 ${pinned ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav ref={navRef} className="flex-1 overflow-y-auto overflow-x-visible p-2">
        <ul className="space-y-0.5">
          {MODULES.filter(m => !hiddenModules.has(m.id)).map(m => {
            const isActive = activeModule?.id === m.id;
            return (
              <li key={m.id}>
                <NavRow
                  module={m}
                  collapsed={collapsed}
                  active={isActive}
                  moduleId={m.id}
                  onTabOpen={openTab}
                  onTabsFull={onTabsFull}
                  onHide={hideModule}
                  onHover={(el) => {
                    if (!collapsed || !m.subPages?.length) return;
                    const rect = el.getBoundingClientRect();
                    const parent = navRef.current?.getBoundingClientRect();
                    setFlyoutTop(rect.top - (parent?.top ?? 0));
                    setFlyoutFor(m.id);
                  }}
                />
                {!collapsed && isActive && visibleSubPages(m.subPages)?.length ? (
                  <ul className="mt-0.5 mb-1 space-y-0.5 pl-2 border-l border-[var(--border-subtle)] ml-4">
                    {visibleSubPages(m.subPages)!.map((sp, idx, arr) => {
                      // Emit a caption row before the first item of each new group.
                      // Undefined group = ungrouped (renders flush, no header).
                      const prevGroup = idx > 0 ? arr[idx - 1].group : undefined;
                      const showHeader = sp.group && sp.group !== prevGroup;
                      return (
                        <React.Fragment key={sp.href}>
                          {showHeader && (
                            <li aria-hidden="true" className={`px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] ${idx > 0 ? 'pt-2' : ''}`}>
                              {sp.group}
                            </li>
                          )}
                          <li>
                            <SubRow
                              page={sp}
                              parentIcon={m.icon}
                              active={pathname === sp.href}
                              moduleId={m.id}
                              onTabOpen={openTab}
                              onTabsFull={onTabsFull}
                            />
                          </li>
                        </React.Fragment>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Settings panel - show/hide modules, theme */}
      {!collapsed && (
        <div className="border-t border-[var(--border-subtle)] p-2 space-y-1.5">
          <div className="px-2">
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)] transition-colors"
          >
            <Settings className="h-4 w-4" />
            <span className="text-[13px]">Menu Settings</span>
          </button>
        </div>
      )}

      {/* Hidden modules panel */}
      {showSettings && !collapsed && hiddenModules.size > 0 && (
        <div className="absolute bottom-14 left-2 right-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-2 shadow-2xl">
          <div className="border-b border-[var(--border-subtle)] px-2 pb-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Hidden Modules
          </div>
          <ul className="space-y-1">
            {MODULES.filter(m => hiddenModules.has(m.id)).map(m => {
              const Icon = m.icon;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => unhideModule(m.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)] transition-colors"
                  >
                    <Icon className="h-4 w-4 text-[var(--text-muted)]" />
                    <span className="flex-1 text-left text-[13px] truncate">{m.label}</span>
                    <Eye className="h-3.5 w-3.5 text-emerald-400" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {collapsed && flyoutFor && (() => {
        const m = MODULES.find(x => x.id === flyoutFor);
        const visible = visibleSubPages(m?.subPages);
        if (!m || !visible?.length) return null;
        return (
          <div
            className="absolute left-[60px] z-50 min-w-[220px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1.5 shadow-2xl"
            style={{ top: Math.max(8, flyoutTop) + 'px' }}
            onMouseEnter={() => setFlyoutFor(m.id)}
            onMouseLeave={() => setFlyoutFor(null)}
          >
            <div className="border-b border-[var(--border-subtle)] px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{m.label}</div>
            <ul className="mt-1 space-y-0.5">
              {visible.map((sp, idx, arr) => {
                const ActiveIcon: LucideIcon = sp.icon ?? m.icon;
                const isActive = pathname === sp.href;
                const prevGroup = idx > 0 ? arr[idx - 1].group : undefined;
                const showHeader = sp.group && sp.group !== prevGroup;
                return (
                  <React.Fragment key={sp.href}>
                    {showHeader && (
                      <li aria-hidden="true" className={`px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] ${idx > 0 ? 'pt-2' : ''}`}>
                        {sp.group}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => navigate(m.id, { label: sp.label, href: sp.href, icon: ActiveIcon })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          isActive
                            ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 border-cyan-400'
                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        <ActiveIcon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} />
                        <span className="truncate">{sp.label}</span>
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          </div>
        );
      })()}
    </aside>
  );
}

function NavRow({
  module: m, collapsed, active, moduleId, onTabOpen, onTabsFull, onHover, onHide,
}: {
  module: ModuleDef; collapsed: boolean; active: boolean; moduleId: string;
  onTabOpen: (t: { key: string; label: string; moduleId: string; iconName: string }) => void;
  onTabsFull?: (message: string) => void;
  onHover: (el: HTMLElement) => void;
  onHide: (moduleId: string) => void;
}) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const Icon = m.icon;
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      onTabOpen({ key: m.href, label: m.label, moduleId, iconName: m.icon.displayName ?? 'Circle' });
    } catch (err) {
      e.preventDefault();
      if (err instanceof WorkspaceTabsFullError) onTabsFull?.(err.message);
      else throw err;
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  useEffect(() => {
    if (!showContextMenu) return;
    const close = () => setShowContextMenu(false);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [showContextMenu]);

  return (
    <>
      <Link
        href={m.href}
        prefetch
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={(e) => {
          prefetchHref(m.href);
          onHover(e.currentTarget);
        }}
        title={collapsed ? m.label : undefined}
        className={`flex w-full items-center gap-2.5 rounded-xl text-left transition-all ${
          collapsed ? 'justify-center py-2.5' : 'px-2.5 py-2'
        } ${
          active
            ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 border-cyan-400 shadow-sm shadow-cyan-500/10'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
        }`}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} />
        {!collapsed && <span className="flex-1 truncate text-[13px]">{m.label}</span>}
        {!collapsed && m.subPages && m.subPages.length > 0 && (
          active
            ? <ChevronLeft className="h-3.5 w-3.5 rotate-[-90deg] text-cyan-400" />
            : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-faint)]" />
        )}
      </Link>

      {/* Context menu */}
      {showContextMenu && (
        <div
          className="fixed z-[100] min-w-[160px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] backdrop-blur-xl py-1 shadow-2xl"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            type="button"
            onClick={() => {
              onHide(m.id);
              setShowContextMenu(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]"
          >
            <EyeOff className="h-4 w-4 text-[var(--text-muted)]" />
            <span>Hide from menu</span>
          </button>
        </div>
      )}
    </>
  );
}

function SubRow({
  page, parentIcon, active, moduleId, onTabOpen, onTabsFull,
}: {
  page: SubPage; parentIcon: LucideIcon; active: boolean; moduleId: string;
  onTabOpen: (t: { key: string; label: string; moduleId: string; iconName: string }) => void;
  onTabsFull?: (message: string) => void;
}) {
  const Icon = page.icon ?? parentIcon;
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      onTabOpen({
        key: page.href,
        label: page.label,
        moduleId,
        iconName: (page.icon ?? parentIcon).displayName ?? 'Circle',
      });
    } catch (err) {
      e.preventDefault();
      if (err instanceof WorkspaceTabsFullError) onTabsFull?.(err.message);
      else throw err;
    }
  };
  return (
    <Link
      href={page.href}
      prefetch
      onClick={handleClick}
      onMouseEnter={() => prefetchHref(page.href)}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
        active
          ? 'bg-cyan-500/10 text-cyan-300 font-bold'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
      }`}
    >
      <Icon className={`h-3 w-3 flex-shrink-0 ${active ? 'text-cyan-400' : 'text-[var(--text-faint)]'}`} />
      <span className="truncate">{page.label}</span>
    </Link>
  );
}

// Module-level prefetch helper — uses Next's router singleton. Captured
// at module load to avoid a per-row closure. Non-fatal: if router is not
// available (e.g. during a server render), the call is silently dropped.
let _prefetch: ((href: string) => void) | null = null;
function prefetchHref(href: string) {
  if (!_prefetch) {
    try {
      // next/navigation's useRouter() is a hook, so we can't call it
      // outside a component. Instead, dispatch a custom event that the
      // AppShell catches — it owns the router instance. This is cheaper
      // than passing the router down through every row, and the cost is
      // one event dispatch per hover.
      window.dispatchEvent(new CustomEvent('fleet360:prefetch', { detail: { href } }));
    } catch { /* SSR / no window */ }
    return;
  }
  _prefetch(href);
}
