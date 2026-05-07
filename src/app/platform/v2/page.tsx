'use client';

/**
 * /platform/v2 — Command Center home page (Direction 1).
 *
 * Architecture:
 *  - Top: today's pulse (2 large glass cards: revenue + utilisation sparkline)
 *  - Middle: 3 columns — Needs attention · In progress · Quick actions
 *  - Bottom: compact module dock (icons + label, scrollable on mobile)
 *
 * Reuses the existing /api/platform/kpis endpoint — no new backend.
 * Built alongside the original /platform — that page is unchanged.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, Settings, ShieldCheck, ClipboardCheck, RefreshCw, Sparkles,
  Bot, Wrench, FileText, Car, Bus, School, Truck, Siren, CarFront, UserCog,
  Building2, Smartphone, Banknote, Scale, AppWindow, BarChart3, Radio,
  Leaf, Package, AlertTriangle, Activity, CheckCircle2, ArrowUpRight,
  Plus, ListChecks, ChevronRight, type LucideIcon,
} from 'lucide-react';
import TenantSessionBar from '@/components/TenantSessionBar';

// ── KPI shape (matches /api/platform/kpis) ──────────────────────────────────
interface PlatformKPIs {
  ts: string;
  fleet:          { total: number; available: number; inMaintenance: number; dispatched: number; utilisationRate: number };
  drivers:        { total: number; active: number };
  logistics:      { activeTrips: number; todayBookings: number; deliveredToday: number; pendingBookings: number };
  rac:            { activeAgreements: number; pendingReturns: number; availableFleet: number; openDamageClaims: number };
  staffTransport: { todayTrips: number; inTransit: number; activeRoutes: number; passengersThisMonth: number };
  schoolBus:      { todayTrips: number; students: number; activeRoutes: number };
  incidents:      { open: number; escalated: number; critical: number };
  ambulance:      { available: number; activeCalls: number };
  finance:        { unpaidInvoices: number; overdueInvoices: number; revenue30d: number };
}

// ── Module dock (Lucide icons only) ─────────────────────────────────────────
const MODULES: { id: string; label: string; href: string; icon: LucideIcon; tone: string }[] = [
  { id: 'agents',         label: 'AI Agents',     href: '/agents',         icon: Bot,           tone: 'violet' },
  { id: 'fleet',          label: 'Fleet',         href: '/fleet',          icon: CarFront,      tone: 'orange' },
  { id: 'maintenance',    label: 'Maintenance',   href: '/maintenance',    icon: Wrench,        tone: 'blue' },
  { id: 'leasing',        label: 'Leasing',       href: '/leasing',        icon: FileText,      tone: 'violet' },
  { id: 'rental',         label: 'Rent-a-Car',    href: '/rental',         icon: Car,           tone: 'emerald' },
  { id: 'bus-ops',        label: 'Staff Bus',     href: '/bus-ops',        icon: Bus,           tone: 'purple' },
  { id: 'school-bus',     label: 'School Bus',    href: '/school-bus',     icon: School,        tone: 'amber' },
  { id: 'logistics',      label: 'Logistics',     href: '/logistics',      icon: Truck,         tone: 'amber' },
  { id: 'incidents',      label: 'Incidents',     href: '/incidents',      icon: Siren,         tone: 'rose' },
  { id: 'driver-mgmt',    label: 'Drivers',       href: '/driver-mgmt',    icon: UserCog,       tone: 'cyan' },
  { id: 'customer-mgmt',  label: 'Customers',     href: '/customer-mgmt',  icon: Building2,     tone: 'cyan' },
  { id: 'booking-portal', label: 'Bookings',      href: '/booking-portal', icon: Smartphone,    tone: 'indigo' },
  { id: 'dispatch',       label: 'Dispatch',      href: '/dispatch',       icon: Radio,         tone: 'blue' },
  { id: 'finance',        label: 'Finance',       href: '/finance',        icon: Banknote,      tone: 'emerald' },
  { id: 'compliance',     label: 'Compliance',    href: '/compliance',     icon: Scale,         tone: 'rose' },
  { id: 'mobile-apps',    label: 'Mobile Apps',   href: '/mobile-apps',    icon: AppWindow,     tone: 'pink' },
  { id: 'reports',        label: 'Reports',       href: '/reports',        icon: BarChart3,     tone: 'fuchsia' },
  { id: 'sustainability', label: 'Sustainability',href: '/sustainability', icon: Leaf,          tone: 'emerald' },
  { id: 'assets',         label: 'Assets',        href: '/assets',         icon: Package,       tone: 'teal' },
];

const TONE_CHIP: Record<string, string> = {
  violet:  'text-violet-300  group-hover:text-violet-200  bg-violet-500/10',
  orange:  'text-orange-300  group-hover:text-orange-200  bg-orange-500/10',
  blue:    'text-blue-300    group-hover:text-blue-200    bg-blue-500/10',
  emerald: 'text-emerald-300 group-hover:text-emerald-200 bg-emerald-500/10',
  purple:  'text-purple-300  group-hover:text-purple-200  bg-purple-500/10',
  amber:   'text-amber-300   group-hover:text-amber-200   bg-amber-500/10',
  rose:    'text-rose-300    group-hover:text-rose-200    bg-rose-500/10',
  cyan:    'text-cyan-300    group-hover:text-cyan-200    bg-cyan-500/10',
  indigo:  'text-indigo-300  group-hover:text-indigo-200  bg-indigo-500/10',
  pink:    'text-pink-300    group-hover:text-pink-200    bg-pink-500/10',
  fuchsia: 'text-fuchsia-300 group-hover:text-fuchsia-200 bg-fuchsia-500/10',
  teal:    'text-teal-300    group-hover:text-teal-200    bg-teal-500/10',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function PlatformV2() {
  const [kpis, setKpis] = useState<PlatformKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastTs, setLastTs] = useState<Date | null>(null);
  const [search, setSearch] = useState('');

  const loadKpis = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/platform/kpis', { cache: 'no-store' });
      if (r.ok) {
        const data: PlatformKPIs = await r.json();
        setKpis(data);
        setLastTs(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKpis();
    const i = setInterval(() => { void loadKpis(); }, 60_000);
    return () => clearInterval(i);
  }, [loadKpis]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const attention = useMemo(() => buildAttention(kpis), [kpis]);
  const inProgress = useMemo(() => buildInProgress(kpis), [kpis]);
  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter(m => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [search]);

  return (
    <div className="relative min-h-screen bg-[#06070d] text-white overflow-hidden">
      {/* ── Animated gradient mesh background ───────────────────────────── */}
      <BackgroundMesh />

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-black/30 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
          <Link href="/platform/v2" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_24px_-4px_rgba(99,102,241,0.5)]">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold tracking-tight">XL <span className="text-blue-400">AI</span></div>
              <div className="text-[10px] text-slate-500 -mt-1">Smart Mobility</div>
            </div>
          </Link>

          <div className="flex-1 max-w-md mx-auto">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search modules…"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl pl-10 pr-12 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-400/50 focus:bg-white/[0.06] transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-white/10 rounded px-1.5 py-0.5 bg-white/[0.03]">⌘K</kbd>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/approvals" className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors">
              <ClipboardCheck className="w-3.5 h-3.5" /> Approvals
            </Link>
            <Link href="/admin" className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors">
              <Settings className="w-3.5 h-3.5" /> Admin
            </Link>
            <TenantSessionBar />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* ── Status pill + refresh ─────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] font-medium text-emerald-300">All systems operational</span>
          </div>
          <button onClick={loadKpis}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition-colors px-2.5 py-1 rounded-md hover:bg-white/[0.04]">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {lastTs ? lastTs.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }) : 'Loading…'}
          </button>
        </div>

        {/* ── Today's pulse — 2 hero stats ──────────────────────────── */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PulseCard
            label="Revenue · last 30 days"
            value={kpis ? `AED ${formatCompact(kpis.finance.revenue30d)}` : '—'}
            sub={kpis ? `${kpis.finance.unpaidInvoices} unpaid · ${kpis.finance.overdueInvoices} overdue` : 'Loading…'}
            tone="emerald"
            icon={Banknote}
            href="/finance"
            spark={kpis ? buildPulseSpark(kpis.finance.revenue30d) : undefined}
          />
          <PulseCard
            label="Fleet utilisation"
            value={kpis ? `${kpis.fleet.utilisationRate}%` : '—'}
            sub={kpis ? `${kpis.fleet.dispatched}/${kpis.fleet.total} dispatched · ${kpis.fleet.available} available` : 'Loading…'}
            tone={kpis ? (kpis.fleet.utilisationRate >= 70 ? 'emerald' : kpis.fleet.utilisationRate >= 40 ? 'amber' : 'rose') : 'blue'}
            icon={Activity}
            href="/fleet"
            spark={kpis ? buildPulseSpark(kpis.fleet.utilisationRate, true) : undefined}
          />
        </section>

        {/* ── 3-column decision panel ───────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Needs attention */}
          <GlassPanel title="Needs attention" icon={AlertTriangle} accent="rose" count={attention.length}>
            {attention.length === 0 ? (
              <EmptyState icon={CheckCircle2} text="Nothing on fire." />
            ) : (
              <ul className="space-y-2">
                {attention.map(a => (
                  <li key={a.label}>
                    <Link href={a.href}
                      className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all">
                      <div className={`w-9 h-9 rounded-lg ${TONE_BG[a.tone]} flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
                        <a.icon className={`w-4 h-4 ${TONE_FG[a.tone]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{a.label}</div>
                        <div className="text-[11px] text-slate-500 truncate">{a.detail}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          {/* In progress */}
          <GlassPanel title="In progress" icon={Activity} accent="blue" count={inProgress.reduce((s, x) => s + x.value, 0)}>
            <div className="grid grid-cols-2 gap-2">
              {inProgress.map(p => (
                <Link key={p.label} href={p.href}
                  className="group p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <p.icon className={`w-3.5 h-3.5 ${TONE_FG[p.tone]}`} />
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{p.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">{p.value}</div>
                  <div className="text-[11px] text-slate-500 truncate">{p.sub}</div>
                </Link>
              ))}
            </div>
          </GlassPanel>

          {/* Quick actions */}
          <GlassPanel title="Quick actions" icon={Sparkles} accent="violet">
            <div className="space-y-2">
              {QUICK_ACTIONS.map(q => (
                <Link key={q.label} href={q.href}
                  className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/[0.08] transition-all">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                    <q.icon className="w-4 h-4 text-violet-300" />
                  </div>
                  <span className="flex-1 text-sm font-medium text-white">{q.label}</span>
                  <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                </Link>
              ))}
            </div>
          </GlassPanel>
        </section>

        {/* ── Module dock ───────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Modules · {filteredModules.length}{search ? ` of ${MODULES.length}` : ''}
            </h2>
            {search && (
              <button onClick={() => setSearch('')} className="text-[11px] text-slate-500 hover:text-white">
                Clear
              </button>
            )}
          </div>

          <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-xl p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {filteredModules.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-6">No modules match &ldquo;{search}&rdquo;.</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
                {filteredModules.map(m => (
                  <ModuleTile key={m.id} {...m} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Footer link back to old page */}
        <div className="text-center text-[11px] text-slate-600 pt-4">
          <Link href="/platform" className="hover:text-slate-400 transition-colors">
            ← Back to classic home
          </Link>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function BackgroundMesh() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[120px]" />
      <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
      <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-emerald-600/8 blur-[140px]" />
      {/* Subtle noise/grain */}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence baseFrequency=%220.9%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>")' }}
      />
    </div>
  );
}

interface PulseCardProps {
  label: string; value: string; sub: string; tone: 'emerald' | 'amber' | 'rose' | 'blue';
  icon: LucideIcon; href: string; spark?: number[];
}
function PulseCard({ label, value, sub, tone, icon: Icon, href, spark }: PulseCardProps) {
  const accent = TONE_FG[tone];
  return (
    <Link href={href}
      className="group relative overflow-hidden rounded-3xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl p-6 hover:border-white/[0.14] hover:bg-white/[0.04] transition-all
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_48px_-12px_rgba(0,0,0,0.4)]">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl ${TONE_BG[tone]} flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]`}>
          <Icon className={`w-5 h-5 ${accent}`} />
        </div>
        <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
      </div>
      <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium mb-1.5">{label}</div>
      <div className="text-4xl font-black text-white tabular-nums tracking-tight mb-1.5"
           style={{ textShadow: '0 1px 0 rgba(255,255,255,0.04), 0 0 24px rgba(255,255,255,0.04)' }}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{sub}</div>

      {spark && spark.length > 0 && (
        <div className="mt-4 h-10">
          <Sparkline values={spark} accent={accent} />
        </div>
      )}
    </Link>
  );
}

function Sparkline({ values, accent }: { values: number[]; accent: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 32;
  const step = w / (values.length - 1);
  const path = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  // colorVar mapping from text-xxx-300 → fill stroke
  const stroke = STROKE_FOR[accent] ?? 'currentColor';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${accent.replace(/\s/g, '-')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.4" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={`url(#grad-${accent.replace(/\s/g, '-')})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlassPanel({ title, icon: Icon, accent, count, children }: {
  title: string; icon: LucideIcon; accent: 'rose' | 'blue' | 'violet'; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-white/[0.02] border border-white/[0.06] backdrop-blur-xl p-5
                    shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-12px_rgba(0,0,0,0.4)]">
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-4 h-4 ${TONE_FG[accent]}`} />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${TONE_BG[accent]} ${TONE_FG[accent]}`}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="text-center py-6">
      <Icon className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
      <div className="text-xs text-slate-500">{text}</div>
    </div>
  );
}

function ModuleTile({ label, href, icon: Icon, tone }: { label: string; href: string; icon: LucideIcon; tone: string }) {
  return (
    <Link href={href}
      className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-transparent hover:border-white/[0.10] transition-all
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${TONE_CHIP[tone] ?? 'bg-white/[0.04] text-slate-300'}`}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-[10px] text-slate-400 group-hover:text-white text-center leading-tight font-medium">{label}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TONE_BG: Record<string, string> = {
  rose:    'bg-rose-500/10',
  amber:   'bg-amber-500/10',
  emerald: 'bg-emerald-500/10',
  blue:    'bg-blue-500/10',
  violet:  'bg-violet-500/10',
};
const TONE_FG: Record<string, string> = {
  rose:    'text-rose-300',
  amber:   'text-amber-300',
  emerald: 'text-emerald-300',
  blue:    'text-blue-300',
  violet:  'text-violet-300',
};
const STROKE_FOR: Record<string, string> = {
  'text-emerald-300': '#6ee7b7',
  'text-amber-300':   '#fcd34d',
  'text-rose-300':    '#fda4af',
  'text-blue-300':    '#93c5fd',
  'text-violet-300':  '#c4b5fd',
};

interface AttentionItem { label: string; detail: string; icon: LucideIcon; href: string; tone: string; }
function buildAttention(k: PlatformKPIs | null): AttentionItem[] {
  if (!k) return [];
  const out: AttentionItem[] = [];
  if (k.incidents.escalated > 0) out.push({
    label: `${k.incidents.escalated} escalated incident${k.incidents.escalated === 1 ? '' : 's'}`,
    detail: 'Critical priority — review now',
    icon: Siren, href: '/incidents', tone: 'rose',
  });
  if (k.incidents.critical > 0 && k.incidents.critical !== k.incidents.escalated) out.push({
    label: `${k.incidents.critical} critical incident${k.incidents.critical === 1 ? '' : 's'}`,
    detail: 'High severity open',
    icon: AlertTriangle, href: '/incidents', tone: 'rose',
  });
  if (k.rac.pendingReturns > 0) out.push({
    label: `${k.rac.pendingReturns} return${k.rac.pendingReturns === 1 ? '' : 's'} overdue`,
    detail: 'Rent-a-Car · contact customer',
    icon: Car, href: '/rental', tone: 'amber',
  });
  if (k.finance.overdueInvoices > 0) out.push({
    label: `${k.finance.overdueInvoices} overdue invoice${k.finance.overdueInvoices === 1 ? '' : 's'}`,
    detail: 'Finance · trigger collections',
    icon: Banknote, href: '/finance', tone: 'amber',
  });
  if (k.rac.openDamageClaims > 0) out.push({
    label: `${k.rac.openDamageClaims} open damage claim${k.rac.openDamageClaims === 1 ? '' : 's'}`,
    detail: 'Claims pending assessment',
    icon: AlertTriangle, href: '/rental', tone: 'amber',
  });
  if (k.fleet.inMaintenance > 0) out.push({
    label: `${k.fleet.inMaintenance} vehicle${k.fleet.inMaintenance === 1 ? '' : 's'} in maintenance`,
    detail: 'Out of service',
    icon: Wrench, href: '/maintenance', tone: 'blue',
  });
  if (k.logistics.pendingBookings > 5) out.push({
    label: `${k.logistics.pendingBookings} pending bookings`,
    detail: 'Logistics queue building up',
    icon: Truck, href: '/logistics', tone: 'amber',
  });
  return out.slice(0, 5);
}

interface ProgressItem { label: string; value: number; sub: string; icon: LucideIcon; href: string; tone: string; }
function buildInProgress(k: PlatformKPIs | null): ProgressItem[] {
  if (!k) return [];
  return [
    { label: 'Logistics trips',  value: k.logistics.activeTrips,        sub: `${k.logistics.deliveredToday} delivered today`, icon: Truck, href: '/logistics', tone: 'amber'   },
    { label: 'Staff in transit', value: k.staffTransport.inTransit,     sub: `${k.staffTransport.activeRoutes} active routes`, icon: Bus,   href: '/bus-ops',   tone: 'violet'  },
    { label: 'RAC active',        value: k.rac.activeAgreements,         sub: `${k.rac.availableFleet} cars available`,         icon: Car,   href: '/rental',    tone: 'emerald' },
    { label: 'Active drivers',    value: k.drivers.active,               sub: `of ${k.drivers.total} total`,                    icon: UserCog, href: '/driver-mgmt', tone: 'blue'   },
  ];
}

const QUICK_ACTIONS = [
  { label: 'Create booking',     href: '/booking-portal',       icon: Plus  },
  { label: 'Add vehicle',        href: '/fleet',                 icon: CarFront },
  { label: 'Add driver',         href: '/driver-mgmt',           icon: UserCog },
  { label: 'Open dispatch board',href: '/dispatch',              icon: Radio },
  { label: 'Pending approvals',  href: '/approvals',             icon: ListChecks },
  { label: 'Compliance & SSO',   href: '/admin',                 icon: ShieldCheck },
];

function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(n).toLocaleString();
}

/** Synthetic sparkline that wiggles around the current value — purely visual.
 *  Real sparklines need a time-series; we'll wire that to a /api/platform/timeseries
 *  endpoint in a follow-up. */
function buildPulseSpark(value: number, isPercent = false): number[] {
  const max = isPercent ? 100 : value;
  const seed = Math.max(1, value);
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    const wave = Math.sin(i * 0.6) * (seed * 0.08);
    const drift = (i / 24) * (seed * 0.05);
    out.push(Math.max(0, Math.min(max, seed * 0.85 + wave + drift)));
  }
  return out;
}
