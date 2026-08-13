/**
 * Global navigation registry — single source of truth for the collapsible
 * sidebar and the platform module tiles.
 *
 * Each MODULE has a top-level icon + landing href. Sub-pages drive the
 * second-level list (shown in the sidebar's flyout when collapsed, and
 * indented under the active module when expanded). Each sub-page click
 * opens a workspace tab.
 *
 * Adding a module here is sufficient — the sidebar picks it up, the tab
 * system can pin it, and (over time) the /platform tiles can read this
 * same array instead of duplicating it.
 */

import {
  LayoutDashboard, Headphones, Bot, Wrench, FileText, Car, Bus, School,
  Truck, Siren, CarFront, UserCog, Building2, Smartphone, Banknote, Scale,
  AppWindow, BarChart3, Settings, Radio, Leaf, Package,
  Radar, Route, Gavel, Users, ClipboardList, MapPin, Receipt, ShieldCheck,
  Shield, CreditCard,   BookOpen, RefreshCw, ArrowLeftRight, Fuel, AlertTriangle,
  GraduationCap, Trophy, Calendar, Workflow, Eye, Bell, Mail, Activity,
  Calculator, Repeat, Wallet, DollarSign, Lock, Network, Sliders, FileSearch,
  Sparkles, MessageCircle, Tag, History, CheckCircle2, PieChart, Brain,
  Paperclip, Send, Info, Pin, FileMinus, Target, BookText, TrendingUp, Clock,
  CalendarCheck2,
  Gauge,
  type LucideIcon,
} from 'lucide-react';

export interface SubPage {
  /** Display label in the sidebar / tab. Sentence case. */
  label: string;
  /** Next.js route. The active sub-page is matched by exact pathname. */
  href: string;
  /** Optional Lucide icon — falls back to the parent module's icon in tabs. */
  icon?: LucideIcon;
  /**
   * Hide this sub-page from the sidebar unless the user has roleCode
   * 'SUPER_ADMIN'. The page itself is still reachable by URL (the API-side
   * permission checks remain authoritative); this just keeps the sidebar
   * uncluttered for tenant admins who can't act on it.
   */
  superOnly?: boolean;
  /**
   * Optional group heading (uppercase caption) rendered above this row and
   * every subsequent row that shares the same group value, until the group
   * changes or ends. Undefined leaves the item ungrouped (rendered flush at
   * the top of the module's list — used for Dashboard-style landing rows).
   * Order matters: sort sub-pages by group in the desired display order.
   */
  group?: string;
}

export interface ModuleDef {
  id: string;
  /** Display label in the sidebar. Sentence case. */
  label: string;
  /** Landing href when the module is clicked directly. */
  href: string;
  icon: LucideIcon;
  /** Optional sub-pages (sidebar flyout / inline sub-list). */
  subPages?: SubPage[];
}

