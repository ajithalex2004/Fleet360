'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import PlatformSessionSlot from './PlatformSessionSlot';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { canOpenModule } from '@/lib/nav/module-visibility';
import {
  PINNED_LAUNCHERS,
  PLATFORM_DIRECTORY,
  PLATFORM_FILTER_CHIPS,
  filterPlatformModules,
  resolvePinnedLaunchers,
  type DirectoryFilterKey,
  type PlatformIconKey,
  type PlatformModuleEntry,
} from './modules-directory';
import {
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bot,
  Boxes,
  Building2,
  Bus,
  CalendarCheck,
  Car,
  CarFront,
  ChevronRight,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Leaf,
  Moon,
  Package,
  Radio,
  Receipt,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Store,
  Sun,
  Truck,
  Users,
  Wrench,
  X,
} from 'lucide-react';

const ICON_MAP: Record<PlatformIconKey, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  smart_toy: Bot,
  policy: ShieldCheck,
  local_shipping: Truck,
  directions_bus: Bus,
  school: GraduationCap,
  inventory_2: Package,
  assignment: FileText,
  car_rental: Car,
  hub: Radio,
  storefront: Store,
  emergency: ShieldAlert,
  build_circle: Wrench,
  book_online: CalendarCheck,
  smartphone: Smartphone,
  directions_car: CarFront,
  car_repair: Wrench,
  badge: Users,
  sensors: Boxes,
  verified_user: BadgeCheck,
  eco: Leaf,
  bar_chart: BarChart3,
  groups: Building2,
  receipt_long: Receipt,
  settings: Settings,
};

function ModuleIcon({
  name,
  className = 'w-[18px] h-[18px]',
}: {
  name: PlatformIconKey;
  className?: string;
}) {
  const Icon = ICON_MAP[name] ?? Radio;
  return <Icon className={className} aria-hidden={true} />;
}

