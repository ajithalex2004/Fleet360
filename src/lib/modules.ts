/**
 * Module Registry — single source of truth for all platform modules.
 *
 * Why this file exists:
 * The codebase had four parallel module taxonomies that drifted apart:
 *   1. src/app/platform/page.tsx       — 21 user-facing modules (kebab-case keys)
 *   2. src/app/admin/tenants/page.tsx  — 9 admin-togglable modules (snake_case keys)
 *   3. src/lib/access-control.ts       — 10 AppModule TS union (different keys again)
 *   4. src/lib/tenant-context.ts       — 6 module→CoA-prefix mappings (SCREAMING_SNAKE)
 *
 * Result: the platform home's footer claimed "16 modules" while the page
 * shipped 21. Adding a module meant editing four files. The drift was
 * structural, not a typo.
 *
 * This file is the canonical registry. All four consumers read from it.
 * It is React-agnostic and Prisma-agnostic so it can be imported from
 * any layer (server, client, edge runtime, test).
 *
 * Adding a module now:
 *   1. Add an entry to MODULES below
 *   2. (If it has tenant-toggleable subscription) add a row to the
 *      admin tenants subscription view
 *   3. (If it has CoA accounts) add accountPrefixes
 *   4. (If it gates routes) the AppModule type picks it up automatically
 *
 * That's it. The platform home, the access-control type union, and the
 * CoA prefix map all derive from this file.
 */

// ── Public types ────────────────────────────────────────────────────────────

/** Canonical kebab-case module key. URL-friendly, used in DB and platform home. */
export type ModuleKey =
  | 'service-tickets'
  | 'agents'
  | 'maintenance'
  | 'leasing'
  | 'rental'
  | 'bus-ops'
  | 'school-bus'
  | 'logistics'
  | 'incidents'
  | 'fleet'
  | 'driver-mgmt'
  | 'customer-mgmt'
  | 'booking-portal'
  | 'finance'
  | 'compliance'
  | 'customer'
  | 'mobile-apps'
  | 'reports'
  | 'dispatch'
  | 'sustainability'
  | 'assets';

/** CoA account-code group. Each module that posts financial entries belongs to one. */
export type AccountPrefixGroup =
  | 'RAC'
  | 'SCHOOL_BUS'
  | 'LOGISTICS'
  | 'LEASING'
  | 'STAFF_TRANSPORT'
  | 'AMBULANCE';

/** Subscription category — controls how a tenant gains access to a module. */
export type ModuleSubscription =
  | 'always-on'        // Bundled with every tenant; cannot be disabled
  | 'toggleable'       // Tenant admin can enable/disable per tenant (subscription matrix)
  | 'enterprise-only'; // Requires ENTERPRISE plan or explicit add-on

/** Release status. Drives the platform home's "LIVE" / "BETA" / "PLANNED" badge. */
export type ModuleStatus = 'live' | 'beta' | 'planned';

export interface ModuleDef {
  /** Canonical kebab-case key. The single source of truth identifier. */
  key: ModuleKey;
  /** Display name on the platform home, KPI tiles, and admin lists. */
  name: string;
  /** Compact name for tight UI (KPI cards, breadcrumbs, navigation). */
  shortName?: string;
  /** Long description (platform home module cards). */
  description: string;
  /** Default landing route (relative URL). */
  href: string;
  /** Lucide icon name. Resolved by the consumer via a name→component map. */
  iconName: string;
  /** Tailwind gradient classes for the module card hero strip. */
  gradient: string;
  /** Tailwind shadow/glow utility for the hover state. */
  glow: string;
  /** Tailwind border utility for the card outline. */
  border: string;
  /** Searchable tags (used by the platform home's search box). */
  tags: readonly string[];
  /** Subscription category. */
  subscription: ModuleSubscription;
  /** CoA account-code groups this module posts financial entries to. */
  accountPrefixes?: readonly AccountPrefixGroup[];
  /** Release status. */
  status: ModuleStatus;
  /**
   * API pathname prefixes this module owns. Used by `moduleFromPath()` in
   * `@/lib/access-control` to gate routes by module. Absence means the
   * module has no API surface (pure UI module) and won't be matchable
   * by `moduleFromPath()`. Match is `pathname === prefix || pathname.startsWith(prefix + '/')`.
   */
  apiPathPrefixes?: readonly string[];
}

