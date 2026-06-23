'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

const ACCENTS: Record<string, { text: string; ring: string; bg: string; gradient: string; soft: string }> = {
  default: { text: 'text-[#E8C547]', ring: 'ring-[#D4AF37]/40', bg: 'bg-[#D4AF37]/12', gradient: 'from-[#D4AF37] to-[#B8860B]', soft: 'from-[#D4AF37]/18 via-[#E8C547]/10 to-transparent' },
  gold: { text: 'text-[#E8C547]', ring: 'ring-[#D4AF37]/40', bg: 'bg-[#D4AF37]/12', gradient: 'from-[#D4AF37] to-[#B8860B]', soft: 'from-[#D4AF37]/18 via-[#E8C547]/10 to-transparent' },
  violet: { text: 'text-[#E8C547]', ring: 'ring-[#D4AF37]/40', bg: 'bg-[#D4AF37]/12', gradient: 'from-[#D4AF37] to-[#B8860B]', soft: 'from-[#D4AF37]/18 via-[#E8C547]/10 to-transparent' },
  blue: { text: 'text-blue-800', ring: 'ring-blue-300', bg: 'bg-blue-100', gradient: 'from-blue-600 to-indigo-700', soft: 'from-blue-500/18 via-indigo-500/12 to-transparent' },
  cyan: { text: 'text-cyan-800', ring: 'ring-cyan-300', bg: 'bg-cyan-100', gradient: 'from-blue-600 to-indigo-700', soft: 'from-blue-500/18 via-indigo-500/12 to-transparent' },
  emerald: { text: 'text-emerald-800', ring: 'ring-emerald-300', bg: 'bg-emerald-100', gradient: 'from-emerald-600 to-teal-600', soft: 'from-emerald-500/18 via-teal-500/10 to-transparent' },
  amber: { text: 'text-amber-800', ring: 'ring-amber-300', bg: 'bg-amber-100', gradient: 'from-amber-600 to-orange-600', soft: 'from-amber-500/18 via-orange-500/10 to-transparent' },
  rose: { text: 'text-rose-800', ring: 'ring-rose-300', bg: 'bg-rose-100', gradient: 'from-rose-600 to-pink-600', soft: 'from-rose-500/18 via-pink-500/10 to-transparent' },
  slate: { text: 'text-slate-700', ring: 'ring-slate-300', bg: 'bg-slate-100', gradient: 'from-slate-600 to-slate-700', soft: 'from-slate-500/14 via-slate-400/8 to-transparent' },
};

export type PageAccent = keyof typeof ACCENTS;
export type BusOpsAccent = PageAccent;

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
    <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/6 pb-5">
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <div className={`interactive-surface relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[1.35rem] bg-gradient-to-br ${a.gradient}`}>
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.soft}`} />
            <Icon className="relative h-6 w-6 text-white" strokeWidth={1.9} />
          </div>
        )}
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-[clamp(1rem,0.85rem+0.5vw,1.525rem)] font-bold tracking-[0.01em] text-[color:var(--text-primary)]">
            {title}
          </h1>
          {subtitle && (
            <p className="max-w-4xl text-[clamp(0.95rem,0.9rem+0.15vw,1.08rem)] font-medium leading-7 text-[color:var(--text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  accent?: PageAccent;
}

interface KpiGridProps {
  children: React.ReactNode;
  className?: string;
}

export const SMART_KPI_CARD_WIDTH = 180;
export const SMART_KPI_CARD_HEIGHT = 120;
export const SMART_KPI_CARD_GAP = 20;

export function KpiGrid({ children, className = '' }: KpiGridProps) {
  return (
    <div
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(${SMART_KPI_CARD_WIDTH}px, ${SMART_KPI_CARD_WIDTH}px))`,
        gap: `${SMART_KPI_CARD_GAP}px`,
      }}
      className={`grid justify-start ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub, icon: Icon, accent = 'default' }: KpiCardProps) {
  const a = ACCENTS[accent] ?? ACCENTS.default;
  return (
    <div
      style={{ width: SMART_KPI_CARD_WIDTH, maxWidth: SMART_KPI_CARD_WIDTH, height: SMART_KPI_CARD_HEIGHT }}
      className={`interactive-surface group relative min-w-0 justify-self-start overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${a.gradient} p-4 text-white`}
    >
      <div className="pointer-events-none absolute -right-5 -top-6 h-20 w-20 rounded-full bg-white/14 blur-[1px]" />
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.soft} opacity-90`} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04)_42%,rgba(15,23,42,0.10)_100%)]" />
      <div className="relative flex items-start justify-between gap-3">
        <span className="pr-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">{label}</span>
        {Icon && (
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/16 shadow-inner shadow-white/10 backdrop-blur-sm transition-transform duration-200 group-hover:scale-[1.04]">
            <Icon className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
        )}
      </div>
      <div className="relative mt-5">
        <div className="text-[2rem] font-bold leading-none tracking-tight text-white">{value}</div>
        {sub && <div className="mt-2 text-xs font-medium text-white/76">{sub}</div>}
      </div>
    </div>
  );
}

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
    <section className={`interactive-surface overflow-hidden rounded-[1.5rem] bg-[color:var(--app-card)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-white/6 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${a.bg} ring-1 ${a.ring}`}>
                <Icon className={`h-4.5 w-4.5 ${a.text}`} strokeWidth={2} />
              </div>
            )}
            <div className="min-w-0">
              {title && <h3 className="text-base font-semibold tracking-[0.01em] text-[color:var(--text-primary)]">{title}</h3>}
              {subtitle && <p className="mt-1 text-sm leading-6 text-[color:var(--text-secondary)]">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const PILLS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  completed: 'bg-slate-100 text-slate-700 border-slate-300',
  scheduled: 'bg-blue-100 text-blue-800 border-blue-300',
  departed: 'bg-amber-100 text-amber-800 border-amber-300',
  in_transit: 'bg-amber-100 text-amber-800 border-amber-300',
  cancelled: 'bg-rose-100 text-rose-800 border-rose-300',
  pending: 'bg-amber-100 text-amber-800 border-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 border-rose-300',
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  warning: 'bg-amber-100 text-amber-800 border-amber-300',
  danger: 'bg-rose-100 text-rose-800 border-rose-300',
  info: 'bg-cyan-100 text-cyan-800 border-cyan-300',
};

export function StatusPill({ status, label }: { status?: string; label?: string }) {
  const key = (status ?? '').toLowerCase().replace(/[\s-]/g, '_');
  const cls = PILLS[key] ?? 'bg-slate-700 text-slate-300 border-slate-600';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${cls}`}>
      {label ?? (status ?? '-').toUpperCase()}
    </span>
  );
}
