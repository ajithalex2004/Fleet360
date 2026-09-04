import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import PlatformSessionSlot from './PlatformSessionSlot';

// -- Module registry ------------------------------------------------------------
interface ModuleDef {
  id: string; title: string; description: string; href: string;
  icon: string;
  gradient: string; glow: string; border: string;
  tags: string[]; status: string;
}
const modules: ModuleDef[] = [
  {
    id: 'exchange',
    title: 'Fleet360 Exchange & Partner Marketplace',
    description: 'Private transport partner network & outsourced dispatch marketplace — Blind RFQ bidding, zone rate cards, zero-login driver tracking, automated geofencing, 3-way commercial reconciliation, partner performance scorecards, and UAE FTA Tax Invoices.',
    href: '/exchange/dashboard',
    icon: 'EX',
    gradient: 'from-cyan-500 to-emerald-600',
    glow: 'shadow-cyan-500/30',
    border: 'border-cyan-500/40 ring-1 ring-cyan-500/20',
    tags: ['Marketplace', 'Outsourcing', 'Telematics', 'FTA Tax Invoices', 'Scorecards'],
    status: 'live',
  },
  {
    id: 'service-tickets', title: 'Service & Support Ticketing',
    description: 'One-stop ticketing for Maintenance, Renewal, Cleaning, Support, Incident, Towing & Complaint requests — shared SLA, assignment and notification engines with per-tenant access control.',
    href: '/service-tickets', icon: 'ST',
    gradient: 'from-violet-600 to-purple-600', glow: 'shadow-violet-500/20', border: 'border-violet-500/30',
    tags: ['7 Ticket Types', 'SLA', 'Assignment', 'Audit Trail'], status: 'live',
  },
  {
    id: 'agents', title: 'AI Agent Ecosystem',
    description: '10 autonomous AI agents — predictive maintenance, route optimisation, incident triage, smart dispatch, driver coaching, demand forecasting, WhatsApp AI, and more. Inline approvals, threshold tuning, and live activity feed.',
    href: '/agents', icon: 'AI',
    gradient: 'from-violet-600 to-purple-700', glow: 'shadow-violet-500/20', border: 'border-violet-500/30',
    tags: ['Predictive AI', 'Auto-Triage', 'Smart Dispatch', 'WhatsApp AI'], status: 'live',
  },
  {
    id: 'maintenance',
    title: 'Vehicle Maintenance',
    description: 'Full lifecycle maintenance workflow — service requests, quotations, work orders, invoices, predictive analytics',
    href: '/maintenance', icon: 'MT',
    gradient: 'from-blue-600 to-indigo-600', glow: 'shadow-blue-500/20', border: 'border-blue-500/30',
    tags: ['Workflow', 'Quotations', 'Work Orders', 'Analytics'], status: 'live',
  },
  {
    id: 'leasing', title: 'Vehicle Leasing',
    description: 'Long-term lease contract management, payment schedules, lessee profiles, vehicle returns',
    href: '/leasing', icon: 'LS',
    gradient: 'from-violet-600 to-purple-600', glow: 'shadow-violet-500/20', border: 'border-violet-500/30',
    tags: ['Contracts', 'Lessees', 'Renewals', 'Returns'], status: 'live',
  },
  {
    id: 'rental', title: 'Rent-a-Car',
    description: 'Short-term vehicle rentals, booking engine, customer KYC, dynamic pricing, damage claims',
    href: '/rental', icon: 'RC',
    gradient: 'from-emerald-600 to-teal-600', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30',
    tags: ['Bookings', 'Customers', 'Pricing', 'Damage Claims'], status: 'live',
  },
  {
    id: 'bus-ops', title: 'Staff Transportation',
    description: 'Bus route management, trip scheduling, passenger roster, boarding tracking, dispatch board',
    href: '/bus-ops', icon: 'BO',
    gradient: 'from-purple-600 to-pink-600', glow: 'shadow-purple-500/20', border: 'border-purple-500/30',
    tags: ['Routes', 'Schedules', 'Passengers', 'Dispatch'], status: 'live',
  },
  {
    id: 'school-bus', title: 'School Bus Transportation',
    description: 'Student registry, RFID attendance tracking, guardian notifications, safety compliance and trip scheduling',
    href: '/school-bus', icon: 'SB',
    gradient: 'from-yellow-500 to-amber-500', glow: 'shadow-yellow-500/20', border: 'border-yellow-500/30',
    tags: ['Students', 'Routes', 'Safety', 'Attendance'], status: 'live',
  },
  {
    id: 'logistics', title: 'Logistics Management',
    description: 'End-to-end logistics trip management — fleet dispatch, delivery tracking, route optimization, driver assignment',
    href: '/logistics', icon: 'LG',
    gradient: 'from-amber-600 to-yellow-600', glow: 'shadow-amber-500/20', border: 'border-amber-500/30',
    tags: ['Dispatch', 'Delivery', 'Routing', 'Fleet'], status: 'live',
  },
  {
    id: 'incidents', title: 'Incident & Ambulance',
    description: 'Real-time incident reporting, ambulance dispatch, emergency response coordination and compliance tracking',
    href: '/incidents', icon: 'IN',
    gradient: 'from-red-600 to-rose-600', glow: 'shadow-red-500/20', border: 'border-red-500/30',
    tags: ['Emergency', 'Ambulance', 'Compliance', 'Safety'], status: 'live',
  },
  {
    id: 'fleet', title: 'Fleet Management',
    description: 'Vehicle document vault, fuel management, traffic fines, TCO analysis, asset lifecycle tracking',
    href: '/fleet', icon: 'FL',
    gradient: 'from-orange-600 to-amber-600', glow: 'shadow-orange-500/20', border: 'border-orange-500/30',
    tags: ['Documents', 'Fuel Logs', 'Fines', 'TCO'], status: 'live',
  },
  {
    id: 'driver-mgmt', title: 'Driver Management',
    description: 'Driver onboarding, document tracking, shift management, training records, performance scoring',
    href: '/driver-mgmt', icon: 'DR',
    gradient: 'from-cyan-600 to-blue-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['Onboarding', 'Shifts', 'Training', 'Performance'], status: 'live',
  },
  {
    id: 'customer-mgmt', title: 'Customer Management',
    description: 'Customer master with 3-level hierarchy (Region, Department, Unit), financial & billing settings',
    href: '/customer-mgmt', icon: 'CM',
    gradient: 'from-cyan-600 to-blue-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['Hierarchy', 'Billing', 'Bookings', 'Communication'], status: 'live',
  },
  {
    id: 'booking-portal', title: 'Booking Portal',
    description: 'Unified self-service booking across all transport services — rentals, leasing, shuttles, executive vehicles',
    href: '/booking-portal', icon: 'BP',
    gradient: 'from-indigo-600 to-violet-600', glow: 'shadow-indigo-500/20', border: 'border-indigo-500/30',
    tags: ['Self-Service', 'Approvals', 'Multi-Service'], status: 'live',
  },
  {
    id: 'finance', title: 'Finance & Billing',
    description: 'Invoicing, payment processing, credit notes, VAT compliance (UAE 5%), budget vs actual tracking',
    href: '/finance', icon: 'FN',
    gradient: 'from-green-600 to-emerald-600', glow: 'shadow-green-500/20', border: 'border-green-500/30',
    tags: ['Invoices', 'Payments', 'VAT', 'Budgets'], status: 'live',
  },
  {
    id: 'compliance', title: 'Compliance & Regulatory',
    description: 'RTA compliance, insurance policies, road permits, Salik accounts, regulatory document tracking',
    href: '/compliance', icon: 'CP',
    gradient: 'from-rose-600 to-red-600', glow: 'shadow-rose-500/20', border: 'border-rose-500/30',
    tags: ['RTA', 'Insurance', 'Permits', 'Salik'], status: 'live',
  },
  {
    id: 'customer', title: 'Customer App',
    description: 'Mobile-first portal for renters, lessees and staff — bookings, shuttle schedules, account management',
    href: '/customer', icon: 'CU',
    gradient: 'from-sky-600 to-cyan-600', glow: 'shadow-sky-500/20', border: 'border-sky-500/30',
    tags: ['PWA', 'Mobile', 'Self-Service'], status: 'live',
  },
  {
    id: 'mobile-apps', title: 'Mobile Apps & PWA Gallery',
    description: 'Fleet360 Booking App (Universal Freight, Chauffeur, School Bus, Staff Transport, Rental) with Native Android APK, plus STS Driver, STS Passenger, and RAC Counter PWAs.',
    href: '/mobile-apps', icon: 'MA',
    gradient: 'from-fuchsia-600 to-pink-600', glow: 'shadow-fuchsia-500/20', border: 'border-fuchsia-500/30',
    tags: ['Booking App', 'Android APK', 'Driver App', 'Passenger', 'PWA'], status: 'live',
  },
  {
    id: 'reports', title: 'Reports & Analytics',
    description: 'Cross-module BI — fleet utilization, revenue analysis, driver performance, scheduled report exports',
    href: '/reports', icon: 'BI',
    gradient: 'from-fuchsia-600 to-indigo-600', glow: 'shadow-fuchsia-500/20', border: 'border-fuchsia-500/30',
    tags: ['Fleet', 'Revenue', 'Drivers', 'Power BI'], status: 'live',
  },
  {
    id: 'dispatch', title: 'Dispatch Control',
    description: 'Real-time dispatch command centre — auto-dispatch engine, trip merge optimizer, job queue, driver availability, school bus & ambulance dispatch',
    href: '/dispatch', icon: 'DC',
    gradient: 'from-blue-600 to-cyan-600', glow: 'shadow-blue-500/20', border: 'border-blue-500/30',
    tags: ['Command Centre', 'Auto-Dispatch', 'Merge Optimizer', 'Live Map'], status: 'live',
  },
  {
    id: 'sustainability', title: 'Sustainability & ESG',
    description: 'GHG Protocol / ISO 14064 verified CO2 measurement — Scope 1/2/3 emissions, modal shift, fleet decarbonisation and UAE Net Zero 2050 compliance',
    href: '/sustainability', icon: 'ESG',
    gradient: 'from-emerald-500 to-green-600', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30',
    tags: ['GHG Protocol', 'ISO 14064', 'UAE Net Zero', 'ESG'], status: 'live',
  },
  {
    id: 'assets', title: 'Assets & Inventory',
    description: 'Unified cross-domain asset registry — HVA tracking with calibration & insurance, medical supplies with seal logs, BLE tagging, stock management, field dispatch, and reverse logistics',
    href: '/assets', icon: 'AS',
    gradient: 'from-cyan-600 to-teal-600', glow: 'shadow-cyan-500/20', border: 'border-cyan-500/30',
    tags: ['HVA', 'BLE Tracking', 'Medical', 'Stock Ops'], status: 'live',
  },
];

