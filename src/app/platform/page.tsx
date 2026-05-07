'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bot, Wrench, FileText, Car, Bus, School, Truck, Siren, CarFront, UserCog,
  Building2, Smartphone, Banknote, Scale, AppWindow, BarChart3, Radio,
  Leaf, Package,
  type LucideIcon,
} from 'lucide-react';
import TenantSessionBar from '@/components/TenantSessionBar';
import { usePermissions } from '@/contexts/PermissionContext';
import { useAccessControl } from '@/hooks/useAccessControl';

// ── KPI types ──────────────────────────────────────────────────────────────────
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

// ── Module registry ────────────────────────────────────────────────────────────
interface ModuleDef {
  id: string; title: string; description: string; href: string;
  icon: LucideIcon;
  gradient: string; glow: string; border: string;
  tags: string[]; status: string;
}
const modules: ModuleDef[] = [
  {
    id: 'agents', title: 'AI Agent Ecosystem',
    description: '10 autonomous AI agents — predictive maintenance, route optimisation, incident triage, smart dispatch, driver coaching, demand forecasting, WhatsApp AI, and more. Inline approvals, threshold tuning, and live activity feed.',
    href: '/agents', icon: Bot,
    gradient: 'from-violet-600 to-purple-700', glow: 'shadow-violet-500/20', border: 'border-violet-500/30',
    tags: ['Predictive AI', 'Auto-Triage', 'Smart Dispatch', 'WhatsApp AI'], status: 'live',
  },
  {
    id: 'maintenance',
    title: 'Vehicle Maintenance',
    description: 'Full lifecycle maintenance workflow — service requests, quotations, work orders, invoices, predictive analytics',
    href: '/maintenance', icon: Wrench,
    gradient: 'from-blue-600 to-indigo-600', glow: 'shadow-blue-500/20', border: 'border-blue-500/30',
    tags: ['Workflow', 'Quotations', 'Work Orders', 'Analytics'], status: 'live',
  },
  {
    id: 'leasing', title: 'Vehicle Leasing',
    description: 'Long-term lease contract management, payment schedules, lessee profiles, vehicle returns',
    href: '/leasing', icon: FileText,
    gradient: 'from-violet-600 to-purple-600', glow: 'shadow-violet-500/20', border: 'border-violet-500/30',
    tags: ['Contracts', 'Payments', 'Lessees', 'Returns'], status: 'live',
  },
  {
    id: 'rental', title: 'Rent-a-Car',
    description: 'Short-term vehicle rentals, booking engine, customer KYC, dynamic pricing, damage claims',
    href: '/rental', icon: Car,
    gradient: 'from-emerald-600 to-teal-600', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30',
    tags: ['Bookings', 'Customers', 'Pricing', 'Damage Claims'], status: 'live',
  },
  {
    id: 'bus-ops', title: 'Staff Transportation',
    description: 'Bus route management, trip scheduling, passenger roster, boarding tracking, dispatch board',
    href: '/bus-ops', icon: Bus,
    gradient: 'from-purple-600 to-pink-600', glow: 'shadow-purple-500/20', border: 'border-purple-500/30',
    tags: ['Routes', 'Schedules', 'Passengers', 'Dispatch'], status: 'live',
  },
  {
    id: 'school-bus', title: 'School Bus Transportation',
    description: 'Student registry, RFID attendance tracking, guardian notifications, safety compliance and trip scheduling',
    href: '/school-bus', icon: School,
    gradient: 'from-yellow-500 to-amber-500', glow: 'shadow-yellow-500/20', border: 'border-yellow-500/30',
    tags: ['Students', 'Routes', 'Safety', 'Attendance'], status: 'live',
  },
  {
    id: 'logistics', title: 'Logistics Management',
    description: 'End-to-end logistics trip management — fleet dispatch, delivery tracking, route optimization, driver assignment',
    href: '/logistics', icon: Truck,
    gradient: 'from-amber-600 to-yellow-600', glow: 'shadow-amber-500/20', border: 'border-amber-500/30',
    tags: ['Dispatch', 'Delivery', 'Routing', 'Fleet'], status: 'live',
  },
  {
    id: 'incidents', title: 'Incident & Ambulance',
    description: 'Real-time incident reporting, ambulance dispatch, emergency response coordination and compliance tracking',
    href: '/incidents', icon: Siren,
    gradient: 'from-red-600 to-rose-600', glow: 'shadow-red-500/20', border: 'border-red-500/30',
    tags: ['Emergency', 'Ambulance', 'Compliance', 'Safety'], status: 'live',
  },
  {
    id: 'fleet', title: 'Fleet Management',
    description: 'Vehicle document vault, fuel management, traffic fines, TCO analysis, asset lifecycle tracking',
    href: '/fleet', icon: CarFront,
    gradient: 'from-orange-600 to-amber-600', glow: 'shadow-orange-500/20', border: 'border-orange-500/30',
    tags: ['Documents', 'Fuel Logs', 'Fines', 'TCO'], status: 'live',
  },
  {
    id: 'driver-mgmt', title: 'Driver Management',
    description: 'Driver onboarding, document tracking, shift management, training records, performance scoring',
    href: '/driver-mgmt', icon: UserCog,
    gradient: 'from-cyan-600 to-blue-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['Onboarding', 'Shifts', 'Training', 'Performance'], status: 'live',
  },
  {
    id: 'customer-mgmt', title: 'Customer Management',
    description: 'Customer master with 3-level hierarchy (Region, Department, Unit), financial & billing settings',
    href: '/customer-mgmt', icon: Building2,
    gradient: 'from-cyan-600 to-blue-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['Hierarchy', 'Billing', 'Bookings', 'Communication'], status: 'live',
  },
  {
    id: 'booking-portal', title: 'Booking Portal',
    description: 'Unified self-service booking across all transport services — rentals, leasing, shuttles, executive vehicles',
    href: '/booking-portal', icon: Smartphone,
    gradient: 'from-indigo-600 to-violet-600', glow: 'shadow-indigo-500/20', border: 'border-indigo-500/30',
    tags: ['Self-Service', 'Approvals', 'Multi-Service'], status: 'live',
  },
  {
    id: 'finance', title: 'Finance & Billing',
    description: 'Invoicing, payment processing, credit notes, VAT compliance (UAE 5%), budget vs actual tracking',
    href: '/finance', icon: Banknote,
    gradient: 'from-green-600 to-emerald-600', glow: 'shadow-green-500/20', border: 'border-green-500/30',
    tags: ['Invoices', 'Payments', 'VAT', 'Budgets'], status: 'live',
  },
  {
    id: 'compliance', title: 'Compliance & Regulatory',
    description: 'RTA compliance, insurance policies, road permits, Salik accounts, regulatory document tracking',
    href: '/compliance', icon: Scale,
    gradient: 'from-rose-600 to-red-600', glow: 'shadow-rose-500/20', border: 'border-rose-500/30',
    tags: ['RTA', 'Insurance', 'Permits', 'Salik'], status: 'live',
  },
  {
    id: 'customer', title: 'Customer App',
    description: 'Mobile-first portal for renters, lessees and staff — bookings, shuttle schedules, account management',
    href: '/customer', icon: Smartphone,
    gradient: 'from-sky-600 to-cyan-600', glow: 'shadow-sky-500/20', border: 'border-sky-500/30',
    tags: ['PWA', 'Mobile', 'Self-Service'], status: 'live',
  },
  {
    id: 'mobile-apps', title: 'Mobile Apps',
    description: 'Fleet360 PWA gallery — Driver, Passenger, Counter, Field-Ops. Install once on the phone, work offline-cached, scope-locked per role.',
    href: '/mobile-apps', icon: AppWindow,
    gradient: 'from-fuchsia-600 to-pink-600', glow: 'shadow-fuchsia-500/20', border: 'border-fuchsia-500/30',
    tags: ['Fleet360', 'PWA', 'Driver', 'Passenger', 'Field'], status: 'live',
  },
  {
    id: 'reports', title: 'Reports & Analytics',
    description: 'Cross-module BI — fleet utilization, revenue analysis, driver performance, scheduled report exports',
    href: '/reports', icon: BarChart3,
    gradient: 'from-fuchsia-600 to-indigo-600', glow: 'shadow-fuchsia-500/20', border: 'border-fuchsia-500/30',
    tags: ['Fleet', 'Revenue', 'Drivers', 'Power BI'], status: 'live',
  },
  {
    id: 'dispatch', title: 'Dispatch Control',
    description: 'Real-time dispatch command centre — auto-dispatch engine, trip merge optimizer, job queue, driver availability, school bus & ambulance dispatch',
    href: '/dispatch', icon: Radio,
    gradient: 'from-blue-600 to-cyan-600', glow: 'shadow-blue-500/20', border: 'border-blue-500/30',
    tags: ['Command Centre', 'Auto-Dispatch', 'Merge Optimizer', 'Live Map'], status: 'live',
  },
  {
    id: 'sustainability', title: 'Sustainability & ESG',
    description: 'GHG Protocol / ISO 14064 verified CO₂ measurement — Scope 1/2/3 emissions, modal shift, fleet decarbonisation and UAE Net Zero 2050 compliance',
    href: '/sustainability', icon: Leaf,
    gradient: 'from-emerald-500 to-green-600', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30',
    tags: ['GHG Protocol', 'ISO 14064', 'UAE Net Zero', 'ESG'], status: 'live',
  },
  {
    id: 'assets', title: 'Assets & Inventory',
    description: 'Unified cross-domain asset registry — HVA tracking with calibration & insurance, medical supplies with seal logs, BLE tagging, stock management, field dispatch, and reverse logistics',
    href: '/assets', icon: Package,
    gradient: 'from-cyan-600 to-teal-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['HVA', 'BLE Tracking', 'Medical', 'Stock Ops'], status: 'live',
  },
];

