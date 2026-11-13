/**
 * Shared page-theme primitives — single source of truth for module UI.
 *
 * This was originally /components/bus-ops/theme.tsx and is now promoted
 * to a shared component so every module can adopt the same visual language.
 * `bus-ops/theme.tsx` re-exports from here so the 12 existing bus-ops
 * pages continue to work unchanged.
 *
 * Migration guide for a module that doesn't yet use it:
 *
 *   import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
 *
 *   <PageHeader
 *     title="Maintenance"
 *     subtitle="Service requests, work orders and predictive analytics"
 *     icon={Wrench}
 *     accent="blue"
 *     actions={<button>+ New request</button>}
 *   />
 *
 *   <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 *     <KpiCard label="Open requests" value={12} icon={Inbox}    accent="amber" />
 *     <KpiCard label="In progress"   value={5}  icon={Activity} accent="violet" />
 *   </div>
 *
 *   <Panel title="Active work orders" icon={ClipboardList} accent="violet">
 *     ...table...
 *   </Panel>
 *
 *   <StatusPill status="approved" />   // colours from PILLS map
 *
 * Accents available: violet (default), cyan, emerald, amber, rose, slate, blue.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Brand-rolled accents (Staff Transportation unified gradient palette).
 */
export const ACCENTS: Record<
  string,
  { text: string; ring: string; bg: string; gradient: string; kpiGradient: string }
> = {
  /* Primary brand — Cyan to Blue (softer kpiGradient for KpiCards) */
  default: {
    text: 'text-cyan-400',
    ring: 'ring-cyan-500/40',
    bg: 'bg-cyan-500/15',
    gradient: 'from-cyan-500 to-blue-600',
    kpiGradient: 'from-sky-500/80 to-blue-600/85',
  },
  cyan: {
    text: 'text-cyan-400',
    ring: 'ring-cyan-500/40',
    bg: 'bg-cyan-500/15',
    gradient: 'from-cyan-500 to-blue-600',
    kpiGradient: 'from-sky-500/80 to-blue-600/85',
  },
  blue: {
    text: 'text-blue-400',
    ring: 'ring-blue-500/40',
    bg: 'bg-blue-500/15',
    gradient: 'from-blue-500 to-indigo-600',
    kpiGradient: 'from-blue-500/80 to-indigo-600/85',
  },
  violet: {
    text: 'text-violet-400',
    ring: 'ring-violet-500/40',
    bg: 'bg-violet-500/15',
    gradient: 'from-violet-500 to-purple-600',
    kpiGradient: 'from-violet-500/80 to-purple-600/85',
  },
  emerald: {
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/40',
    bg: 'bg-emerald-500/15',
    gradient: 'from-emerald-500 to-teal-600',
    kpiGradient: 'from-emerald-500/80 to-teal-600/85',
  },
  amber: {
    text: 'text-amber-400',
    ring: 'ring-amber-500/40',
    bg: 'bg-amber-500/15',
    gradient: 'from-amber-500 to-orange-600',
    kpiGradient: 'from-amber-500/80 to-orange-600/85',
  },
  rose: {
    text: 'text-rose-400',
    ring: 'ring-rose-500/40',
    bg: 'bg-rose-500/15',
    gradient: 'from-rose-500 to-pink-600',
    kpiGradient: 'from-rose-500/80 to-pink-600/85',
  },
  slate: {
    text: 'text-[var(--text-muted)]',
    ring: 'ring-slate-500/40',
    bg: 'bg-slate-500/15',
    gradient: 'from-slate-500 to-slate-700',
    kpiGradient: 'from-slate-500/80 to-slate-700/85',
  },
  gold: {
    text: 'text-amber-400',
    ring: 'ring-amber-500/40',
    bg: 'bg-amber-500/15',
    gradient: 'from-amber-400 to-orange-500',
    kpiGradient: 'from-amber-400/80 to-orange-500/85',
  },
};

export type PageAccent = keyof typeof ACCENTS;
export type BusOpsAccent = PageAccent;

