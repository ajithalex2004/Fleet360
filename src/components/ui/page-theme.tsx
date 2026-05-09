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
import type { LucideIcon } from 'lucide-react';

/**
 * Brand-rolled accents (royal-maritime palette).
 * The original `violet` and `cyan` accents are kept as deprecated
 * aliases that now resolve to the brand `gold` and `blue` so all
 * existing module pages adopt the new palette without any caller
 * changes. Status colours (emerald / amber / rose) are preserved
 * because they carry semantic meaning.
 */
const ACCENTS: Record<string, { text: string; ring: string; bg: string; gradient: string }> = {
  /* Primary brand — champagne gold on navy. */
  default: { text: 'text-[#E8C547]',   ring: 'ring-[#D4AF37]/40',  bg: 'bg-[#D4AF37]/10',  gradient: 'from-[#D4AF37] to-[#B8860B]' },
  gold:    { text: 'text-[#E8C547]',   ring: 'ring-[#D4AF37]/40',  bg: 'bg-[#D4AF37]/10',  gradient: 'from-[#D4AF37] to-[#B8860B]' },
  /* `violet` is now an alias for gold — keeps existing callers working. */
  violet:  { text: 'text-[#E8C547]',   ring: 'ring-[#D4AF37]/40',  bg: 'bg-[#D4AF37]/10',  gradient: 'from-[#D4AF37] to-[#B8860B]' },

  /* Partner brand — royal blue. */
  blue:    { text: 'text-blue-300',    ring: 'ring-blue-500/40',   bg: 'bg-blue-500/10',   gradient: 'from-blue-600 to-indigo-700' },
  /* `cyan` is now an alias for blue. */
  cyan:    { text: 'text-blue-300',    ring: 'ring-blue-500/40',   bg: 'bg-blue-500/10',   gradient: 'from-blue-600 to-indigo-700' },

  /* Semantic — preserved. */
  emerald: { text: 'text-emerald-300', ring: 'ring-emerald-500/40',bg: 'bg-emerald-500/10',gradient: 'from-emerald-600 to-teal-600' },
  amber:   { text: 'text-amber-300',   ring: 'ring-amber-500/40',  bg: 'bg-amber-500/10',  gradient: 'from-amber-600 to-orange-600' },
  rose:    { text: 'text-rose-300',    ring: 'ring-rose-500/40',   bg: 'bg-rose-500/10',   gradient: 'from-rose-600 to-pink-600' },
  slate:   { text: 'text-slate-300',   ring: 'ring-slate-500/40',  bg: 'bg-slate-500/10',  gradient: 'from-slate-600 to-slate-700' },
};

export type PageAccent = keyof typeof ACCENTS;

/** Backwards-compat alias used by existing bus-ops/theme.tsx imports. */
export type BusOpsAccent = PageAccent;

/* ── Page header ────────────────────────────────────────────────────────── */

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: PageAccent;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, icon: Icon, accent = 'violet', actions }: PageHeaderProps) {
  const a = ACCENTS[accent] ?? ACCENTS.default;
  return (
    <div className="flex items-start justify-between flex-wrap gap-4 pb-4 border-b border-white/5">
      <div className="flex items-start gap-4 min-w-0">
        {Icon && (
          <div className={`shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br ${a.gradient} flex items-center justify-center shadow-lg`}>
            <Icon className="w-6 h-6 text-white" strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-white tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-3xl">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
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
}

export function KpiCard({ label, value, sub, icon: Icon, accent = 'default' }: KpiCardProps) {
  const a = ACCENTS[accent] ?? ACCENTS.default;
  return (
    <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-4 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</span>
        {Icon && (
          <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center`}>
            <Icon className={`w-3.5 h-3.5 ${a.text}`} strokeWidth={2} />
          </div>
        )}
      </div>
      <div className={`text-3xl font-bold ${a.text}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
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

export function Panel({ title, subtitle, icon: Icon, accent = 'violet', actions, children, className = '' }: PanelProps) {
  const a = ACCENTS[accent] ?? ACCENTS.default;
  return (
    <section className={`rounded-2xl bg-slate-900/60 border border-white/10 ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-white/5">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <div className={`shrink-0 w-9 h-9 rounded-xl ${a.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${a.text}`} strokeWidth={2} />
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
              {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ── Status pill ────────────────────────────────────────────────────────── */

const PILLS: Record<string, string> = {
  active:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  completed: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  scheduled: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  departed:  'bg-amber-500/20 text-amber-300 border-amber-500/40',
  in_transit:'bg-amber-500/20 text-amber-300 border-amber-500/40',
  cancelled: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  pending:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  approved:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  rejected:  'bg-rose-500/20 text-rose-300 border-rose-500/40',
  ok:        'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  warning:   'bg-amber-500/20 text-amber-300 border-amber-500/40',
  danger:    'bg-rose-500/20 text-rose-300 border-rose-500/40',
  info:      'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
};

export function StatusPill({ status, label }: { status?: string; label?: string }) {
  const key = (status ?? '').toLowerCase().replace(/[\s-]/g, '_');
  const cls = PILLS[key] ?? 'bg-slate-700 text-slate-300 border-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {label ?? (status ?? '—').toUpperCase()}
    </span>
  );
}