export const MODULES: ModuleDef[] = [
  { id: 'service-tickets', label: 'Service tickets', href: '/service-tickets', icon: Headphones },
  { id: 'agents',          label: 'AI agents',       href: '/agents',          icon: Bot },
  {
    id: 'ai-platform', label: 'AI platform', href: '/ai-platform', icon: Brain,
    subPages: [
      { label: 'Predictive maintenance', href: '/ai-platform/predictive', icon: Sparkles },
    ],
  },

  {
    id: 'maintenance', label: 'Maintenance', href: '/maintenance', icon: Wrench,
    subPages: [
      { label: 'Dashboard',           href: '/maintenance',                    icon: LayoutDashboard },
      { label: 'Requests list',       href: '/maintenance/requests',           icon: ClipboardList },
      { label: 'Maintenance history', href: '/maintenance/history',            icon: History },
      { label: 'Approvals',           href: '/maintenance/approvals',          icon: CheckCircle2 },
      { label: 'Analytics',           href: '/maintenance/analytics',          icon: BarChart3 },
      { label: 'Work orders',         href: '/maintenance/work-orders',        icon: Wrench },
      // PM Engine
      { label: 'PM plans',            href: '/maintenance/pm-plans',           icon: ClipboardList },
      { label: 'Schedule',            href: '/maintenance/schedule',           icon: Calendar },
      // Read-only consumer views (domains owned by external modules)
      { label: 'Garage assignments',  href: '/maintenance/garage-assignments', icon: Building2 },
      { label: 'Predictive alerts',   href: '/maintenance/predictive-alerts',  icon: Sparkles },
      // Phase C
      { label: 'Warranties',          href: '/maintenance/warranty',           icon: ShieldCheck },
      // Phase E
      { label: 'Breakdowns',          href: '/maintenance/breakdown',          icon: AlertTriangle },
      // Phase F
      { label: 'SLA',                 href: '/maintenance/sla',                icon: TrendingUp },
      // Phase G
      { label: 'Risk scores',         href: '/maintenance/risk',               icon: Gauge },
    ],
  },

  {
    id: 'leasing', label: 'Leasing', href: '/leasing', icon: FileText,
    subPages: [
      { label: 'Dashboard',           href: '/leasing',                     icon: LayoutDashboard },
      { label: 'Inquiries',           href: '/leasing/inquiries',           icon: MessageCircle },
      { label: 'Quotations',          href: '/leasing/quotations',          icon: FileText },
      { label: 'Credit assessments',  href: '/leasing/credit-assessments',  icon: ShieldCheck },
      { label: 'Lease agreements',    href: '/leasing/contracts-v2',        icon: FileText },
      { label: 'Amendments',          href: '/leasing/amendments',          icon: RefreshCw },
      { label: 'Renewals',            href: '/leasing/renewals',            icon: RefreshCw },
      { label: 'Early terminations',  href: '/leasing/early-terminations',  icon: AlertTriangle },
      { label: 'Mileage',             href: '/leasing/mileage',             icon: Activity },
      { label: 'Drivers',             href: '/leasing/drivers',             icon: UserCog },
      { label: 'Alerts',              href: '/leasing/alerts',              icon: Bell },
      { label: 'Analytics',           href: '/leasing/analytics',           icon: BarChart3 },
    ],
  },
  {
    id: 'rental', label: 'Rent-a-Car', href: '/rental', icon: Car,
    subPages: [
      { label: 'Dashboard',     href: '/rental',               icon: LayoutDashboard },
      { label: 'Counter',       href: '/rental/counter',       icon: Smartphone },
      { label: 'Inquiries',     href: '/rental/inquiries',     icon: MessageCircle },
      { label: 'Quotations',    href: '/rental/quotations',    icon: FileText },
      { label: 'Bookings',      href: '/rental/bookings',      icon: Calendar },
      { label: 'Agreements',    href: '/rental/agreements',    icon: FileText },
      { label: 'Handover',      href: '/rental/handover',      icon: Send },
      { label: 'Renewals',      href: '/rental/renewals',      icon: RefreshCw },
      { label: 'Damage claims', href: '/rental/damage-claims', icon: AlertTriangle },
      { label: 'Invoices',      href: '/rental/invoices',      icon: Receipt },
      { label: 'Ancillaries',   href: '/rental/ancillaries',   icon: Tag },
      { label: 'Pricing',       href: '/rental/pricing',       icon: DollarSign },
      { label: 'Rates',         href: '/rental/rates',         icon: Tag },
      { label: 'Availability',  href: '/rental/availability',  icon: Calendar },
      { label: 'Channels',      href: '/rental/channels',      icon: Network },
      { label: 'Customers',     href: '/rental/customers',     icon: Users },
      { label: 'Documents',     href: '/rental/documents',     icon: FileText },
      { label: 'Insurance',     href: '/rental/insurance',     icon: Shield },
      { label: 'Branches',      href: '/rental/branches',      icon: Building2 },
      { label: 'Staff',         href: '/rental/staff',         icon: Users },
      { label: 'Transfers',     href: '/rental/transfers',     icon: ArrowLeftRight },
      { label: 'Alerts',        href: '/rental/alerts',        icon: Bell },
      { label: 'Analytics',     href: '/rental/analytics',     icon: BarChart3 },
    ],
  },
  {
    id: 'locations', label: 'Locations', href: '/locations', icon: MapPin,
    // Shared geospatial catalogue — one row = one Place from spatial.places.
    // Every module reads/writes here; the in-page filter picks the type.
    // Per-type sidebar shortcuts (Stops / Geofences / Depots / …) will land
    // in Phase 2 once the sub-page router supports querystring matching.
  },

  {
    id: 'bus-ops', label: 'Staff transport', href: '/bus-ops', icon: Bus,
    subPages: [
      // Overview — no group; Dashboard sits flush at the top.
      { label: 'Dashboard',           href: '/bus-ops',                     icon: LayoutDashboard },

      // Planning — design-time network (what the service *looks like*).
      { label: 'Routes',              href: '/bus-ops/routes',              icon: Route,           group: 'Planning' },
      { label: 'Route planner',       href: '/bus-ops/route-planner',       icon: Route,           group: 'Planning' },
      { label: 'Schedules',           href: '/bus-ops/schedules',           icon: Calendar,        group: 'Planning' },
      { label: 'Schedule Templates',  href: '/bus-ops/schedule-templates',  icon: Repeat,          group: 'Planning' },
      { label: 'Transport Calendars', href: '/bus-ops/transport-calendars', icon: CalendarCheck2,  group: 'Planning' },

      // Operations — day-of-service execution.
      { label: 'Trip Monitor',        href: '/bus-ops/dispatch',            icon: Radio,           group: 'Operations' },
      { label: 'Optimisation Status', href: '/bus-ops/optimisation',        icon: Sparkles,        group: 'Operations' },
      { label: 'Demand forecast',     href: '/bus-ops/demand-forecast',     icon: TrendingUp,      group: 'Operations' },

      // Tracking — real-time telemetry / geospatial infrastructure.
      { label: 'Live Fleet Map',      href: '/bus-ops/live-map',            icon: Radar,           group: 'Tracking' },
      { label: 'Geofences',           href: '/bus-ops/geofences',           icon: MapPin,          group: 'Tracking' },
      { label: 'Gateways',            href: '/bus-ops/gateways',            icon: Network,         group: 'Tracking' },

      // Workforce — passengers + drivers + roster.
      { label: 'Passengers',          href: '/bus-ops/passengers',          icon: Users,           group: 'Workforce' },
      { label: 'Employees',           href: '/bus-ops/staff',               icon: Users,           group: 'Workforce' },
      { label: 'Drivers Performance', href: '/bus-ops/drivers',             icon: UserCog,         group: 'Workforce' },

      // Requests — inbound demand / exceptions.
      { label: 'Transport requests',  href: '/bus-ops/transport-requests',  icon: ClipboardList,   group: 'Requests' },
      { label: 'Incidents',           href: '/bus-ops/incidents',           icon: AlertTriangle,   group: 'Requests' },

      // Analytics — after-the-fact reporting.
      { label: 'Analytics',           href: '/bus-ops/analytics',           icon: BarChart3,       group: 'Analytics' },
    ],
  },
  {
    id: 'school-bus', label: 'School bus', href: '/school-bus', icon: School,
    subPages: [
      { label: 'Dashboard',         href: '/school-bus',                   icon: LayoutDashboard },
      { label: 'Students',          href: '/school-bus/students',          icon: GraduationCap },
      { label: 'Attendance',        href: '/school-bus/attendance',        icon: CheckCircle2 },
      { label: 'Routes',            href: '/school-bus/routes',            icon: Route },
      { label: 'Route planner',     href: '/school-bus/route-planner',     icon: Route },
      { label: 'Stops',             href: '/school-bus/stops',             icon: MapPin },
      { label: 'Schedules',         href: '/school-bus/schedules',         icon: Calendar },
      { label: 'Trips',             href: '/school-bus/trips',             icon: Truck },
      { label: 'Live map',          href: '/school-bus/live-map',          icon: MapPin },
      { label: 'Allocations',       href: '/school-bus/allocations',       icon: Pin },
      { label: 'Seat availability', href: '/school-bus/seat-availability', icon: Calendar },
      { label: 'Attendants',        href: '/school-bus/attendants',        icon: Users },
      { label: 'Driver scores',     href: '/school-bus/driver-scores',     icon: Trophy },
      { label: 'Dispatch',          href: '/school-bus/dispatch',          icon: Radio },
      { label: 'Fees',              href: '/school-bus/fees',              icon: DollarSign },
      { label: 'Intelligence',      href: '/school-bus/intelligence',      icon: Brain },
      { label: 'Reports',           href: '/school-bus/reports',           icon: FileText },
      { label: 'Analytics',         href: '/school-bus/analytics',         icon: BarChart3 },
    ],
  },

  {
    id: 'logistics', label: 'Logistics', href: '/logistics', icon: Truck,
    subPages: [
      { label: 'Dashboard',           href: '/logistics',                   icon: LayoutDashboard },
      { label: 'Control tower',       href: '/logistics/control-tower',     icon: Radar },
      { label: 'Dispatch board',      href: '/logistics/dispatch',          icon: Route },
      { label: 'Freight marketplace', href: '/logistics/marketplace',       icon: Gavel },
      { label: 'Carrier network',     href: '/logistics/carriers',          icon: Building2 },
      { label: 'Shippers',            href: '/logistics/shippers',          icon: Users },
      { label: 'Shipping requests',   href: '/logistics/shipping-requests', icon: ClipboardList },
      { label: 'Route optimizer',     href: '/logistics/planner',           icon: Route },
      { label: 'Shipment orders',     href: '/logistics/trips',             icon: Truck },
      { label: 'Vehicles',            href: '/logistics/vehicles',          icon: CarFront },
      { label: 'Drivers',             href: '/logistics/drivers',           icon: UserCog },
      { label: 'Live tracking',       href: '/logistics/tracking',          icon: MapPin },
      { label: 'Freight quotes',      href: '/logistics/quotes',            icon: FileText },
      { label: 'Rate contracts',      href: '/logistics/rate-contracts',    icon: FileText },
      { label: 'Settlements',         href: '/logistics/settlements',       icon: Receipt },
      { label: 'Analytics',           href: '/logistics/analytics',         icon: BarChart3 },
    ],
  },

  {
    id: 'incidents', label: 'Incidents', href: '/incidents', icon: Siren,
    subPages: [
      { label: 'Dashboard', href: '/incidents',           icon: LayoutDashboard },
      { label: 'Active',    href: '/incidents/active',    icon: AlertTriangle },
      { label: 'Ambulance', href: '/incidents/ambulance', icon: Send },
      { label: 'Reports',   href: '/incidents/reports',   icon: FileText },
    ],
  },

  {
    id: 'fleet', label: 'Fleet', href: '/fleet', icon: CarFront,
    subPages: [
      { label: 'Dashboard',             href: '/fleet',                icon: LayoutDashboard },
      { label: 'Vehicle master',        href: '/fleet/vehicles',       icon: Car },
      { label: 'Vehicle types',         href: '/fleet/vehicle-types',  icon: Tag },
      { label: 'Lifecycle events',      href: '/fleet/lifecycle',      icon: RefreshCw },
      { label: 'Work orders',           href: '/fleet/work-orders',    icon: Wrench },
      { label: 'Allocations',           href: '/fleet/allocations',    icon: Pin },
      { label: 'Transfers',             href: '/fleet/transfers',      icon: ArrowLeftRight },
      { label: 'Insurance',             href: '/fleet/insurance',      icon: Shield },
      { label: 'Documents',             href: '/fleet/documents',      icon: FileText },
      { label: 'Hours of service',      href: '/fleet/hos',            icon: Clock },
      { label: 'Fuel logs',             href: '/fleet/fuel',           icon: Fuel },
      { label: 'Traffic fines',         href: '/fleet/fines',          icon: AlertTriangle },
      { label: 'TCO analysis',          href: '/fleet/tco',            icon: PieChart },
      { label: 'Predictive maintenance', href: '/fleet/intelligence',  icon: Brain },
    ],
  },

  {
    id: 'vendors', label: 'Vendors', href: '/vendors', icon: Building2,
    subPages: [
      { label: 'Garage management', href: '/vendors/garages',       icon: Building2 },
      { label: 'Garage portal',     href: '/vendors/garage-portal', icon: Send },
    ],
  },

  {
    id: 'driver-mgmt', label: 'Drivers', href: '/driver-mgmt', icon: UserCog,
    subPages: [
      { label: 'Dashboard',    href: '/driver-mgmt',             icon: LayoutDashboard },
      { label: 'Profiles',     href: '/driver-mgmt/profiles',    icon: Users },
      { label: 'Documents',    href: '/driver-mgmt/documents',   icon: FileText },
      { label: 'Shifts',       href: '/driver-mgmt/shifts',      icon: Calendar },
      { label: 'Training',     href: '/driver-mgmt/training',    icon: GraduationCap },
      { label: 'Performance',  href: '/driver-mgmt/performance', icon: Trophy },
    ],
  },

  {
    id: 'customer-mgmt', label: 'Customers', href: '/customer-mgmt', icon: Building2,
    subPages: [
      { label: 'Customers',       href: '/customer-mgmt',           icon: Users },
      { label: 'Hierarchy setup', href: '/customer-mgmt/hierarchy', icon: Network },
    ],
  },

  {
    id: 'booking-portal', label: 'Booking portal', href: '/booking-portal', icon: Smartphone,
    subPages: [
      { label: 'Dashboard',   href: '/booking-portal',             icon: LayoutDashboard },
      { label: 'New booking', href: '/booking-portal/new',         icon: Send },
      { label: 'My bookings', href: '/booking-portal/my-bookings', icon: BookOpen },
      { label: 'Approvals',   href: '/booking-portal/approvals',   icon: CheckCircle2 },
    ],
  },
  {
    id: 'dispatch', label: 'Dispatch', href: '/dispatch', icon: Radio,
    subPages: [
      { label: 'Dashboard',  href: '/dispatch',            icon: LayoutDashboard },
      { label: 'Command',    href: '/dispatch/command',    icon: Radio },
      { label: 'Jobs',       href: '/dispatch/jobs',       icon: ClipboardList },
      { label: 'Ambulance',  href: '/dispatch/ambulance',  icon: Send },
      { label: 'School bus', href: '/dispatch/school-bus', icon: School },
      { label: 'Merge',      href: '/dispatch/merge',      icon: Network },
      { label: 'Analytics',  href: '/dispatch/analytics',  icon: BarChart3 },
    ],
  },

  {
    id: 'finance', label: 'Finance', href: '/finance', icon: Banknote,
    subPages: [
      { label: 'Dashboard',            href: '/finance',                     icon: LayoutDashboard },
      { label: 'Invoices',             href: '/finance/invoices',            icon: FileText },
      { label: 'Recurring invoices',   href: '/finance/recurring-invoices',  icon: Repeat },
      { label: 'Payments',             href: '/finance/payments',            icon: CreditCard },
      { label: 'Credit notes',         href: '/finance/credit-notes',        icon: FileMinus },
      { label: 'AR aging',             href: '/finance/ar-aging',            icon: Clock },
      { label: 'Collections',          href: '/finance/collections',         icon: MessageCircle },
      { label: 'Payment reminders',    href: '/finance/payment-reminders',   icon: Bell },
      { label: 'PDC register',         href: '/finance/pdc',                 icon: CreditCard },
      { label: 'Tax engine',           href: '/finance/tax',                 icon: Calculator },
      { label: 'VAT returns',          href: '/finance/vat',                 icon: Receipt },
      { label: 'VAT by branch',        href: '/finance/vat-branch',          icon: MapPin },
      { label: 'Branch P&L',           href: '/finance/branch-pl',           icon: PieChart },
      { label: 'Security deposits',    href: '/finance/deposits',            icon: Wallet },
      { label: 'Expense management',   href: '/finance/expenses',            icon: DollarSign },
      { label: 'Bank reconciliation',  href: '/finance/bank-reconciliation', icon: Banknote },
      { label: 'Budget vs actual',     href: '/finance/budgets',             icon: Target },
      { label: 'Chart of accounts',    href: '/finance/coa',                 icon: BookOpen },
      { label: 'Journal entries',      href: '/finance/journal-entries',     icon: BookText },
      { label: 'General ledger',       href: '/finance/general-ledger',      icon: BookOpen },
      { label: 'Fixed assets',         href: '/finance/fixed-assets',        icon: Building2 },
      { label: 'Income statement',     href: '/finance/management-accounts', icon: TrendingUp },
      { label: 'Revenue analysis',     href: '/finance/revenue-analysis',    icon: BarChart3 },
      { label: 'Balance sheet',        href: '/finance/balance-sheet',       icon: Scale },
      { label: 'Corporate tax (UAE)',  href: '/finance/corporate-tax',       icon: Building2 },
      { label: 'Budget approvals',     href: '/finance/budget-approvals',    icon: CheckCircle2 },
      { label: 'Period locking',       href: '/finance/period-locks',        icon: Lock },
      { label: 'Audit log',            href: '/finance/audit-log',           icon: FileSearch },
      { label: 'Anomaly detection',    href: '/finance/anomalies',           icon: AlertTriangle },
    ],
  },

  {
    id: 'compliance', label: 'Compliance', href: '/compliance', icon: ShieldCheck,
    subPages: [
      { label: 'Dashboard', href: '/compliance',           icon: LayoutDashboard },
      { label: 'Documents', href: '/compliance/documents', icon: FileText },
      { label: 'Insurance', href: '/compliance/insurance', icon: Shield },
      { label: 'Permits',   href: '/compliance/permits',   icon: FileText },
      { label: 'Salik',     href: '/compliance/salik',     icon: CreditCard },
    ],
  },
  { id: 'mobile-apps',  label: 'Mobile apps',   href: '/mobile-apps',   icon: AppWindow },
  {
    id: 'reports', label: 'Reports', href: '/reports', icon: BarChart3,
    subPages: [
      { label: 'Dashboard',          href: '/reports',                    icon: LayoutDashboard },
      { label: 'Fleet utilisation',  href: '/reports/fleet-utilization',  icon: CarFront },
      { label: 'Revenue',            href: '/reports/revenue',            icon: DollarSign },
      { label: 'Maintenance',        href: '/reports/maintenance',        icon: Wrench },
      { label: 'Driver performance', href: '/reports/driver-performance', icon: Trophy },
      { label: 'Scheduled reports',  href: '/reports/scheduled',          icon: Calendar },
    ],
  },
  {
    id: 'sustainability', label: 'Sustainability', href: '/sustainability', icon: Leaf,
    subPages: [
      { label: 'Dashboard',      href: '/sustainability',                icon: LayoutDashboard },
      { label: 'Fleet carbon',   href: '/sustainability/fleet-carbon',   icon: Leaf },
      { label: 'Modal shift',    href: '/sustainability/modal-shift',    icon: ArrowLeftRight },
      { label: 'Paperless',      href: '/sustainability/paperless',      icon: FileText },
      { label: 'Certifications', href: '/sustainability/certifications', icon: ShieldCheck },
      { label: 'Reports',        href: '/sustainability/reports',        icon: BarChart3 },
      { label: 'Settings',       href: '/sustainability/settings',       icon: Settings },
    ],
  },
  {
    id: 'assets', label: 'Assets', href: '/assets', icon: Package,
    subPages: [
      { label: 'Dashboard',      href: '/assets',                icon: LayoutDashboard },
      { label: 'Registry',       href: '/assets/registry',       icon: ClipboardList },
      { label: 'Categories',     href: '/assets/categories',     icon: Tag },
      { label: 'Stock',          href: '/assets/stock',          icon: Package },
      { label: 'Transactions',   href: '/assets/transactions',   icon: ArrowLeftRight },
      { label: 'Timeline',       href: '/assets/timeline',       icon: History },
      { label: 'Map',            href: '/assets/map',            icon: MapPin },
      { label: 'Dispatch',       href: '/assets/dispatch',       icon: Radio },
      { label: 'HVA',            href: '/assets/hva',            icon: Shield },
      { label: 'Medical',        href: '/assets/medical',        icon: Send },
      { label: 'Personnel',      href: '/assets/personnel',      icon: Users },
      { label: 'Returns',        href: '/assets/returns',        icon: ArrowLeftRight },
      { label: 'SPM',            href: '/assets/spm',            icon: Sliders },
      { label: 'BLE tags',       href: '/assets/ble-tags',       icon: Tag },
      { label: 'BLE zones',      href: '/assets/ble-zones',      icon: MapPin },
      { label: 'BLE gateways',   href: '/assets/ble-gateways',   icon: Network },
      { label: 'BLE detections', href: '/assets/ble-detections', icon: Activity },
      { label: 'BLE alerts',     href: '/assets/ble-alerts',     icon: Bell },
    ],
  },

  {
    id: 'admin', label: 'Admin', href: '/admin', icon: Settings,
    subPages: [
      { label: 'Overview',                href: '/admin',                       icon: LayoutDashboard },
      { label: 'Users',                   href: '/admin/users',                 icon: Users },
      { label: 'Roles & permissions',     href: '/admin/roles',                 icon: Shield },
      { label: 'Branches & regions',      href: '/admin/branches',              icon: Building2 },
      { label: 'Billing & subscriptions', href: '/admin/billing',               icon: CreditCard },
      { label: 'Tenants',                 href: '/admin/tenants',               icon: Building2, superOnly: true },
      { label: 'Service configuration',   href: '/admin/service-config',        icon: Sliders },
      { label: 'Audit log',               href: '/admin/audit-logs',            icon: FileSearch },
      { label: 'Platform settings',       href: '/admin/settings',              icon: Settings },
      { label: 'Alert engine',            href: '/admin/alerts',                icon: Bell },
      { label: 'WhatsApp console',        href: '/admin/whatsapp',              icon: MessageCircle },
      { label: 'Dispatch monitor',        href: '/admin/dispatch',              icon: Radio },
      { label: 'E-signing console',       href: '/admin/esign',                 icon: Eye },
      { label: 'Shipper portal config',   href: '/admin/shipper-portal-config', icon: Sliders },
      { label: 'Platform info',           href: '/admin/info',                  icon: Info, superOnly: true },
      { label: 'Workflow management',     href: '/admin/workflows',             icon: Workflow, superOnly: true },
      { label: 'Subscription',            href: '/admin/subscription',          icon: CreditCard },
      { label: 'Brand preview',           href: '/admin/brand-preview',         icon: Eye, superOnly: true },
    ],
  },
];