/* ── Page header ────────────────────────────────────────────────────────── */

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: PageAccent;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, icon: Icon, accent = 'default', actions }: PageHeaderProps) {
  const { tLabel } = useLanguage();
  const a = ACCENTS[accent] ?? ACCENTS.default;
  const translatedTitle = tLabel(title);
  const translatedSubtitle = subtitle ? tLabel(subtitle) : undefined;
  return (
    <div className="flex items-start justify-between flex-wrap gap-4 pb-5 border-b border-[var(--border-subtle)]">
      <div className="flex items-start gap-3.5 min-w-0">
        {Icon && (
          <div className={`shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${a.gradient} flex items-center justify-center shadow-md shadow-blue-500/15`}>
            <Icon className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--text-main)] tracking-tight">{translatedTitle}</h1>
          {translatedSubtitle && <p className="text-xs text-[var(--text-muted)] mt-1 max-w-3xl leading-relaxed">{translatedSubtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── KPI card ───────────────────────────────────────────────────────────── */

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  accent?: PageAccent;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'default',
  href,
  onClick,
  active = false,
  className = '',
}: KpiCardProps) {
  const { tLabel } = useLanguage();
  const a = ACCENTS[accent] ?? ACCENTS.default;
  const translatedLabel = tLabel(label);
  const translatedSub = sub ? tLabel(sub) : undefined;
  const interactive = Boolean(href || onClick);
  const baseClass = `block w-full text-start relative overflow-hidden rounded-2xl bg-gradient-to-br ${a.kpiGradient} border border-white/15 p-4 shadow-sm min-h-[88px] transition-all duration-150 ${
    interactive ? 'cursor-pointer hover:brightness-105 hover:shadow-md active:scale-[0.99]' : ''
  } ${active ? 'ring-2 ring-white/90 shadow-md' : ''} ${className}`.trim();

  const inner = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-2xl font-bold text-white tabular-nums tracking-tight leading-tight truncate">
          {value}
        </p>
        <p className="mt-1 text-xs font-medium text-white/85 truncate">{translatedLabel}</p>
        {translatedSub && (
          <p className="mt-0.5 text-[11px] font-medium text-white/70 truncate">{translatedSub}</p>
        )}
      </div>
      {Icon && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-white/90" strokeWidth={2} />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

export function StatGrid({
  children,
  cols = 6,
  className = '',
}: {
  children: React.ReactNode;
  cols?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const colClass =
    cols === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : cols === 3
      ? 'grid-cols-2 lg:grid-cols-3'
      : cols === 4
      ? 'grid-cols-2 lg:grid-cols-4'
      : cols === 5
      ? 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
      : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-6';
  return <div className={`grid ${colClass} gap-3 ${className}`.trim()}>{children}</div>;
}

/* ── Section panel ──────────────────────────────────────────────────────── */

interface PanelProps {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: PageAccent;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, icon: Icon, accent = 'default', actions, children, className = '' }: PanelProps) {
  const { tLabel } = useLanguage();
  const a = ACCENTS[accent] ?? ACCENTS.default;
  const translatedTitle = title ? tLabel(title) : undefined;
  const translatedSubtitle = subtitle ? tLabel(subtitle) : undefined;
  return (
    <section className={`rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm overflow-hidden ${className}`}>
      {(translatedTitle || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]">
          <div className={`flex ${translatedSubtitle ? 'items-start' : 'items-center'} gap-3 min-w-0 flex-1`}>
            {Icon && (
              <div className={`shrink-0 w-8 h-8 rounded-lg ${a.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${a.text}`} strokeWidth={2} />
              </div>
            )}
            <div className="min-w-0">
              {translatedTitle && <h3 className="text-sm font-semibold text-[var(--text-main)]">{translatedTitle}</h3>}
              {translatedSubtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{translatedSubtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ── Status pill ────────────────────────────────────────────────────────── */

const PILLS: Record<string, string> = {
  active:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  completed: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/40',
  scheduled: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  departed:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  in_transit:'bg-amber-500/20 text-amber-300 border-amber-500/40',
  cancelled: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  pending:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  approved:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  rejected:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  ok:        'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  warning:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  danger:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
  info:      'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  fcl_reassign: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  mt_reassign: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  mt_reassign_to_yard: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  fcl_reassign_to_yard: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  fcl_reassign_to_ramp: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  mt_reassign_to_ramp: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  re_assigned: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
};

export function StatusPill({ status, label }: { status?: string; label?: string }) {
  const { tLabel } = useLanguage();
  const rawStatus = status ?? '—';
  const key = rawStatus.toLowerCase().replace(/[\s-]/g, '_');
  const cls = PILLS[key] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border-[var(--border-strong)]';
  const isMixedCaseReassign = /reassign\s+to\s+(?:yard|ramp)/i.test(rawStatus);
  const displayLabel = label ? tLabel(label) : isMixedCaseReassign ? rawStatus : tLabel(rawStatus.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${cls}`}>
      {displayLabel}
    </span>
  );
}

/* ── Tab strip ──────────────────────────────────────────────────────────── */

export interface TabDef {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: string;
}

interface TabStripProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  accent?: PageAccent;
  label: string;
}

export function TabStrip({ tabs, activeId, onChange, accent = 'default', label }: TabStripProps) {
  const { tLabel } = useLanguage();
  const a = ACCENTS[accent] ?? ACCENTS.default;

  const move = (dir: 1 | -1 | 'first' | 'last') => {
    const i = tabs.findIndex(t => t.id === activeId);
    if (i < 0) return;
    const next =
      dir === 'first' ? 0
      : dir === 'last' ? tabs.length - 1
      : (i + dir + tabs.length) % tabs.length;
    onChange(tabs[next].id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); move(1); break;
      case 'ArrowLeft':  e.preventDefault(); move(-1); break;
      case 'Home':       e.preventDefault(); move('first'); break;
      case 'End':        e.preventDefault(); move('last'); break;
      default: break;
    }
  };

  return (
    <div
      role="tablist"
      aria-label={tLabel(label)}
      onKeyDown={onKeyDown}
      className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] -mb-px overflow-x-auto pb-1"
    >
      {tabs.map(t => {
        const isActive = t.id === activeId;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={[
              'group inline-flex items-center gap-2 px-4 py-2 text-xs font-bold',
              'rounded-xl border transition-all',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
              isActive
                ? `bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 border-cyan-400 text-cyan-500 shadow-md`
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]',
            ].join(' ')}
          >
            {Icon && <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} strokeWidth={2} />}
            {tLabel(t.label)}
            {t.badge && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