export default function PlatformPage() {
  const { setLanguage, tLabel, isRTL } = useLanguage();
  const { user, tenant, permissions, isAuthenticated, isLoading } = usePermissions();
  const { resolved: resolvedTheme, setChoice: setThemeChoice } = useTheme();

  const [activeFilter, setActiveFilter] = useState<DirectoryFilterKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(PLATFORM_DIRECTORY[0].id);
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);

  const canOpen = useCallback(
    (id: string) => {
      if (!user) return true;
      const enabled = tenant?.enabledModules ?? [];
      const isStandaloneDrayage =
        user.roleCode !== 'SUPER_ADMIN' &&
        enabled.length > 0 &&
        !enabled.includes('logistics') &&
        (enabled.includes('drayage') ||
          enabled.includes('port-drayage') ||
          enabled.includes('container-drayage'));

      if (id === 'logistics' && isStandaloneDrayage) {
        return false;
      }
      if (id === 'drayage') {
        if (user.roleCode === 'SUPER_ADMIN') return true;
        if (enabled.length === 0) {
          return canOpenModule('logistics', {
            roleCode: user.roleCode,
            enabledModules: enabled,
            permissions,
          });
        }
        if (
          enabled.includes('drayage') ||
          enabled.includes('port-drayage') ||
          enabled.includes('container-drayage') ||
          enabled.includes('logistics')
        ) {
          return canOpenModule('logistics', {
            roleCode: user.roleCode,
            enabledModules: enabled,
            permissions,
          });
        }
        return false;
      }
      return canOpenModule(id, {
        roleCode: user.roleCode,
        enabledModules: tenant?.enabledModules,
        permissions,
      });
    },
    [user, tenant?.enabledModules, permissions],
  );

  // Language policy: English default unless authenticated tenant configures Arabic.
  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated && tenant?.defaultLanguage === 'ar') {
      setLanguage('ar');
    } else {
      setLanguage('en');
    }
  }, [isAuthenticated, tenant?.defaultLanguage, isLoading, setLanguage]);

  // Fetch live pending approvals badge count for signed-in users.
  useEffect(() => {
    if (!isAuthenticated) {
      setPendingApprovals(null);
      return;
    }
    let cancelled = false;
    fetch('/api/my-approvals', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const total =
          typeof data?.summary?.total === 'number'
            ? data.summary.total
            : Array.isArray(data?.approvals)
              ? data.approvals.length
              : null;
        setPendingApprovals(total);
      })
      .catch(() => {
        if (!cancelled) setPendingApprovals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tenant?.id]);

  const accessibleModules = useMemo(
    () => PLATFORM_DIRECTORY.filter((m) => canOpen(m.id)),
    [canOpen],
  );

  const filteredModules = useMemo(
    () => filterPlatformModules(accessibleModules, activeFilter, searchQuery),
    [accessibleModules, activeFilter, searchQuery],
  );

  const pinnedLaunchers = useMemo(
    () => resolvePinnedLaunchers(accessibleModules),
    [accessibleModules],
  );

  const chipCounts = useMemo(() => {
    const counts: Record<DirectoryFilterKey, number> = {
      all: accessibleModules.length,
      ai: 0,
      transport: 0,
      core: 0,
      assets: 0,
      safety: 0,
      finance: 0,
    };
    for (const m of accessibleModules) {
      counts[m.filterKey] += 1;
    }
    return counts;
  }, [accessibleModules]);

  // Resolve the active module for the sticky Inspector: always stays within accessible modules.
  const selectedModule: PlatformModuleEntry | null = useMemo(() => {
    const exactInFiltered = filteredModules.find((m) => m.id === selectedId);
    if (exactInFiltered) return exactInFiltered;
    const exactInAccessible = accessibleModules.find((m) => m.id === selectedId);
    if (exactInAccessible && filteredModules.length > 0) return exactInAccessible;
    return filteredModules[0] ?? accessibleModules[0] ?? null;
  }, [filteredModules, accessibleModules, selectedId]);

  const handleSelectModule = (id: string, scrollOnMobile = false) => {
    setSelectedId(id);
    if (scrollOnMobile && typeof window !== 'undefined' && window.innerWidth < 1024) {
      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const openPalette = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fleet360:open-command-palette'));
    }
  };

  const showAdminBtn = !user || canOpen('admin');
  const totalAccessible = accessibleModules.length;
  const searchPlaceholder = tLabel(
    `Jump to any of ${totalAccessible || PLATFORM_DIRECTORY.length} modules, e-Tokens, Salik, RFQ...`,
  );

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="platform-shell min-h-screen flex flex-col antialiased transition-colors duration-150"
    >
      {/* ── Top Sticky Header ──────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b px-4 sm:px-6 py-3"
        style={{
          backgroundColor: 'var(--pf-header-bg)',
          borderColor: 'var(--pf-outline-variant)',
        }}
      >
        <div className="max-w-7xl mx-auto flex flex-wrap lg:flex-nowrap items-center justify-between gap-3 lg:gap-4">
          {/* Brand Emblem + Tenant Pill */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/platform"
              className="w-9 h-9 rounded-[6px] flex items-center justify-center pf-font-headline text-[16px] leading-[22px] font-bold shrink-0"
              style={{
                backgroundColor: 'var(--pf-primary)',
                color: 'var(--pf-on-primary)',
              }}
              aria-label="Fleet360 Enterprise Home"
            >
              F
            </Link>
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className="pf-font-headline text-[16px] leading-[22px] font-semibold tracking-tight"
                style={{ color: 'var(--pf-on-surface)' }}
              >
                Fleet360
              </span>
              <span
                className="pf-font-mono text-[11px] leading-[14px] font-semibold tracking-[0.3px] px-2 py-1 rounded-[4px] truncate max-w-[160px]"
                style={{
                  backgroundColor: 'var(--pf-badge-bg)',
                  color: 'var(--pf-primary)',
                }}
              >
                {tenant?.name ? tenant.name.toUpperCase() : tLabel('ENTERPRISE')}
              </span>
            </div>
          </div>

          {/* Filter / Jump Search Bar */}
          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="pf-search-form order-3 lg:order-2 w-full lg:flex-1 lg:max-w-lg flex items-center rounded-[6px] px-3 py-2"
          >
            <Search
              className="w-4 h-4 shrink-0 mr-2 rtl:mr-0 rtl:ml-2"
              style={{ color: 'var(--pf-primary)' }}
              aria-hidden={true}
            />
            <input
              id="split-search"
              name="search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={tLabel(`Search and filter ${totalAccessible || 24} modules`)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent border-0 p-0 text-[14px] leading-[20px] focus:outline-none focus:ring-0"
              style={{ color: 'var(--pf-on-surface)' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={tLabel('Clear search')}
                className="p-0.5 rounded hover:opacity-80 mr-1.5 rtl:mr-0 rtl:ml-1.5"
                style={{ color: 'var(--pf-on-surface-variant)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={openPalette}
              title={tLabel('Open Universal Command Palette')}
              className="pf-font-mono text-[12px] leading-[16px] font-medium ml-2 rtl:ml-0 rtl:mr-2 px-2 py-0.5 rounded-[4px] border shrink-0 cursor-pointer"
              style={{
                backgroundColor: 'var(--pf-kbd-bg)',
                borderColor: 'var(--pf-outline-variant)',
                color: 'var(--pf-on-surface-variant)',
              }}
            >
              ⌘K
            </button>
          </form>

          {/* Right Action Cluster */}
          <div className="order-2 lg:order-3 flex items-center gap-2 shrink-0">
            {/* Desktop ThemeToggle + Mobile quick theme switch */}
            <div className="hidden xl:block w-[132px] shrink-0">
              <ThemeToggle />
            </div>
            <button
              type="button"
              onClick={() => setThemeChoice(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={resolvedTheme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
              title={resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
              className="xl:hidden pf-btn-secondary inline-flex items-center justify-center w-9 h-9 rounded-[6px]"
            >
              {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <Link
              href="/approvals"
              className="pf-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 rounded-[6px] text-[13px] leading-[18px] font-semibold tracking-[0.1px]"
            >
              <ClipboardCheck
                className="w-4 h-4 shrink-0"
                style={{ color: 'var(--pf-secondary)' }}
                aria-hidden={true}
              />
              <span className="hidden sm:inline">{tLabel('Approvals')}</span>
              {pendingApprovals !== null && pendingApprovals > 0 && (
                <span
                  className="pf-font-mono text-[12px] leading-[16px] font-medium px-1.5 rounded-[4px] tabular-nums"
                  style={{
                    backgroundColor: 'var(--pf-secondary-container)',
                    color: 'var(--pf-on-secondary-container)',
                  }}
                >
                  {pendingApprovals}
                </span>
              )}
            </Link>

            {showAdminBtn && (
              <Link
                href="/admin"
                className="pf-btn-primary inline-flex items-center gap-1.5 px-3 py-2 rounded-[6px] text-[13px] leading-[18px] font-semibold tracking-[0.1px]"
              >
                <Shield className="w-4 h-4 shrink-0" aria-hidden={true} />
                <span>{tLabel('Admin')}</span>
              </Link>
            )}

            <PlatformSessionSlot />
          </div>
        </div>
      </header>

      {/* ── Split Master-Detail Workspace ──────────────────────────── */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pinned Trio + Filter Chips + Module Index List */}
        <main className="lg:col-span-7 flex flex-col gap-4">
          {/* Pinned Quick-Launch Trio */}
          {pinnedLaunchers.length > 0 && (
            <section
              aria-label={tLabel('Pinned Quick Launchers')}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch"
            >
              {pinnedLaunchers.map((pin) => {
                const isSelected = selectedModule?.id === pin.moduleId;
                const iconBg =
                  pin.tone === 'primary'
                    ? 'var(--pf-primary)'
                    : pin.tone === 'secondary'
                      ? 'var(--pf-secondary-container)'
                      : 'var(--pf-pin-mid-icon-bg)';
                const iconFg =
                  pin.tone === 'primary'
                    ? 'var(--pf-on-primary)'
                    : pin.tone === 'secondary'
                      ? 'var(--pf-on-secondary-container)'
                      : 'var(--pf-primary)';
                const metricColor =
                  pin.tone === 'primary'
                    ? 'var(--pf-primary)'
                    : pin.tone === 'secondary'
                      ? 'var(--pf-secondary)'
                      : 'var(--pf-on-surface-variant)';

                return (
                  <button
                    key={pin.moduleId}
                    type="button"
                    data-pin-id={pin.moduleId}
                    data-active={isSelected ? 'true' : 'false'}
                    onClick={() => handleSelectModule(pin.moduleId, true)}
                    className="pf-pin-card cursor-pointer text-left rtl:text-right rounded-[8px] p-3 flex items-center gap-3"
                  >
                    <span
                      className="w-9 h-9 shrink-0 rounded-[6px] flex items-center justify-center"
                      style={{ backgroundColor: iconBg, color: iconFg }}
                    >
                      <ModuleIcon name={pin.module.icon} className="w-[18px] h-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p
                        className="text-[13px] leading-[18px] font-semibold tracking-[0.1px] truncate"
                        style={{ color: 'var(--pf-on-surface)' }}
                      >
                        {tLabel(pin.shortTitle)}
                      </p>
                      <p
                        className="pf-font-mono text-[12px] leading-[16px] font-medium tabular-nums truncate"
                        style={{ color: metricColor }}
                      >
                        {tLabel(pin.metricSummary)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </section>
          )}

          {/* Category Filter Chips */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={tLabel('Module Categories')}>
            {PLATFORM_FILTER_CHIPS.map((chip) => {
              const count = chipCounts[chip.key];
              if (chip.key !== 'all' && count === 0) return null;
              const isActive = activeFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-filter={chip.key}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => setActiveFilter(chip.key)}
                  className="pf-chip px-3 py-1 rounded-full text-[11px] leading-[14px] font-semibold tracking-[0.3px] cursor-pointer"
                >
                  {tLabel(chip.label)} ({count})
                </button>
              );
            })}
          </div>

          {/* Filterable Module Index List */}
          <div
            id="split-list"
            className="rounded-[8px] border overflow-hidden"
            style={{
              backgroundColor: 'var(--pf-card-bg)',
              borderColor: 'var(--pf-outline-variant)',
            }}
          >
            {filteredModules.length === 0 ? (
              <div data-testid="empty-state" className="empty-state py-14 px-6 text-center space-y-3">
                <div
                  className="w-11 h-11 rounded-[8px] border flex items-center justify-center mx-auto"
                  style={{
                    backgroundColor: 'var(--pf-metric-bg)',
                    borderColor: 'var(--pf-outline-variant)',
                    color: 'var(--pf-on-surface-variant)',
                  }}
                >
                  <Search className="w-5 h-5" aria-hidden={true} />
                </div>
                <h3
                  className="pf-font-headline text-[16px] leading-[22px] font-semibold"
                  style={{ color: 'var(--pf-on-surface)' }}
                >
                  {tLabel('No modules found')}
                </h3>
                <p
                  className="text-[12px] leading-[16px] max-w-sm mx-auto"
                  style={{ color: 'var(--pf-on-surface-variant)' }}
                >
                  {searchQuery
                    ? `${tLabel('No modules matched')} "${searchQuery}".`
                    : tLabel('No modules are enabled in this category for your current role.')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveFilter('all');
                  }}
                  className="pf-btn-primary inline-flex items-center px-3.5 py-2 rounded-[6px] text-[13px] leading-[18px] font-semibold cursor-pointer"
                >
                  {tLabel('Reset Filters')}
                </button>
              </div>
            ) : (
              <div>
                {filteredModules.map((m, idx) => {
                  const active = selectedModule?.id === m.id;
                  const leadMetric = m.metrics[0]?.value ?? m.status;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-module={m.id}
                      data-active={active ? 'true' : 'false'}
                      onClick={() => handleSelectModule(m.id, true)}
                      className="pf-row module-card w-full text-left rtl:text-right px-4 py-3 flex items-center justify-between gap-3 cursor-pointer"
                      style={{
                        borderTop: idx > 0 ? '1px solid var(--pf-divider)' : undefined,
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="w-9 h-9 shrink-0 rounded-[6px] flex items-center justify-center transition-colors duration-100"
                          style={{
                            backgroundColor: active ? 'var(--pf-primary)' : 'var(--pf-row-icon-idle-bg)',
                            color: active ? 'var(--pf-on-primary)' : 'var(--pf-primary)',
                          }}
                        >
                          <ModuleIcon name={m.icon} className="w-[17px] h-[17px]" />
                        </span>
                        <div className="min-w-0">
                          <p
                            className="text-[15px] leading-[20px] font-semibold truncate"
                            style={{ color: 'var(--pf-on-surface)' }}
                          >
                            {tLabel(m.name)}
                          </p>
                          <p
                            className="text-[12px] leading-[16px] truncate"
                            style={{ color: 'var(--pf-on-surface-variant)' }}
                          >
                            {tLabel(m.categoryLabel)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className="pf-font-mono text-[12px] leading-[16px] font-medium px-2 py-1 rounded-[4px] tabular-nums"
                          style={{
                            backgroundColor: active
                              ? 'var(--pf-row-pill-active-bg)'
                              : 'var(--pf-row-pill-idle-bg)',
                            color: active ? 'var(--pf-primary)' : 'var(--pf-on-surface-variant)',
                          }}
                        >
                          {tLabel(leadMetric)}
                        </span>
                        <ChevronRight
                          className="w-4 h-4 shrink-0 rtl:rotate-180"
                          style={{
                            color: active ? 'var(--pf-primary)' : 'var(--pf-on-surface-variant)',
                          }}
                          aria-hidden={true}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* Right Column: Sticky High-Contrast Live Module Inspector */}
        <aside
          ref={inspectorRef}
          id="inspector-panel"
          aria-label={tLabel('Live Module Inspector')}
          className="lg:col-span-5 lg:sticky lg:top-20 rounded-[12px] border overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'var(--pf-card-bg)',
            borderColor: 'var(--pf-outline-variant)',
          }}
        >
          {selectedModule ? (
            <>
              {/* High-Contrast Inspector Header */}
              <header
                className="p-6 flex flex-col gap-3"
                style={{
                  backgroundColor: 'var(--pf-inspector-header-bg)',
                  borderBottom: '1px solid var(--pf-inspector-header-border)',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="pf-font-mono text-[11px] leading-[14px] font-semibold tracking-[0.3px] uppercase"
                    style={{ color: 'var(--pf-inspector-header-cat)' }}
                  >
                    {tLabel(selectedModule.categoryLabel)}
                  </span>
                  <span
                    className="pf-font-mono text-[11px] leading-[14px] font-semibold tracking-[0.3px] px-2 py-1 rounded-[4px]"
                    style={{
                      backgroundColor: 'var(--pf-primary-container)',
                      color: 'var(--pf-on-primary-container)',
                    }}
                  >
                    {tLabel(selectedModule.status)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className="w-11 h-11 shrink-0 rounded-[8px] flex items-center justify-center"
                    style={{
                      backgroundColor: 'var(--pf-inspector-header-icon-bg)',
                      color: 'var(--pf-inspector-header-icon-fg)',
                    }}
                  >
                    <ModuleIcon name={selectedModule.icon} className="w-5 h-5" />
                  </span>
                  <h2
                    className="pf-font-headline text-[20px] leading-[28px] font-semibold tracking-[-0.15px]"
                    style={{ color: 'var(--pf-inspector-header-title)' }}
                  >
                    {tLabel(selectedModule.name)}
                  </h2>
                </div>

                <p
                  className="text-[12px] leading-[18px] text-pretty"
                  style={{ color: 'var(--pf-inspector-header-summary)' }}
                >
                  {tLabel(selectedModule.summary)}
                </p>
              </header>

              {/* Inspector Body */}
              <div className="p-6 flex flex-col gap-4">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {selectedModule.metrics.map((metric, idx) => (
                    <div
                      key={metric.label}
                      className="border rounded-[8px] p-3"
                      style={{
                        backgroundColor: idx === 0 ? 'var(--pf-metric-lead-bg)' : 'var(--pf-metric-bg)',
                        borderColor: idx === 0 ? 'var(--pf-metric-lead-border)' : 'var(--pf-outline-variant)',
                      }}
                    >
                      <p
                        className="text-[11px] leading-[14px] font-semibold tracking-[0.3px] uppercase truncate"
                        style={{ color: 'var(--pf-on-surface-variant)' }}
                      >
                        {tLabel(metric.label)}
                      </p>
                      <p
                        className="pf-font-headline text-[16px] leading-[22px] font-semibold tabular-nums mt-1 truncate"
                        style={{
                          color: idx === 0 ? 'var(--pf-primary)' : 'var(--pf-on-surface)',
                        }}
                      >
                        {tLabel(metric.value)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Quick Capabilities */}
                <div>
                  <p
                    className="text-[11px] leading-[14px] font-semibold tracking-[0.3px] uppercase mb-2"
                    style={{ color: 'var(--pf-on-surface-variant)' }}
                  >
                    {tLabel('Quick Capabilities')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedModule.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 rounded-[6px] border text-[11px] leading-[14px] font-semibold tracking-[0.3px]"
                        style={{
                          backgroundColor: 'var(--pf-tag-bg)',
                          borderColor: 'var(--pf-outline-variant)',
                          color: 'var(--pf-on-surface)',
                        }}
                      >
                        {tLabel(tag)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Action Footer */}
                <footer
                  className="flex flex-wrap items-center gap-2 pt-3 border-t"
                  style={{ borderColor: 'var(--pf-divider)' }}
                >
                  {selectedModule.actions[0] && (
                    <Link
                      href={selectedModule.actions[0].href}
                      className="pf-btn-primary flex-1 min-w-[160px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-[6px] text-[13px] leading-[18px] font-semibold tracking-[0.1px]"
                    >
                      <span>{tLabel(selectedModule.actions[0].label)}</span>
                      <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden={true} />
                    </Link>
                  )}
                  {selectedModule.actions.slice(1).map((action) => (
                    <Link
                      key={`${action.label}-${action.href}`}
                      href={action.href}
                      className="pf-btn-secondary inline-flex items-center justify-center px-4 py-2 rounded-[6px] text-[13px] leading-[18px] font-semibold tracking-[0.1px]"
                    >
                      <span>{tLabel(action.label)}</span>
                    </Link>
                  ))}
                </footer>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-[13px]" style={{ color: 'var(--pf-on-surface-variant)' }}>
              {tLabel('Select a module to inspect capabilities and launch.')}
            </div>
          )}
        </aside>
      </div>

      {/* Subtle Enterprise Footer */}
      <footer
        className="border-t mt-auto"
        style={{ borderColor: 'var(--pf-outline-variant)' }}
      >
        <div
          className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] leading-[16px]"
          style={{ color: 'var(--pf-on-surface-variant)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: 'var(--pf-primary)' }}
            />
            <span className="font-semibold" style={{ color: 'var(--pf-on-surface)' }}>
              Fleet360 Enterprise
            </span>
            <span>·</span>
            <span className="pf-font-mono tabular-nums">
              {totalAccessible} / {PLATFORM_DIRECTORY.length} {tLabel('Modules')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>{tLabel('Split Directory & Module Inspector')}</span>
            <span>·</span>
            <span>{PINNED_LAUNCHERS.length} {tLabel('Pinned')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
