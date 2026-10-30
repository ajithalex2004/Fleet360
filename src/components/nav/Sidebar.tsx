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
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Pin, Settings, Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { MODULES, NAV_CATEGORIES, moduleFromPathname, type ModuleDef, type SubPage, type NavCategory } from '@/lib/nav/modules';
import { openTab, WorkspaceTabsFullError } from './workspace-tabs-store';
import { canOpenModule } from '@/lib/nav/module-visibility';
import { usePermissions } from '@/contexts/PermissionContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { RunningLabel } from '@/components/ui/RunningLabel';
import ThemeToggle from '@/components/ThemeToggle';

const COLLAPSE_KEY = 'fleet360-sidebar-collapsed-v1';
const PINNED_KEY = 'fleet360-sidebar-pinned-v1';
const WIDE_KEY = 'fleet360-sidebar-wide-v1';
const HIDDEN_MODULES_KEY = 'fleet360-sidebar-hidden-modules-v1';
const CAT_COLLAPSED_KEY = 'fleet360-sidebar-cat-collapsed-v1';

interface Props {
  /** Notify the AppShell when a tab open fails because the cap is reached. */
  onTabsFull?: (message: string) => void;
}

export default function Sidebar({ onTabsFull }: Props) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const activeModule = useMemo(() => moduleFromPathname(pathname), [pathname]);
  const { tLabel } = useLanguage();

  const { user, tenant, permissions } = usePermissions();
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';
  const isTenantAdmin = user?.roleCode === 'TENANT_ADMIN' || user?.roleCode === 'ADMIN' || Boolean(user?.roleCode?.includes('ADMIN'));
  const canOpen = (id: string) =>
    !!user && canOpenModule(id, { roleCode: user.roleCode, enabledModules: tenant?.enabledModules, permissions, navPermissions: tenant?.navPermissions });
  const visibleSubPages = (subs?: SubPage[], moduleId?: string) => {
    if (!subs) return undefined;
    let list = subs.filter(sp => !sp.superOnly || isSuperAdmin);
    if (!isSuperAdmin) {
      const navPerms = tenant?.navPermissions ?? {};
      list = list.filter(sp => {
        // Explicit sub-menu toggle (`sub:<href>`) applies across ALL modules
        if (`sub:${sp.href}` in navPerms && navPerms[`sub:${sp.href}`] === false) return false;
        if (!isTenantAdmin && `other:sub:${sp.href}` in navPerms && navPerms[`other:sub:${sp.href}`] === false) return false;

        if (moduleId === 'admin') {
          if (sp.href === '/admin' && navPerms['overview'] === false) return false;
          if (sp.href === '/admin/users' && navPerms['users'] === false) return false;
          if (sp.href === '/admin/roles' && navPerms['roles'] === false) return false;
          if (!isTenantAdmin) {
            const otherKey = sp.navKey ? `other:${sp.navKey}` : `other:sub:${sp.href}`;
            if (navPerms[otherKey] !== true && navPerms[`other:sub:${sp.href}`] !== true) return false;
          }
          if (!sp.navKey) return true;
          if (sp.navKey in navPerms) return navPerms[sp.navKey] === true;
          return !sp.defaultHiddenForTenantAdmin;
        }
        return true;
      });
    }
    if (
      moduleId === 'logistics' &&
      !isSuperAdmin &&
      tenant?.enabledModules &&
      tenant.enabledModules.length > 0 &&
      !tenant.enabledModules.includes('logistics') &&
      (tenant.enabledModules.includes('drayage') || tenant.enabledModules.includes('port-drayage') || tenant.enabledModules.includes('container-drayage'))
    ) {
      list = list.filter(sp => sp.href.startsWith('/logistics/drayage'));
    }
    return list;
  };

  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [wide, setWide] = useState(false);
  const [hiddenModules, setHiddenModules] = useState<Set<string>>(new Set());
  const [collapsedCats, setCollapsedCats] = useState<Set<NavCategory>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set(['fleet', 'admin', 'finance', 'logistics']));

  useEffect(() => {
    if (activeModule?.id) {
      setExpandedModules(prev => {
        if (prev.has(activeModule.id)) return prev;
        const next = new Set(prev);
        next.add(activeModule.id);
        return next;
      });
      if (activeModule.category) {
        setCollapsedCats(prev => {
          if (!prev.has(activeModule.category)) return prev;
          const next = new Set(prev);
          next.delete(activeModule.category);
          return next;
        });
      }
    }
  }, [activeModule?.id, activeModule?.category]);

  const toggleModuleExpand = (moduleId: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  useEffect(() => {
    try {
      const isPinned = window.localStorage.getItem(PINNED_KEY) === '1';
      const isWide = window.localStorage.getItem(WIDE_KEY) === '1';
      setPinned(isPinned);
      setWide(isWide);
      if (isPinned) {
        // When pinned, never allow the sidebar to start contracted
        setCollapsed(false);
        window.localStorage.setItem(COLLAPSE_KEY, '0');
      } else if (window.localStorage.getItem(COLLAPSE_KEY) === '1') {
        setCollapsed(true);
      }
      const hidden = window.localStorage.getItem(HIDDEN_MODULES_KEY);
      if (hidden) setHiddenModules(new Set(JSON.parse(hidden)));
      const collapsedCatsData = window.localStorage.getItem(CAT_COLLAPSED_KEY);
      if (collapsedCatsData) setCollapsedCats(new Set(JSON.parse(collapsedCatsData)));
    } catch {}
  }, []);

  const toggleCategory = (catId: NavCategory) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      try { window.localStorage.setItem(CAT_COLLAPSED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const contractSidebar = () => {
    // Once pinned, do not contract unless the user clicks Unpin first
    if (pinned) return;
    if (!collapsed && wide) {
      setWide(false);
      try { window.localStorage.setItem(WIDE_KEY, '0'); } catch {}
      return;
    }
    setCollapsed(true);
    try { window.localStorage.setItem(COLLAPSE_KEY, '1'); } catch {}
  };

  const expandSidebar = () => {
    if (collapsed) {
      setCollapsed(false);
      try { window.localStorage.setItem(COLLAPSE_KEY, '0'); } catch {}
      return;
    }
    if (!wide) {
      setWide(true);
      try { window.localStorage.setItem(WIDE_KEY, '1'); } catch {}
    }
  };

  const togglePinned = () => {
    setPinned(p => {
      const next = !p;
      try {
        window.localStorage.setItem(PINNED_KEY, next ? '1' : '0');
        if (next) window.localStorage.setItem(COLLAPSE_KEY, '0');
      } catch {}
      if (next) setCollapsed(false);
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

  const isEffectivelyCollapsed = collapsed && !pinned;
  const widthClass = isEffectivelyCollapsed ? 'w-[68px]' : wide ? 'w-76' : 'w-60';

  return (
    <aside
      className={`sticky top-0 h-screen max-h-screen relative flex flex-col flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-[width] duration-150 ${widthClass}`}
      onMouseLeave={() => setFlyoutFor(null)}
    >
      <div className={`border-b border-[var(--border-subtle)] px-2.5 py-2.5 ${isEffectivelyCollapsed ? 'flex flex-col items-center gap-1.5' : 'flex items-center gap-2'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-fleet360.png" alt="FLEET360" className="h-7 w-7 flex-shrink-0 rounded-lg object-contain" />
        {!isEffectivelyCollapsed && (
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--text-main)] truncate">Fleet360</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] truncate">{tLabel('Mobility platform')}</div>
          </div>
        )}
        <div className={`flex items-center gap-1 ${isEffectivelyCollapsed ? 'justify-center' : 'ml-auto flex-shrink-0'}`}>
          <button
            type="button"
            onClick={togglePinned}
            title={pinned ? tLabel('Pinned — click to unpin so sidebar can contract') : tLabel('Pin sidebar (lock expanded)')}
            className={`rounded-md p-1 transition-colors ${pinned ? 'text-amber-400 bg-amber-500/15 ring-1 ring-amber-500/40' : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'}`}
          >
            <Pin className={`h-4 w-4 ${pinned ? 'fill-current' : ''}`} />
          </button>
          {!isEffectivelyCollapsed && (
            <button
              type="button"
              onClick={contractSidebar}
              disabled={pinned}
              title={pinned ? tLabel('Sidebar is pinned — click Unpin to contract') : wide ? tLabel('Contract sidebar') : tLabel('Collapse sidebar (<<)')}
              aria-label={tLabel('Collapse sidebar')}
              className={`rounded-md p-1 transition-colors ${
                pinned
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-faint)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <ChevronsLeft className="h-4 w-4 rtl:rotate-180" />
            </button>
          )}
          {(isEffectivelyCollapsed || !wide) && (
            <button
              type="button"
              onClick={expandSidebar}
              title={isEffectivelyCollapsed ? tLabel('Expand sidebar (>>)') : tLabel('Expand sidebar wider (>>)')}
              aria-label={tLabel('Expand sidebar')}
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)] transition-colors"
            >
              <ChevronsRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>

      <nav ref={navRef} className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden p-2 sidebar-scrollbar">
        {NAV_CATEGORIES.map((cat, catIdx) => {
          if (!isSuperAdmin && tenant?.navPermissions?.[`cat:${cat.id}`] === false) return null;
          if (!isSuperAdmin && !isTenantAdmin && tenant?.navPermissions?.[`other:cat:${cat.id}`] === false) return null;
          const catModules = MODULES.filter(m => m.category === cat.id && !hiddenModules.has(m.id) && canOpen(m.id));
          if (catModules.length === 0) return null;
          const isCatCollapsed = collapsedCats.has(cat.id);
          const CatIcon = cat.icon;

          if (isEffectivelyCollapsed) {
            return (
              <div key={cat.id}>
                {catIdx > 0 && <div className="my-1.5 mx-2 border-t border-[var(--border-subtle)]/60" />}
                <ul className="space-y-0.5">
                  {catModules.map(m => {
                    const isActive = activeModule?.id === m.id;
                    return (
                      <li key={m.id}>
                        <NavRow
                          module={m}
                          collapsed={true}
                          active={isActive}
                          moduleId={m.id}
                          onTabOpen={openTab}
                          onTabsFull={onTabsFull}
                          onHide={hideModule}
                          onHover={(el) => {
                            if (!m.subPages?.length) return;
                            const rect = el.getBoundingClientRect();
                            const parent = navRef.current?.getBoundingClientRect();
                            setFlyoutTop(rect.top - (parent?.top ?? 0));
                            setFlyoutFor(m.id);
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          }

          return (
            <div key={cat.id} className="mb-2.5">
              {cat.id === 'finance' && (
                <div className="my-2.5 mx-1 border-t border-[var(--border-subtle)]" />
              )}
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className="group flex w-full items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)] hover:text-[var(--text-main)] transition-colors rounded-md hover:bg-[var(--bg-surface-hover)] select-none"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <CatIcon className="h-3 w-3 text-[var(--text-faint)] group-hover:text-cyan-400 transition-colors" />
                  <span>{tLabel(cat.label)}</span>
                </span>
                <ChevronDown
                  className={`h-3 w-3 text-[var(--text-faint)] transition-transform duration-150 ${
                    isCatCollapsed ? '-rotate-90 rtl:rotate-90' : ''
                  }`}
                />
              </button>

              {!isCatCollapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {catModules.map(m => {
                    const isActive = activeModule?.id === m.id;
                    return (
                      <li key={m.id}>
                        <NavRow
                          module={m}
                          collapsed={false}
                          isExpanded={isActive || expandedModules.has(m.id)}
                          onToggleExpand={toggleModuleExpand}
                          active={isActive}
                          moduleId={m.id}
                          onTabOpen={openTab}
                          onTabsFull={onTabsFull}
                          onHide={hideModule}
                          onHover={() => {}}
                        />
                        {(isActive || expandedModules.has(m.id)) && visibleSubPages(m.subPages, m.id)?.length ? (
                          <ul className="mt-0.5 mb-1 space-y-0.5 pl-2 rtl:pl-0 rtl:pr-2 border-l rtl:border-l-0 rtl:border-r border-[var(--border-subtle)] ml-4 rtl:ml-0 rtl:mr-4">
                            {visibleSubPages(m.subPages, m.id)!.map((sp, idx, arr) => {
                              const prevGroup = idx > 0 ? arr[idx - 1].group : undefined;
                              const showHeader = sp.group && sp.group !== prevGroup;
                              return (
                                <React.Fragment key={sp.href}>
                                  {showHeader && (
                                    <li aria-hidden="true" className={`px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] ${idx > 0 ? 'pt-2' : ''}`}>
                                      {tLabel(sp.group ?? '')}
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
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings panel - show/hide modules, theme */}
      {!isEffectivelyCollapsed && (
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
            <span className="text-[13px]">{tLabel('Menu Settings')}</span>
          </button>
        </div>
      )}

      {/* Hidden modules panel */}
      {showSettings && !isEffectivelyCollapsed && hiddenModules.size > 0 && (
        <div className="absolute bottom-14 left-2 right-2 max-h-64 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-2 shadow-2xl">
          <div className="border-b border-[var(--border-subtle)] px-2 pb-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            {tLabel('Hidden Modules')}
          </div>
          <ul className="space-y-1">
            {MODULES.filter(m => hiddenModules.has(m.id) && canOpen(m.id)).map(m => {
              const Icon = m.icon;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => unhideModule(m.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)] transition-colors"
                  >
                    <Icon className="h-4 w-4 text-[var(--text-muted)]" />
                    <span className="flex-1 text-left rtl:text-right text-[13px] truncate">{tLabel(m.label)}</span>
                    <Eye className="h-3.5 w-3.5 text-emerald-400" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isEffectivelyCollapsed && flyoutFor && (() => {
        const m = MODULES.find(x => x.id === flyoutFor);
        const visible = visibleSubPages(m?.subPages, m?.id);
        if (!m || !visible?.length) return null;
        const categoryDef = NAV_CATEGORIES.find(c => c.id === m.category);
        return (
          <div
            className="absolute left-[60px] rtl:left-auto rtl:right-[60px] z-50 min-w-[230px] max-h-[80vh] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1.5 shadow-2xl"
            style={{ top: Math.max(8, flyoutTop) + 'px' }}
            onMouseEnter={() => setFlyoutFor(m.id)}
            onMouseLeave={() => setFlyoutFor(null)}
          >
            <div className="border-b border-[var(--border-subtle)] px-2 pb-1.5 pt-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-cyan-400">
                {tLabel(categoryDef?.label ?? m.category)}
              </div>
              <div className="text-[12px] font-semibold text-[var(--text-main)]">{tLabel(m.label)}</div>
            </div>
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
                        {tLabel(sp.group ?? '')}
                      </li>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => navigate(m.id, { label: sp.label, href: sp.href, icon: ActiveIcon })}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left rtl:text-right text-[13px] transition-colors ${
                          isActive
                            ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 rtl:border-l-0 rtl:border-r-2 border-cyan-400'
                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
                        }`}
                      >
                        <ActiveIcon className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} />
                        <RunningLabel text={tLabel(sp.label)} className="flex-1" />
                      </button>
                      {sp.children && sp.children.length > 0 && (
                        <ul className="mt-0.5 mb-1 space-y-0.5 pl-2 border-l border-[var(--border-subtle)] ml-3.5">
                          {sp.children.map(child => {
                            const ChildIcon = child.icon ?? ActiveIcon;
                            const childActive = pathname === child.href;
                            return (
                              <li key={child.href}>
                                <button
                                  type="button"
                                  onClick={() => navigate(m.id, { label: child.label, href: child.href, icon: ChildIcon })}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left rtl:text-right text-[12px] transition-colors ${
                                    childActive
                                      ? 'bg-cyan-500/15 text-cyan-300 font-bold'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
                                  }`}
                                >
                                  <ChildIcon className={`h-3 w-3 flex-shrink-0 ${childActive ? 'text-cyan-400' : 'text-[var(--text-faint)]'}`} />
                                  <RunningLabel text={tLabel(child.label)} className="flex-1" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
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
  module: m, collapsed, active, isExpanded, moduleId, onTabOpen, onTabsFull, onHover, onHide, onToggleExpand,
}: {
  module: ModuleDef; collapsed: boolean; active: boolean; isExpanded?: boolean; moduleId: string;
  onTabOpen: (t: { key: string; label: string; moduleId: string; iconName: string }) => void;
  onTabsFull?: (message: string) => void;
  onHover: (el: HTMLElement) => void;
  onHide: (moduleId: string) => void; onToggleExpand?: (moduleId: string) => void;
}) {
  const { tLabel } = useLanguage();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const Icon = m.icon;
  const label = tLabel(m.label);

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
        title={collapsed ? label : undefined}
        className={`flex w-full items-center gap-2.5 rounded-xl text-left rtl:text-right transition-all ${
          collapsed ? 'justify-center py-2.5' : 'px-2.5 py-2'
        } ${
          active
            ? 'bg-cyan-500/15 text-cyan-300 font-bold border-l-2 rtl:border-l-0 rtl:border-r-2 border-cyan-400 shadow-sm shadow-cyan-500/10'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
        }`}
      >
        <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} />
        {!collapsed && <RunningLabel text={label} className="flex-1 text-[13px]" />}
        {!collapsed && m.subPages && m.subPages.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleExpand?.(m.id);
            }}
            className="p-1 hover:bg-[var(--bg-surface-hover)] rounded-md text-[var(--text-faint)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
            title={isExpanded ? tLabel('Collapse') : tLabel('Expand')}
          >
            {isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 text-cyan-400" />
              : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180 text-[var(--text-faint)]" />}
          </span>
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
            className="flex w-full items-center gap-2 px-3 py-2 text-left rtl:text-right text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]"
          >
            <EyeOff className="h-4 w-4 text-[var(--text-muted)]" />
            <span>{tLabel('Hide from menu')}</span>
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
  const { tLabel } = useLanguage();
  const pathname = usePathname() ?? '';
  const hasChildren = Boolean(page.children && page.children.length > 0);
  const isChildActive = hasChildren && (pathname.startsWith(page.href) || page.children!.some(c => pathname === c.href || pathname.startsWith(c.href + '/')));
  const [expanded, setExpanded] = useState(true);
  const Icon = page.icon ?? parentIcon;
  const label = tLabel(page.label);

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
    <div>
      <Link
        href={page.href}
        prefetch
        onClick={handleClick}
        onMouseEnter={() => prefetchHref(page.href)}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left rtl:text-right text-[12px] transition-colors ${
          active || isChildActive
            ? 'bg-cyan-500/10 text-cyan-300 font-bold'
            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
        }`}
      >
        <Icon className={`h-3 w-3 flex-shrink-0 ${active || isChildActive ? 'text-cyan-400' : 'text-[var(--text-faint)]'}`} />
        <RunningLabel text={label} className="flex-1 text-[12px]" />
        {hasChildren && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(v => !v);
            }}
            className="p-0.5 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-faint)] hover:text-[var(--text-main)]"
          >
            {expanded ? <ChevronDown className="h-3 w-3 text-cyan-400" /> : <ChevronRight className="h-3 w-3 rtl:rotate-180" />}
          </span>
        )}
      </Link>
      {hasChildren && expanded && (
        <ul className="mt-0.5 mb-1 space-y-0.5 pl-2 rtl:pl-0 rtl:pr-2 border-l rtl:border-l-0 rtl:border-r border-[var(--border-subtle)] ml-3.5 rtl:ml-0 rtl:mr-3.5">
          {page.children!.map(child => {
            const ChildIcon = child.icon ?? Icon;
            const childActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  prefetch
                  onClick={(e) => {
                    try {
                      onTabOpen({ key: child.href, label: child.label, moduleId, iconName: ChildIcon.displayName ?? 'Circle' });
                    } catch (err) {
                      e.preventDefault();
                      if (err instanceof WorkspaceTabsFullError) onTabsFull?.(err.message);
                      else throw err;
                    }
                  }}
                  onMouseEnter={() => prefetchHref(child.href)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left rtl:text-right text-[11.5px] transition-colors ${
                    childActive
                      ? 'bg-cyan-500/15 text-cyan-300 font-bold'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-main)]'
                  }`}
                >
                  <ChildIcon className={`h-3 w-3 flex-shrink-0 ${childActive ? 'text-cyan-400' : 'text-[var(--text-faint)]'}`} />
                  <span className="truncate">{tLabel(child.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const _prefetch: ((href: string) => void) | null = null;
function prefetchHref(href: string) {
  if (!_prefetch) {
    try {
      window.dispatchEvent(new CustomEvent('fleet360:prefetch', { detail: { href } }));
    } catch { /* SSR / no window */ }
    return;
  }
  _prefetch(href);
}