/** Look up a module by id. */
export function getModule(id: string | null | undefined): ModuleDef | undefined {
  return id ? MODULES.find(m => m.id === id) : undefined;
}

/**
 * Match a pathname to the module that owns it. Picks the LONGEST href
 * prefix match so e.g. /logistics/marketplace resolves to `logistics`,
 * not the platform root. Returns null for unknown / non-module routes.
 */
export function moduleFromPathname(pathname: string | null | undefined): ModuleDef | null {
  if (!pathname) return null;
  let best: ModuleDef | null = null;
  for (const m of MODULES) {
    if (pathname === m.href || pathname.startsWith(m.href + '/')) {
      if (!best || m.href.length > best.href.length) best = m;
    }
  }
  return best;
}

/**
 * Match a pathname to the specific sub-page within its module (if any).
 * Returns the sub-page label + href so the tab system can pin a friendly name.
 * Falls back to the module-level label when no sub-page matches.
 */
export function resolveRoute(pathname: string): { moduleId: string; label: string; href: string; icon: LucideIcon } | null {
  const mod = moduleFromPathname(pathname);
  if (!mod) return null;
  const sub = mod.subPages?.find(s => s.href === pathname);
  if (sub) return { moduleId: mod.id, label: sub.label, href: sub.href, icon: sub.icon ?? mod.icon };
  return { moduleId: mod.id, label: mod.label, href: mod.href, icon: mod.icon };
}