// ── KPI helpers ────────────────────────────────────────────────────────────────
function KpiTile({ icon, label, value, sub, color = 'text-white', alert = false }: {
  icon: string; label: string; value: string | number; sub?: string; color?: string; alert?: boolean;
}) {
  return (
    <div className={`bg-slate-800/60 border rounded-2xl p-4 space-y-1 ${alert ? 'border-red-500/30 bg-red-500/5' : 'border-white/10'}`}>
      <p className="text-xs text-slate-500 flex items-center gap-1">{icon} {label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

function HealthBar({ label, rate, href }: { label: string; rate: number; href: string }) {
  const color = rate >= 80 ? 'bg-emerald-500' : rate >= 60 ? 'bg-amber-500' : 'bg-red-500';
  const text  = rate >= 80 ? 'text-emerald-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400';
  return (
    <Link href={href} className="flex items-center gap-3 hover:bg-white/5 px-3 py-2 rounded-xl transition-colors">
      <span className="text-slate-400 text-xs w-32 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${text}`}>{rate}%</span>
    </Link>
  );
}

function AlertBadge({ label, count, href }: { label: string; count: number; href: string }) {
  if (count === 0) return null;
  return (
    <Link href={href}
      className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 hover:bg-red-500/20 transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-red-300 text-xs font-medium">{count} {label}</span>
      <span className="text-red-500 text-xs ml-auto">→</span>
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function PlatformPage() {
  const [search,   setSearch]   = useState('');
  const [kpis,     setKpis]     = useState<PlatformKPIs | null>(null);
  const [loadingK, setLoadingK] = useState(true);
  const [lastTs,   setLastTs]   = useState<Date | null>(null);

  const { user, tenant, isAuthenticated, isLoading } = usePermissions();
  const { isSuperAdmin } = useAccessControl('fleet'); // just to read role; fleet is always accessible

  const loadKpis = useCallback(async () => {
    setLoadingK(true);
    try {
      const res = await fetch('/api/platform/kpis', { cache: 'no-store' });
      if (res.ok) { setKpis(await res.json()); setLastTs(new Date()); }
    } catch { /* silent */ }
    finally { setLoadingK(false); }
  }, []);

  useEffect(() => {
    loadKpis();
    const t = setInterval(loadKpis, 60000); // refresh every 60s
    return () => clearInterval(t);
  }, [loadKpis]);

  /**
   * Module lock rules:
   *  - Not yet authenticated / still loading  → never lock (avoid flash)
   *  - SUPER_ADMIN                            → never lock (sees everything)
   *  - Tenant with no modules configured yet  → never lock (no restriction set)
   *  - Tenant with enabledModules configured  → lock modules NOT in the list
   */
  const moduleIsLocked = (modId: string): boolean => {
    if (!isAuthenticated || isLoading) return false;
    if (isSuperAdmin) return false;
    if (!tenant || tenant.enabledModules.length === 0) return false;
    return !tenant.enabledModules.includes(modId);
  };

  const filtered = modules.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    m.description.toLowerCase().includes(search.toLowerCase()) ||
    m.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  // Derive module stats from KPIs
  const moduleStats: Record<string, Array<{ label: string; value: string | number }>> = kpis ? {
    maintenance: [{ label: 'In Maintenance', value: kpis.fleet.inMaintenance }, { label: 'Fleet Available', value: kpis.fleet.available }],
    leasing:     [{ label: 'Total Fleet', value: kpis.fleet.total }, { label: 'Dispatched', value: kpis.fleet.dispatched }],
    rental:      [{ label: 'Active Agreements', value: kpis.rac.activeAgreements }, { label: 'Fleet Available', value: kpis.rac.availableFleet }],
    'bus-ops':   [{ label: 'Today\'s Trips', value: kpis.staffTransport.todayTrips }, { label: 'In Transit', value: kpis.staffTransport.inTransit }],
    'school-bus':[{ label: 'Active Students', value: kpis.schoolBus.students }, { label: 'Active Routes', value: kpis.schoolBus.activeRoutes }],
    logistics:   [{ label: 'Active Trips', value: kpis.logistics.activeTrips }, { label: 'Pending', value: kpis.logistics.pendingBookings }],
    incidents:   [{ label: 'Open Incidents', value: kpis.incidents.open }, { label: 'Ambulances Ready', value: kpis.ambulance.available }],
    fleet:       [{ label: 'Total Fleet', value: kpis.fleet.total }, { label: 'Utilisation', value: `${kpis.fleet.utilisationRate}%` }],
    'driver-mgmt':[{ label: 'Total Drivers', value: kpis.drivers.total }, { label: 'Active', value: kpis.drivers.active }],
    finance:     [{ label: 'Unpaid Invoices', value: kpis.finance.unpaidInvoices }, { label: 'Overdue', value: kpis.finance.overdueInvoices }],
    'customer-mgmt': [{ label: 'Total Customers', value: '—' }, { label: 'Active', value: '—' }],
    'booking-portal': [{ label: 'Pending Approvals', value: '—' }, { label: 'Bookings Today', value: kpis.logistics.todayBookings }],
    compliance:  [{ label: 'Expired Docs', value: '—' }, { label: 'Expiring Soon', value: '—' }],
    customer:    [{ label: 'Active Users', value: '—' }, { label: 'Open Requests', value: '—' }],
    reports:     [{ label: 'Reports Scheduled', value: '—' }, { label: 'Modules Covered', value: '16' }],
    sustainability: [{ label: 'CO₂ Avoided', value: '—' }, { label: 'Green Fleet %', value: '—' }],
  } : {};

  // Health bars data
  const healthBars = kpis ? [
    { label: 'Fleet Utilisation',   rate: kpis.fleet.utilisationRate, href: '/fleet' },
    { label: 'Staff Transport',     rate: kpis.staffTransport.todayTrips > 0 ? 80 : 50, href: '/bus-ops' },
    { label: 'Logistics Delivery',  rate: kpis.logistics.todayBookings > 0 ? Math.round((kpis.logistics.deliveredToday / kpis.logistics.todayBookings) * 100) : 0, href: '/logistics' },
    { label: 'RAC Fleet Avail',     rate: kpis.rac.activeAgreements + kpis.rac.availableFleet > 0 ? Math.round((kpis.rac.availableFleet / (kpis.rac.activeAgreements + kpis.rac.availableFleet)) * 100) : 0, href: '/rental' },
    { label: 'Driver Readiness',    rate: kpis.drivers.total > 0 ? Math.round((kpis.drivers.active / kpis.drivers.total) * 100) : 0, href: '/driver-mgmt' },
  ] : [];

  // Active alerts
  const alerts = kpis ? [
    { label: 'critical incident(s)', count: kpis.incidents.critical, href: '/incidents/active' },
    { label: 'escalated incident(s)', count: kpis.incidents.escalated, href: '/incidents/active' },
    { label: 'active ambulance call(s)', count: kpis.ambulance.activeCalls, href: '/incidents/ambulance' },
    { label: 'overdue invoice(s)', count: kpis.finance.overdueInvoices, href: '/finance' },
    { label: 'damage claim(s)', count: kpis.rac.openDamageClaims, href: '/rental' },
    { label: 'RAC return(s) due', count: kpis.rac.pendingReturns, href: '/rental/agreements' },
  ].filter(a => a.count > 0) : [];

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white">
      {/* Top nav */}
      <nav className="border-b border-white/10 bg-slate-900/95 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white text-base shadow-lg shadow-blue-500/30">
              XL
            </div>
            <span className="text-white font-bold text-lg">XL AI Smart Mobility</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/platform/v2" className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-violet-500/30">
              ✨ Try new home
            </Link>
            <Link href="/customer" className="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-all">Customer Portal</Link>
            <Link href="/approvals" className="rounded-lg bg-violet-600/20 border border-violet-500/30 px-4 py-1.5 text-sm font-medium text-violet-400 hover:bg-violet-600/30 transition-all">Approvals</Link>
            <Link href="/admin" className="rounded-lg bg-red-600/20 border border-red-500/30 px-4 py-1.5 text-sm font-medium text-red-400 hover:bg-red-600/30 transition-all">Admin</Link>
            <TenantSessionBar />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-blue-300 text-xs font-medium">All Systems Operational</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
            XL AI{' '}
            <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Smart Mobility</span>
          </h1>
          {/* Personalised welcome for logged-in tenant */}
          {isAuthenticated && user && tenant && (
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? user.username[0])).toUpperCase()}
              </div>
              <p className="text-slate-300 text-base">
                Welcome back, <span className="text-white font-semibold">{user.firstName ?? user.username}</span>
                {' '}· <span className="text-blue-400">{tenant.name}</span>
                {!isSuperAdmin && tenant.enabledModules.length > 0 && (
                  <span className="text-slate-500 text-sm ml-2">({tenant.enabledModules.length} service{tenant.enabledModules.length !== 1 ? 's' : ''} enabled)</span>
                )}
              </p>
            </div>
          )}
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            {isAuthenticated && !isSuperAdmin && tenant && tenant.enabledModules.length > 0
              ? 'Your active modules are highlighted below. Locked modules are available — contact your platform administrator to subscribe.'
              : 'Unified transport management — maintenance, leasing, rentals, staff buses, logistics, incidents, ESG sustainability and analytics in one platform.'}
          </p>
          <div className="mt-8 max-w-md mx-auto relative">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input type="text" placeholder="Search modules..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-800/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500/50 transition-colors" />
          </div>
        </div>

        {/* ── LIVE KPI DASHBOARD ─────────────────────────────────────────── */}
        <div className="bg-slate-800/30 border border-white/10 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-bold text-lg">Platform KPIs</h2>
              <p className="text-slate-500 text-xs mt-0.5">Live cross-module summary · Auto-refresh every 60s</p>
            </div>
            <div className="flex items-center gap-3">
              {lastTs && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                  {lastTs.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}
              <button onClick={loadKpis} className="text-xs text-slate-400 border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 hover:text-white transition-colors">↺ Refresh</button>
            </div>
          </div>

          {loadingK ? (
            <div className="animate-pulse grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[...Array(12)].map((_, i) => <div key={i} className="h-20 bg-slate-700/60 rounded-2xl" />)}
            </div>
          ) : kpis ? (
            <>
              {/* Alerts row */}
              {alerts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {alerts.map(a => <AlertBadge key={a.label} {...a} />)}
                </div>
              )}

              {/* Fleet KPIs */}
              <div>
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-3">🚘 Fleet & Drivers</p>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <KpiTile icon="🚘" label="Total Fleet"        value={kpis.fleet.total}              color="text-white" />
                  <KpiTile icon="✅" label="Available"          value={kpis.fleet.available}           color="text-emerald-400" />
                  <KpiTile icon="🔧" label="Maintenance"        value={kpis.fleet.inMaintenance}       color={kpis.fleet.inMaintenance > 0 ? 'text-amber-400' : 'text-slate-400'} />
                  <KpiTile icon="🔄" label="Utilisation"        value={`${kpis.fleet.utilisationRate}%`} color={kpis.fleet.utilisationRate >= 70 ? 'text-emerald-400' : kpis.fleet.utilisationRate >= 40 ? 'text-amber-400' : 'text-red-400'} />
                  <KpiTile icon="👤" label="Total Drivers"      value={kpis.drivers.total}             color="text-white" />
                  <KpiTile icon="✅" label="Active Drivers"     value={kpis.drivers.active}            color="text-emerald-400" />
                </div>
              </div>

              {/* Operations KPIs */}
              <div>
                <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-3">🚛 Operations (Live)</p>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <KpiTile icon="🚛" label="Active Trips"       value={kpis.logistics.activeTrips}    color={kpis.logistics.activeTrips > 0 ? 'text-amber-300' : 'text-slate-400'} sub="Logistics" />
                  <KpiTile icon="🚌" label="Staff In Transit"   value={kpis.staffTransport.inTransit} color={kpis.staffTransport.inTransit > 0 ? 'text-purple-300' : 'text-slate-400'} sub="Staff Bus" />
                  <KpiTile icon="📦" label="Delivered Today"    value={kpis.logistics.deliveredToday} color="text-emerald-400" sub="Logistics" />
                  <KpiTile icon="📋" label="Pending Bookings"   value={kpis.logistics.pendingBookings} color={kpis.logistics.pendingBookings > 5 ? 'text-amber-400' : 'text-slate-300'} sub="Logistics" />
                  <KpiTile icon="🚗" label="RAC Active"         value={kpis.rac.activeAgreements}     color="text-emerald-400" sub="Rent-a-Car" />
                  <KpiTile icon="⏰" label="Returns Due"         value={kpis.rac.pendingReturns}       color={kpis.rac.pendingReturns > 0 ? 'text-amber-400' : 'text-slate-400'} sub="RAC" alert={kpis.rac.pendingReturns > 0} />
                </div>
              </div>

              {/* School Bus + Incidents */}
              <div>
                <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">🏫 School Bus &nbsp;·&nbsp; 🚨 Incidents</p>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <KpiTile icon="👧" label="Students"           value={kpis.schoolBus.students}        color="text-yellow-300" />
                  <KpiTile icon="🏫" label="SB Routes"          value={kpis.schoolBus.activeRoutes}    color="text-yellow-400" />
                  <KpiTile icon="🔴" label="Open Incidents"     value={kpis.incidents.open}            color={kpis.incidents.open > 0 ? 'text-red-400' : 'text-slate-400'} alert={kpis.incidents.escalated > 0} />
                  <KpiTile icon="🚨" label="Escalated"          value={kpis.incidents.escalated}       color={kpis.incidents.escalated > 0 ? 'text-red-300' : 'text-slate-400'} alert={kpis.incidents.escalated > 0} />
                  <KpiTile icon="🚑" label="Ambulances Ready"   value={kpis.ambulance.available}       color={kpis.ambulance.available > 0 ? 'text-emerald-400' : 'text-red-400'} />
                  <KpiTile icon="📞" label="Active Calls"       value={kpis.ambulance.activeCalls}     color={kpis.ambulance.activeCalls > 0 ? 'text-red-400' : 'text-slate-400'} alert={kpis.ambulance.activeCalls > 0} />
                </div>
              </div>

              {/* Finance */}
              <div>
                <p className="text-xs text-emerald-400 font-semibold uppercase tracking-wider mb-3">💰 Finance</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiTile icon="💰" label="Revenue (30d)"      value={`AED ${kpis.finance.revenue30d.toLocaleString()}`} color="text-emerald-400" />
                  <KpiTile icon="📄" label="Unpaid Invoices"    value={kpis.finance.unpaidInvoices}    color={kpis.finance.unpaidInvoices > 0 ? 'text-amber-400' : 'text-slate-400'} />
                  <KpiTile icon="⚠️" label="Overdue Invoices"  value={kpis.finance.overdueInvoices}   color={kpis.finance.overdueInvoices > 0 ? 'text-red-400' : 'text-slate-400'} alert={kpis.finance.overdueInvoices > 0} />
                  <KpiTile icon="🔧" label="Damage Claims"      value={kpis.rac.openDamageClaims}      color={kpis.rac.openDamageClaims > 0 ? 'text-amber-400' : 'text-slate-400'} />
                </div>
              </div>

              {/* Module Health */}
              {healthBars.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">Module Health</p>
                  <div className="bg-slate-900/50 border border-white/10 rounded-2xl py-2">
                    {healthBars.map(h => <HealthBar key={h.label} {...h} />)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">Failed to load KPIs — <button onClick={loadKpis} className="text-blue-400 hover:text-blue-300">retry</button></div>
          )}
        </div>

        {/* Static quick stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Platform Modules', value: '16', sub: 'Fully integrated', color: 'text-blue-400' },
            { label: 'API Endpoints',    value: '80+', sub: 'REST APIs', color: 'text-emerald-400' },
            { label: 'DB Models',        value: '90+', sub: 'PostgreSQL tables', color: 'text-purple-400' },
            { label: 'Notification Channels', value: '2', sub: 'Email + WhatsApp', color: 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-slate-800/40 border border-white/10 rounded-2xl p-5 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-white text-sm font-medium mt-1">{s.label}</p>
              <p className="text-slate-500 text-xs mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Module grid */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">All Modules</h2>
            {!isSuperAdmin && isAuthenticated && tenant && tenant.enabledModules.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> {tenant.enabledModules.length} Active</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-600" /> {modules.length - tenant.enabledModules.length} Locked</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map(mod => {
              const locked = moduleIsLocked(mod.id);
              const stats  = moduleStats[mod.id] ?? mod.tags.slice(0, 2).map(t => ({ label: t, value: '—' }));

              /* ── LOCKED card — not subscribed ── */
              if (locked) {
                return (
                  <div key={mod.id}
                    className="relative bg-slate-800/30 border border-white/5 rounded-2xl overflow-hidden opacity-55 cursor-not-allowed"
                    title="This module is not included in your subscription">
                    {/* Lock badge */}
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-slate-700/60 border border-slate-600/40 px-2 py-0.5 z-10">
                      <span className="text-slate-500 text-[10px]">🔒</span>
                      <span className="text-slate-500 text-[10px] font-medium">NOT SUBSCRIBED</span>
                    </div>
                    <div className="p-6">
                      <div className="flex items-start gap-4 mb-4">
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${mod.gradient} flex items-center justify-center flex-shrink-0 shadow-lg grayscale`}>
                          <mod.icon className="w-6 h-6 text-white" strokeWidth={1.75} />
                        </div>
                        <div>
                          <h3 className="text-slate-400 font-semibold text-base">{mod.title}</h3>
                          <p className="text-slate-600 text-xs mt-1 leading-relaxed line-clamp-2">{mod.description}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {mod.tags.map(tag => (
                          <span key={tag} className="text-[10px] bg-white/3 border border-white/5 rounded-full px-2 py-0.5 text-slate-600">{tag}</span>
                        ))}
                      </div>
                      <div className="border-t border-white/5 pt-4">
                        <p className="text-[11px] text-slate-600 flex items-center gap-1.5">
                          <span>⚠</span>
                          Contact your platform administrator to enable this module.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              /* ── ACTIVE card — subscribed ── */
              return (
                <Link key={mod.id} href={mod.href}
                  className={`group relative bg-slate-800/50 border ${mod.border} rounded-2xl p-6 hover:bg-slate-800/80 transition-all duration-200 hover:shadow-xl ${mod.glow} hover:scale-[1.01] cursor-pointer block`}>
                  <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-400 text-[10px] font-medium">LIVE</span>
                  </div>
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${mod.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                      <mod.icon className="w-6 h-6 text-white" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-base group-hover:text-blue-300 transition-colors">{mod.title}</h3>
                      <p className="text-slate-400 text-xs mt-1 leading-relaxed line-clamp-2">{mod.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {mod.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-slate-400">{tag}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-4">
                    {stats.map(s => (
                      <div key={s.label}>
                        <p className="text-slate-500 text-[10px]">{s.label}</p>
                        <p className="text-white text-sm font-semibold">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="absolute bottom-5 right-5 text-slate-600 group-hover:text-slate-300 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <p className="text-slate-500 text-lg">No modules match &quot;{search}&quot;</p>
              <button onClick={() => setSearch('')} className="mt-3 text-blue-400 text-sm hover:text-blue-300 transition-colors">Clear search</button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 pt-8 flex items-center justify-between text-xs text-slate-600">
          <span>XL AI Smart Mobility  v2.0.0</span>
          <span>Next.js 15 · PostgreSQL · Prisma</span>
        </div>
      </div>
    </div>
  );
}