// -- Main page ------------------------------------------------------------------
export default function PlatformPage() {
  const activeModuleCount = modules.length;

  // Module cards stay static so the landing page never waits on analytics APIs.
  const moduleStats: Record<string, Array<{ label: string; value: string | number }>> = {
    exchange: [{ label: 'Partner Network', value: 'Active' }, { label: 'Marketplace', value: 'Live' }],
    maintenance: [{ label: 'Workflow', value: 'Ready' }, { label: 'Approvals', value: 'Ready' }],
    leasing: [{ label: 'Contracts', value: 'Ready' }, { label: 'Renewals', value: 'Ready' }],
    rental: [{ label: 'Bookings', value: 'Ready' }, { label: 'Damage', value: 'Ready' }],
    'bus-ops': [{ label: 'Routes', value: 'Ready' }, { label: 'Dispatch', value: 'Ready' }],
    'school-bus': [{ label: 'Students', value: 'Ready' }, { label: 'Safety', value: 'Ready' }],
    logistics: [{ label: 'Dispatch', value: 'Ready' }, { label: 'Tracking', value: 'Ready' }],
    incidents: [{ label: 'Emergency', value: 'Ready' }, { label: 'Ambulance', value: 'Ready' }],
    fleet: [{ label: 'Documents', value: 'Ready' }, { label: 'TCO', value: 'Ready' }],
    'driver-mgmt': [{ label: 'Onboarding', value: 'Ready' }, { label: 'Performance', value: 'Ready' }],
    finance: [{ label: 'Invoices', value: 'Ready' }, { label: 'VAT', value: 'Ready' }],
    'customer-mgmt': [{ label: 'Total Customers', value: '—' }, { label: 'Active', value: '—' }],
    'booking-portal': [{ label: 'Approvals', value: 'Ready' }, { label: 'Bookings', value: 'Ready' }],
    compliance:  [{ label: 'Expired Docs', value: '—' }, { label: 'Expiring Soon', value: '—' }],
    customer:    [{ label: 'Active Users', value: '—' }, { label: 'Open Requests', value: '—' }],
    reports:     [{ label: 'Reports Scheduled', value: '—' }, { label: 'Modules Covered', value: '16' }],
    sustainability: [{ label: 'CO2 Avoided', value: '—' }, { label: 'Green Fleet %', value: '—' }],
  };

  return (
    <div className="min-h-screen bg-[#080b11] dark:bg-[#080b11] bg-slate-50 text-white dark:text-white text-slate-900 transition-colors">
      {/* Top nav */}
      <nav className="border-b border-white/10 dark:border-white/10 border-slate-200/90 bg-slate-950/85 dark:bg-slate-950/85 bg-white/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 flex items-center justify-center font-extrabold text-white text-base shadow-lg shadow-cyan-500/25">
              F360
            </div>
            <div>
              <span className="text-white dark:text-white text-slate-900 font-extrabold text-lg tracking-tight">Fleet360</span>
              <span className="hidden sm:inline-block ml-2 text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 dark:text-cyan-300 text-blue-700 px-2 py-0.5 rounded-full border border-cyan-500/30">ENTERPRISE</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ThemeToggle />
            <Link href="/approvals" className="rounded-xl bg-violet-600/20 border border-violet-500/30 px-4 py-1.5 text-xs font-bold text-violet-400 hover:bg-violet-600/30 transition-all shadow-sm">Approvals</Link>
            <Link href="/admin" className="rounded-xl bg-red-600/20 border border-red-500/30 px-4 py-1.5 text-xs font-bold text-red-400 hover:bg-red-600/30 transition-all shadow-sm">Admin</Link>
            <PlatformSessionSlot />
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 mb-6 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-cyan-300 dark:text-cyan-300 text-blue-700 text-xs font-bold tracking-wider">UNIFIED TRANSPORT ECOSYSTEM</span>
          </div>
          <h1 className="text-5xl font-black text-white dark:text-white text-slate-900 mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 bg-clip-text text-transparent">Fleet360 Platform</span>
          </h1>
          <p className="text-slate-400 dark:text-slate-400 text-slate-600 text-base max-w-2xl mx-auto leading-relaxed">
            Autonomous fleet intelligence, multi-modal transport bookings, maintenance lifecycle, staff dispatch, and ESG sustainability in one high-performance system.
          </p>
          <div className="mt-8 max-w-md mx-auto relative">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input type="text" placeholder="Module search is available inside each module" readOnly
              className="w-full bg-slate-900/80 dark:bg-slate-900/80 bg-white border border-white/10 dark:border-white/10 border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-white dark:text-white text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-cyan-400 transition-colors shadow-inner" />
          </div>
        </div>

        {/* Module grid */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white dark:text-white text-slate-900 font-extrabold text-lg tracking-tight">Enterprise Modules</h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> {activeModuleCount} Active</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {modules.map(mod => {
              const stats  = moduleStats[mod.id] ?? mod.tags.slice(0, 2).map(t => ({ label: t, value: '—' }));

              return (
                <Link key={mod.id} href={mod.href}
                  className="group relative bg-slate-900/60 dark:bg-slate-900/60 bg-white border border-white/10 dark:border-white/10 border-slate-200/90 rounded-2xl p-6 hover:border-cyan-400/60 dark:hover:border-cyan-400/60 hover:border-blue-500/60 transition-all duration-200 hover:shadow-2xl hover:shadow-cyan-500/10 hover:scale-[1.01] cursor-pointer block backdrop-blur-xl shadow-lg">
                  <div className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-emerald-400 text-[10px] font-bold">LIVE</span>
                  </div>
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${mod.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                      <span className="text-white text-sm font-black tracking-tight">{mod.icon}</span>
                    </div>
                    <div>
                      <h3 className="text-white dark:text-white text-slate-900 font-extrabold text-base group-hover:text-cyan-400 dark:group-hover:text-cyan-400 group-hover:text-blue-600 transition-colors">{mod.title}</h3>
                      <p className="text-slate-400 dark:text-slate-400 text-slate-600 text-xs mt-1 leading-relaxed line-clamp-2">{mod.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {mod.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-medium bg-white/5 dark:bg-white/5 bg-slate-100 border border-white/10 dark:border-white/10 border-slate-200 rounded-full px-2 py-0.5 text-slate-400 dark:text-slate-400 text-slate-600">{tag}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-white/5 dark:border-white/5 border-slate-100 pt-4">
                    {stats.map(s => (
                      <div key={s.label}>
                        <p className="text-slate-500 dark:text-slate-500 text-slate-400 text-[10px] uppercase font-semibold">{s.label}</p>
                        <p className="text-white dark:text-white text-slate-900 text-sm font-bold font-mono">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="absolute bottom-5 right-5 text-slate-600 dark:text-slate-600 text-slate-400 group-hover:text-cyan-400 dark:group-hover:text-cyan-400 group-hover:text-blue-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 pt-8 flex items-center justify-between text-xs text-slate-600">
          <span>Fleet360  v2.0.0</span>
          <span>Next.js 15 · PostgreSQL · Prisma</span>
        </div>
      </div>
    </div>
  );
}