// ── The registry ───────────────────────────────────────────────────────────

export const MODULES: readonly ModuleDef[] = [
  {
    key: 'service-tickets',
    name: 'Service & Support Ticketing',
    shortName: 'Service Tickets',
    description: 'One-stop ticketing for Maintenance, Renewal, Cleaning, Support, Incident, Towing & Complaint requests — shared SLA, assignment and notification engines with per-tenant access control.',
    href: '/service-tickets',
    iconName: 'Headphones',
    gradient: 'from-violet-600 to-purple-600',
    glow: 'shadow-violet-500/20',
    border: 'border-violet-500/30',
    tags: ['7 Ticket Types', 'SLA', 'Assignment', 'Audit Trail'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'agents',
    name: 'AI Agent Ecosystem',
    shortName: 'AI Agents',
    description: '10 autonomous AI agents — predictive maintenance, route optimisation, incident triage, smart dispatch, driver coaching, demand forecasting, WhatsApp AI, and more. Inline approvals, threshold tuning, and live activity feed.',
    href: '/agents',
    iconName: 'Bot',
    gradient: 'from-violet-600 to-purple-700',
    glow: 'shadow-violet-500/20',
    border: 'border-violet-500/30',
    tags: ['Predictive AI', 'Auto-Triage', 'Smart Dispatch', 'WhatsApp AI'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'maintenance',
    name: 'Vehicle Maintenance',
    shortName: 'Maintenance',
    description: 'Full lifecycle maintenance workflow — service requests, quotations, work orders, invoices, predictive analytics',
    href: '/maintenance',
    iconName: 'Wrench',
    gradient: 'from-blue-600 to-indigo-600',
    glow: 'shadow-blue-500/20',
    border: 'border-blue-500/30',
    tags: ['Workflow', 'Quotations', 'Work Orders', 'Analytics'],
    subscription: 'toggleable',
    status: 'live',
  },
  {
    key: 'leasing',
    name: 'Vehicle Leasing',
    shortName: 'Leasing',
    description: 'Long-term lease contract management, payment schedules, lessee profiles, vehicle returns',
    href: '/leasing',
    iconName: 'FileText',
    gradient: 'from-violet-600 to-purple-600',
    glow: 'shadow-violet-500/20',
    border: 'border-violet-500/30',
    tags: ['Contracts', 'Lessees', 'Renewals', 'Returns'],
    subscription: 'toggleable',
    accountPrefixes: ['LEASING'],
    status: 'live',
    apiPathPrefixes: ['/api/leasing'],
  },
  {
    key: 'rental',
    name: 'Rent-a-Car',
    shortName: 'RAC',
    description: 'Short-term vehicle rentals, booking engine, customer KYC, dynamic pricing, damage claims',
    href: '/rental',
    iconName: 'Car',
    gradient: 'from-emerald-600 to-teal-600',
    glow: 'shadow-emerald-500/20',
    border: 'border-emerald-500/30',
    tags: ['Bookings', 'Customers', 'Pricing', 'Damage Claims'],
    subscription: 'toggleable',
    accountPrefixes: ['RAC'],
    status: 'live',
    apiPathPrefixes: ['/api/rac'],
  },
  {
    key: 'bus-ops',
    name: 'Staff Transportation',
    shortName: 'Bus Ops',
    description: 'Bus route management, trip scheduling, passenger roster, boarding tracking, dispatch board',
    href: '/bus-ops',
    iconName: 'Bus',
    gradient: 'from-purple-600 to-pink-600',
    glow: 'shadow-purple-500/20',
    border: 'border-purple-500/30',
    tags: ['Routes', 'Schedules', 'Passengers', 'Dispatch'],
    subscription: 'toggleable',
    accountPrefixes: ['STAFF_TRANSPORT'],
    status: 'live',
    apiPathPrefixes: ['/api/staff'],
  },
  {
    key: 'school-bus',
    name: 'School Bus Transportation',
    shortName: 'School Bus',
    description: 'Student registry, RFID attendance tracking, guardian notifications, safety compliance and trip scheduling',
    href: '/school-bus',
    iconName: 'School',
    gradient: 'from-yellow-500 to-amber-500',
    glow: 'shadow-yellow-500/20',
    border: 'border-yellow-500/30',
    tags: ['Students', 'Routes', 'Safety', 'Attendance'],
    subscription: 'toggleable',
    accountPrefixes: ['SCHOOL_BUS'],
    status: 'live',
    apiPathPrefixes: ['/api/school-bus', '/api/students', '/api/routes'],
  },
  {
    key: 'logistics',
    name: 'Logistics Management',
    shortName: 'Logistics',
    description: 'End-to-end logistics shipment management - fleet dispatch, delivery tracking, route optimization, carrier execution',
    href: '/logistics',
    iconName: 'Truck',
    gradient: 'from-amber-600 to-yellow-600',
    glow: 'shadow-amber-500/20',
    border: 'border-amber-500/30',
    tags: ['Dispatch', 'Delivery', 'Routing', 'Fleet'],
    subscription: 'toggleable',
    accountPrefixes: ['LOGISTICS'],
    status: 'live',
    apiPathPrefixes: ['/api/logistics', '/api/trips'],
  },
  {
    key: 'incidents',
    name: 'Incident & Ambulance',
    shortName: 'Incidents',
    description: 'Real-time incident reporting, ambulance dispatch, emergency response coordination and compliance tracking',
    href: '/incidents',
    iconName: 'Siren',
    gradient: 'from-red-600 to-rose-600',
    glow: 'shadow-red-500/20',
    border: 'border-red-500/30',
    tags: ['Emergency', 'Ambulance', 'Compliance', 'Safety'],
    subscription: 'toggleable',
    accountPrefixes: ['AMBULANCE'],
    status: 'live',
    apiPathPrefixes: ['/api/ambulance', '/api/incidents'],
  },
  {
    key: 'fleet',
    name: 'Fleet Management',
    shortName: 'Fleet',
    description: 'Vehicle document vault, fuel management, traffic fines, TCO analysis, asset lifecycle tracking',
    href: '/fleet',
    iconName: 'CarFront',
    gradient: 'from-orange-600 to-amber-600',
    glow: 'shadow-orange-500/20',
    border: 'border-orange-500/30',
    tags: ['Documents', 'Fuel Logs', 'Fines', 'TCO'],
    subscription: 'toggleable',
    status: 'live',
    apiPathPrefixes: ['/api/vehicles', '/api/fleet', '/api/drivers'],
  },
  {
    key: 'driver-mgmt',
    name: 'Driver Management',
    shortName: 'Drivers',
    description: 'Driver onboarding, document tracking, shift management, training records, performance scoring',
    href: '/driver-mgmt',
    iconName: 'UserCog',
    gradient: 'from-cyan-600 to-blue-600',
    glow: 'shadow-cyan-500/20',
    border: 'border-cyan-500/30',
    tags: ['Onboarding', 'Shifts', 'Training', 'Performance'],
    subscription: 'toggleable',
    status: 'live',
  },
  {
    key: 'customer-mgmt',
    name: 'Customer Management',
    shortName: 'Customers',
    description: 'Customer master with 3-level hierarchy (Region, Department, Unit), financial & billing settings',
    href: '/customer-mgmt',
    iconName: 'Building2',
    gradient: 'from-cyan-600 to-blue-600',
    glow: 'shadow-cyan-500/20',
    border: 'border-cyan-500/30',
    tags: ['Hierarchy', 'Billing', 'Bookings', 'Communication'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'booking-portal',
    name: 'Booking Portal',
    shortName: 'Bookings',
    description: 'Unified self-service booking across all transport services — rentals, leasing, shuttles, executive vehicles',
    href: '/booking-portal',
    iconName: 'Smartphone',
    gradient: 'from-indigo-600 to-violet-600',
    glow: 'shadow-indigo-500/20',
    border: 'border-indigo-500/30',
    tags: ['Self-Service', 'Approvals', 'Multi-Service'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'finance',
    name: 'Finance & Billing',
    shortName: 'Finance',
    description: 'Invoicing, payment processing, credit notes, VAT compliance (UAE 5%), budget vs actual tracking',
    href: '/finance',
    iconName: 'Banknote',
    gradient: 'from-green-600 to-emerald-600',
    glow: 'shadow-green-500/20',
    border: 'border-green-500/30',
    tags: ['Invoices', 'Payments', 'VAT', 'Budgets'],
    subscription: 'toggleable',
    status: 'live',
    apiPathPrefixes: ['/api/finance', '/api/invoice'],
  },
  {
    key: 'compliance',
    name: 'Compliance & Regulatory',
    shortName: 'Compliance',
    description: 'RTA compliance, insurance policies, road permits, Salik accounts, regulatory document tracking',
    href: '/compliance',
    iconName: 'Scale',
    gradient: 'from-rose-600 to-red-600',
    glow: 'shadow-rose-500/20',
    border: 'border-rose-500/30',
    tags: ['RTA', 'Insurance', 'Permits', 'Salik'],
    subscription: 'toggleable',
    status: 'live',
  },
  {
    key: 'customer',
    name: 'Customer App',
    shortName: 'Customer',
    description: 'Mobile-first portal for renters, lessees and staff — bookings, shuttle schedules, account management',
    href: '/customer',
    iconName: 'Smartphone',
    gradient: 'from-sky-600 to-cyan-600',
    glow: 'shadow-sky-500/20',
    border: 'border-sky-500/30',
    tags: ['PWA', 'Mobile', 'Self-Service'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'mobile-apps',
    name: 'Mobile Apps',
    shortName: 'Mobile',
    description: 'Fleet360 PWA gallery — Driver, Passenger, Counter, Field-Ops. Install once on the phone, work offline-cached, scope-locked per role.',
    href: '/mobile-apps',
    iconName: 'AppWindow',
    gradient: 'from-fuchsia-600 to-pink-600',
    glow: 'shadow-fuchsia-500/20',
    border: 'border-fuchsia-500/30',
    tags: ['Fleet360', 'PWA', 'Driver', 'Passenger', 'Field'],
    subscription: 'always-on',
    status: 'live',
  },
  {
    key: 'reports',
    name: 'Reports & Analytics',
    shortName: 'Reports',
    description: 'Cross-module BI — fleet utilization, revenue analysis, driver performance, scheduled report exports',
    href: '/reports',
    iconName: 'BarChart3',
    gradient: 'from-fuchsia-600 to-indigo-600',
    glow: 'shadow-fuchsia-500/20',
    border: 'border-fuchsia-500/30',
    tags: ['Fleet', 'Revenue', 'Drivers', 'Power BI'],
    subscription: 'toggleable',
    status: 'live',
  },
  {
    key: 'dispatch',
    name: 'Dispatch Control',
    shortName: 'Dispatch',
    description: 'Real-time dispatch command centre — auto-dispatch engine, trip merge optimizer, job queue, driver availability, school bus & ambulance dispatch',
    href: '/dispatch',
    iconName: 'Radio',
    gradient: 'from-blue-600 to-cyan-600',
    glow: 'shadow-blue-500/20',
    border: 'border-blue-500/30',
    tags: ['Command Centre', 'Auto-Dispatch', 'Merge Optimizer', 'Live Map'],
    subscription: 'always-on',
    status: 'live',
    apiPathPrefixes: ['/api/dispatch'],
  },
  {
    key: 'sustainability',
    name: 'Sustainability & ESG',
    shortName: 'ESG',
    description: 'GHG Protocol / ISO 14064 verified CO₂ measurement — Scope 1/2/3 emissions, modal shift, fleet decarbonisation and UAE Net Zero 2050 compliance',
    href: '/sustainability',
    iconName: 'Leaf',
    gradient: 'from-emerald-500 to-green-600',
    glow: 'shadow-emerald-500/20',
    border: 'border-emerald-500/30',
    tags: ['GHG Protocol', 'ISO 14064', 'UAE Net Zero', 'ESG'],
    subscription: 'enterprise-only',
    status: 'live',
  },
  {
    key: 'assets',
    name: 'Assets & Inventory',
    shortName: 'Assets',
    description: 'Unified cross-domain asset registry — HVA tracking with calibration & insurance, medical supplies with seal logs, BLE tagging, stock management, field dispatch, and reverse logistics',
    href: '/assets',
    iconName: 'Package',
    gradient: 'from-cyan-600 to-teal-600',
    glow: 'shadow-cyan-500/20',
    border: 'border-cyan-500/30',
    tags: ['HVA', 'BLE Tracking', 'Medical', 'Stock Ops'],
    subscription: 'always-on',
    status: 'live',
  },
];

// ── Derived lookups ────────────────────────────────────────────────────────

/** O(1) lookup by canonical key. */
export const MODULE_BY_KEY: Readonly<Record<ModuleKey, ModuleDef>> = MODULES.reduce(
  (acc, m) => {
    acc[m.key] = m;
    return acc;
  },
  {} as Record<ModuleKey, ModuleDef>,
);

/** Legacy alias map — old code stored these values in `tenants.allowedModules` and other places. */
export const LEGACY_MODULE_ALIASES: Readonly<Record<string, ModuleKey>> = {
  rac: 'rental',
  bus_ops: 'bus-ops',
  drivers: 'driver-mgmt',
  staff: 'bus-ops',
  ambulance: 'incidents',
  school_bus: 'school-bus',
};

/** Resolve any string (canonical or legacy alias) to a ModuleKey, or null. */
export function resolveModuleKey(s: string): ModuleKey | null {
  if (s in MODULE_BY_KEY) return s as ModuleKey;
  if (s in LEGACY_MODULE_ALIASES) return LEGACY_MODULE_ALIASES[s];
  return null;
}

/** All modules with `subscription === 'toggleable'`. */
export const TOGGLEABLE_MODULES: readonly ModuleDef[] = MODULES.filter(
  (m) => m.subscription === 'toggleable',
);

/** All modules with `subscription === 'always-on'`. */
export const ALWAYS_ON_MODULES: readonly ModuleDef[] = MODULES.filter(
  (m) => m.subscription === 'always-on',
);

/** All modules with `subscription === 'enterprise-only'`. */
export const ENTERPRISE_ONLY_MODULES: readonly ModuleDef[] = MODULES.filter(
  (m) => m.subscription === 'enterprise-only',
);

/** Count of live modules. Drives the platform home footer / stats card. */
export const LIVE_MODULE_COUNT: number = MODULES.filter((m) => m.status === 'live').length;

// ── CoA account-code map (derived) ─────────────────────────────────────────

/**
 * Maps each CoA account group to its income + direct-cost prefixes.
 * Drives `tenant-context.ts#MODULE_ACCOUNT_PREFIXES` and any finance
 * integration that filters GL postings by module.
 */
export const ACCOUNT_CODE_PREFIXES: Readonly<Record<AccountPrefixGroup, readonly string[]>> = {
  RAC:             ['4100', '5110', '5120'],
  SCHOOL_BUS:      ['4400', '5140'],
  LOGISTICS:       ['4300', '5130'],
  LEASING:         ['4200', '5115'],
  STAFF_TRANSPORT: ['4500', '5145'],
  AMBULANCE:       ['4600', '5160'],
};

/** Reverse map: account-code prefix → module key (for finance-side lookup). */
export const PREFIX_TO_MODULE: Readonly<Record<string, ModuleKey>> = (() => {
  const out: Record<string, ModuleKey> = {};
  for (const m of MODULES) {
    if (!m.accountPrefixes) continue;
    for (const grp of m.accountPrefixes) {
      const moduleByGroup: Record<AccountPrefixGroup, ModuleKey> = {
        RAC:             'rental',
        SCHOOL_BUS:      'school-bus',
        LOGISTICS:       'logistics',
        LEASING:         'leasing',
        STAFF_TRANSPORT: 'bus-ops',
        AMBULANCE:       'incidents',
      };
      const moduleKey = moduleByGroup[grp];
      for (const prefix of ACCOUNT_CODE_PREFIXES[grp]) {
        out[prefix] = moduleKey;
      }
    }
  }
  return out;
})();

// ── Search helper ──────────────────────────────────────────────────────────

/** Case-insensitive search across name, description, and tags. */
export function searchModules(query: string): readonly ModuleDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return MODULES;
  return MODULES.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
