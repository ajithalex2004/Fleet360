/**
 * Fleet360 Enterprise Platform Directory — single source of truth for the
 * 24-module split directory & live module inspector on `/platform`.
 *
 * Module `id` values match `src/lib/modules.ts` and `tenant.enabledModules`
 * so `canOpenModule` gates every entry accurately per tenant and RBAC role.
 */

export type DirectoryFilterKey =
  | 'all'
  | 'ai'
  | 'transport'
  | 'core'
  | 'assets'
  | 'safety'
  | 'finance';

export type PlatformIconKey =
  | 'smart_toy'
  | 'policy'
  | 'local_shipping'
  | 'directions_bus'
  | 'school'
  | 'inventory_2'
  | 'assignment'
  | 'car_rental'
  | 'hub'
  | 'storefront'
  | 'emergency'
  | 'build_circle'
  | 'book_online'
  | 'smartphone'
  | 'directions_car'
  | 'car_repair'
  | 'badge'
  | 'sensors'
  | 'verified_user'
  | 'eco'
  | 'bar_chart'
  | 'groups'
  | 'receipt_long'
  | 'settings';

export interface PlatformModuleMetric {
  label: string;
  value: string;
}

export interface PlatformModuleAction {
  label: string;
  href: string;
}

export interface PlatformModuleEntry {
  id: string;
  filterKey: Exclude<DirectoryFilterKey, 'all'>;
  categoryLabel: string;
  name: string;
  status: 'ACTIVE' | 'LIVE';
  icon: PlatformIconKey;
  href: string;
  summary: string;
  tags: string[];
  metrics: PlatformModuleMetric[];
  actions: PlatformModuleAction[];
}

export interface PinnedLauncherDef {
  moduleId: string;
  shortTitle: string;
  metricSummary: string;
  tone: 'primary' | 'surface' | 'secondary';
}

export const PLATFORM_FILTER_CHIPS: ReadonlyArray<{ key: DirectoryFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'ai', label: 'AI' },
  { key: 'transport', label: 'Transport' },
  { key: 'core', label: 'Core Ops' },
  { key: 'assets', label: 'Assets' },
  { key: 'safety', label: 'Safety' },
  { key: 'finance', label: 'Finance & Admin' },
];

export const PINNED_LAUNCHERS: ReadonlyArray<PinnedLauncherDef> = [
  {
    moduleId: 'dispatch',
    shortTitle: 'Dispatch Control',
    metricSummary: '84 Trips · < 2m',
    tone: 'primary',
  },
  {
    moduleId: 'drayage',
    shortTitle: 'Port Drayage',
    metricSummary: '100% PCS Sync',
    tone: 'surface',
  },
  {
    moduleId: 'agents',
    shortTitle: 'AI Copilot',
    metricSummary: '10 Online · 98.2%',
    tone: 'secondary',
  },
];

export const PLATFORM_DIRECTORY: ReadonlyArray<PlatformModuleEntry> = [
  // ── 1. AI & Intelligence (2) ─────────────────────────────────────
  {
    id: 'agents',
    filterKey: 'ai',
    categoryLabel: 'AI & Intelligence',
    name: 'AI Agent Ecosystem & Copilot',
    status: 'ACTIVE',
    icon: 'smart_toy',
    href: '/agents',
    summary:
      '10 autonomous AI copilots — predictive maintenance, smart dispatch optimizer, accident triage, WhatsApp RAC booking assistant, and compliance ratchets.',
    tags: ['10 AI Agents', 'Predictive Triage', 'Smart Dispatch', 'WhatsApp AI'],
    metrics: [
      { label: 'Autonomous Agents', value: '10 Online' },
      { label: 'AI Accuracy', value: '98.2%' },
      { label: 'Triage Speed', value: '0.4s' },
      { label: 'Cost Avoidance', value: 'AED 42k' },
    ],
    actions: [
      { label: 'Open Agent Command', href: '/agents' },
      { label: 'Threshold Tuning', href: '/agents' },
    ],
  },
  {
    id: 'ai-platform',
    filterKey: 'ai',
    categoryLabel: 'AI & Intelligence',
    name: 'AI Platform & Governance',
    status: 'LIVE',
    icon: 'policy',
    href: '/ai-platform',
    summary:
      'Autonomous policy guardrails (L0–L4), financial token spend budgets, multi-provider AI gateway, and ground-truth model benchmarks.',
    tags: ['Governance', 'ROI Tracking', 'AI Gateway', 'Benchmarks'],
    metrics: [
      { label: 'Net ROI', value: '+AED 42.4k' },
      { label: 'Autonomy Level', value: 'L2 Guarded' },
      { label: 'Model Quality', value: '96.8%' },
    ],
    actions: [
      { label: 'Open ROI Dashboard', href: '/ai-platform' },
      { label: 'Set Policy', href: '/ai-platform' },
    ],
  },

  // ── 2. Transport & Services (6) ──────────────────────────────────
  {
    id: 'drayage',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'Port & Container Drayage',
    status: 'LIVE',
    icon: 'local_shipping',
    href: '/logistics/drayage',
    summary:
      'End-to-end L1/L2 container haulage, live E11/E311 corridor radar, Dubai Trade & ATLP e-Token automation, 2x20FT Bogie & Street-Turn triangulation.',
    tags: ['Live Corridor Radar', 'PCS e-Tokens', '2x20FT Bogie', 'Consignee Portal'],
    metrics: [
      { label: 'PCS Gate Sync', value: '100% Auto' },
      { label: 'Corridor Radar', value: 'Live GPS' },
      { label: 'Deadhead Saved', value: '-42 km' },
      { label: 'Ramp Offload', value: 'Live ETC' },
    ],
    actions: [
      { label: 'Open Corridor Radar', href: '/logistics/drayage/tracking' },
      { label: 'Job Assignment', href: '/logistics/drayage/assignment' },
      { label: 'PCS & Containers', href: '/logistics/drayage/containers' },
      { label: 'Consignee Portal', href: '/logistics/drayage/portal' },
    ],
  },
  {
    id: 'bus-ops',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'Staff Transportation (STS)',
    status: 'LIVE',
    icon: 'directions_bus',
    href: '/bus-ops',
    summary:
      'Fixed corporate bus route schedules, PCE constraint optimization, passenger manifests, shift roster synchronization, and live boarding.',
    tags: ['Staff Shuttles', 'PCE Optimizer', 'Shift Sync', 'Manifests'],
    metrics: [
      { label: 'Active Routes', value: '89 Routes' },
      { label: 'PCE Optimization', value: '94.2%' },
      { label: 'Monthly Pax', value: '28.4k' },
    ],
    actions: [
      { label: 'Open Route Planner', href: '/bus-ops/route-planner' },
      { label: 'Planning Engine', href: '/bus-ops/planning-engine' },
    ],
  },
  {
    id: 'school-bus',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'School Bus Transportation',
    status: 'LIVE',
    icon: 'school',
    href: '/school-bus',
    summary:
      'Student safety registry, RFID badge attendance tracking, guardian WhatsApp SMS alerts, and DOT safety compliance.',
    tags: ['Student RFID', 'Guardian Alerts', 'DOT Safety'],
    metrics: [
      { label: 'Active Students', value: '3,420' },
      { label: 'Live Buses', value: '62' },
    ],
    actions: [
      { label: 'Open Bus Registry', href: '/school-bus' },
      { label: 'Guardian Alerts', href: '/school-bus' },
    ],
  },
  {
    id: 'logistics',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'Logistics & Freight Ops',
    status: 'LIVE',
    icon: 'inventory_2',
    href: '/logistics',
    summary:
      'Heavy logistics dispatch, digital ePOD, bulk consignment merge optimizer, cold chain telematics, and route tracking.',
    tags: ['Heavy Freight', 'Digital ePOD', 'Cold Chain', 'Multi-Drop'],
    metrics: [
      { label: 'On-Time Rate', value: '99.1%' },
      { label: 'In Transit', value: '35 Trips' },
    ],
    actions: [
      { label: 'Open Freight Dispatch', href: '/logistics' },
      { label: 'Corridor Radar', href: '/logistics/drayage/tracking' },
    ],
  },
  {
    id: 'leasing',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'Vehicle Long-Term Leasing',
    status: 'LIVE',
    icon: 'assignment',
    href: '/leasing',
    summary:
      'Corporate long-term leases, automated monthly billing, lessee profiles, contract renewals, and return inspection scoring.',
    tags: ['Corporate Leases', 'Billing Schedules', 'Vehicle Returns'],
    metrics: [
      { label: 'Active Leases', value: '412' },
      { label: 'Renewals (30D)', value: '18' },
    ],
    actions: [
      { label: 'Open Lease Master', href: '/leasing' },
      { label: 'Billing Schedules', href: '/leasing' },
    ],
  },
  {
    id: 'rental',
    filterKey: 'transport',
    categoryLabel: 'Transport & Services',
    name: 'Rent-A-Car (RAC) Operations',
    status: 'LIVE',
    icon: 'car_rental',
    href: '/rental/bookings',
    summary:
      'Fleet RAC desk, dynamic tariffs, customer KYC, cross-border permits (Oman/KSA), damage claims, and automated traffic fine billing.',
    tags: ['Daily/Weekly RAC', 'KYC Verification', 'Cross-Border', 'Damage Claims'],
    metrics: [
      { label: 'Utilization', value: '89.4%' },
      { label: 'RAC Fleet Size', value: '1,166' },
      { label: 'Active Bookings', value: '586' },
      { label: 'Avg Daily Rate', value: 'AED 185' },
    ],
    actions: [
      { label: '+ New Booking', href: '/rental/bookings' },
      { label: 'Tariff Master', href: '/rental' },
    ],
  },

  // ── 3. Core Fleet Operations (6) ─────────────────────────────────
  {
    id: 'dispatch',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Dispatch Control Center',
    status: 'LIVE',
    icon: 'hub',
    href: '/dispatch',
    summary:
      'Real-time multi-modal dispatch command center with auto-dispatch algorithm, trip merge optimizer, and live GIS map tracking.',
    tags: ['Auto-Dispatch', 'Live Map', 'Trip Merge', 'Driver Radar'],
    metrics: [
      { label: 'Active Trips', value: '84 Trips' },
      { label: 'Dispatch SLA', value: '< 2 min' },
    ],
    actions: [
      { label: 'Open Dispatch Center', href: '/dispatch' },
      { label: 'Live GIS Map', href: '/dispatch' },
    ],
  },
  {
    id: 'exchange',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Fleet360 Exchange & Marketplace',
    status: 'LIVE',
    icon: 'storefront',
    href: '/exchange/dashboard',
    summary:
      'Private transport partner network & outsourced dispatch marketplace — Blind RFQ bidding, zone rate cards, and UAE FTA Tax Invoices.',
    tags: ['Partner Network', 'Blind RFQ', 'FTA Invoices', 'Scorecards'],
    metrics: [
      { label: 'Active RFQs', value: '12 Live' },
      { label: 'Partner Network', value: '24 Verified' },
      { label: 'Settlement', value: '3-Way Auto' },
    ],
    actions: [
      { label: 'Post RFQ', href: '/exchange/dashboard' },
      { label: 'Rate Cards', href: '/exchange/fleet' },
    ],
  },
  {
    id: 'incidents',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Incident & Emergency Response',
    status: 'LIVE',
    icon: 'emergency',
    href: '/incidents',
    summary:
      'Emergency response coordination, ambulance dispatch, on-scene collision intake, and police report documentation.',
    tags: ['Emergency 999', 'Ambulance Unit', 'Police Reports'],
    metrics: [{ label: 'Response Desk', value: '24/7 Active' }],
    actions: [{ label: 'Open Incident Desk', href: '/incidents' }],
  },
  {
    id: 'service-tickets',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Field Service Management',
    status: 'LIVE',
    icon: 'build_circle',
    href: '/service-tickets',
    summary:
      'Service requests and tickets with triage, SLAs, 1-click towing recovery, replacement fleet swaps, DVIR defect grounding, and cost ledger.',
    tags: ['Triage Hopper', 'Towing Dispatch', 'Vehicle Swaps', 'Cost Ledger'],
    metrics: [
      { label: 'Acknowledge SLA', value: '< 15m' },
      { label: 'Pillars Active', value: '4 Pillars' },
      { label: 'Auto-Grounding', value: 'Instant' },
    ],
    actions: [
      { label: 'Open Service Tickets', href: '/service-tickets' },
      { label: 'SLA Matrix', href: '/service-tickets/sla' },
      { label: 'CSAT Analytics', href: '/service-tickets/csat' },
    ],
  },
  {
    id: 'booking-portal',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Unified Booking Portal',
    status: 'LIVE',
    icon: 'book_online',
    href: '/booking-portal',
    summary:
      'Self-service enterprise portal for corporate bookings, chauffeur cars, freight requests, and approval routing.',
    tags: ['Self-Service', 'Multi-Modal', 'Approval Workflow'],
    metrics: [{ label: 'Portal Status', value: 'Online' }],
    actions: [
      { label: 'Open Booking Portal', href: '/booking-portal' },
      { label: 'New Request', href: '/booking-portal/new' },
    ],
  },
  {
    id: 'mobile-apps',
    filterKey: 'core',
    categoryLabel: 'Core Fleet Operations',
    name: 'Mobile Apps & Driver PWA',
    status: 'LIVE',
    icon: 'smartphone',
    href: '/mobile-apps',
    summary:
      'Native Android APK build, Driver App, Passenger App, and Counter RAC terminal PWAs.',
    tags: ['Android APK', 'Driver PWA', 'Passenger App'],
    metrics: [{ label: 'Build Targets', value: '4 Apps' }],
    actions: [
      { label: 'Manage App Builds', href: '/mobile-apps' },
      { label: 'Driver Today App', href: '/driver-app/today' },
    ],
  },

  // ── 4. Assets & People (4) ───────────────────────────────────────
  {
    id: 'fleet',
    filterKey: 'assets',
    categoryLabel: 'Assets & People',
    name: 'Fleet & Vehicle Master',
    status: 'LIVE',
    icon: 'directions_car',
    href: '/fleet/vehicles',
    summary:
      'Vehicle lifecycle inventory, Mulkiya & Insurance document vault, Salik tolls, fine reconciliation, and full TCO analysis.',
    tags: ['Vehicle Master', 'Allocations', 'Mulkiya Vault', 'TCO Engine'],
    metrics: [
      { label: 'Total Fleet', value: '1,420' },
      { label: 'Ready for Dispatch', value: '1,166' },
    ],
    actions: [{ label: 'Open Vehicle Master', href: '/fleet/vehicles' }],
  },
  {
    id: 'maintenance',
    filterKey: 'assets',
    categoryLabel: 'Assets & People',
    name: 'Maintenance & Work Orders',
    status: 'LIVE',
    icon: 'car_repair',
    href: '/maintenance',
    summary:
      'Full garage workflow — service requests, workshop quotations, work orders, parts inventory, and predictive wear analytics.',
    tags: ['Work Orders', 'Quotations', 'Parts Usage', 'QC Check'],
    metrics: [
      { label: 'In Workshop', value: '18' },
      { label: 'Avg Turnaround', value: '10 hrs' },
    ],
    actions: [{ label: 'Open Work Orders', href: '/maintenance' }],
  },
  {
    id: 'driver-mgmt',
    filterKey: 'assets',
    categoryLabel: 'Assets & People',
    name: 'Driver Operations & HOS',
    status: 'LIVE',
    icon: 'badge',
    href: '/driver-mgmt',
    summary:
      'Driver license & visa compliance, HOS shift logs, automated driver scoring, and performance telematics.',
    tags: ['Driver Scoring', 'HOS Logs', 'Document Vault'],
    metrics: [{ label: 'Compliance', value: 'HOS Active' }],
    actions: [{ label: 'Open Driver Roster', href: '/driver-mgmt' }],
  },
  {
    id: 'assets',
    filterKey: 'assets',
    categoryLabel: 'Assets & People',
    name: 'Assets & Field Inventory',
    status: 'LIVE',
    icon: 'sensors',
    href: '/assets',
    summary:
      'High-Value Asset (HVA) calibration logs, BLE beacon tracking, medical supplies, and reverse logistics.',
    tags: ['HVA Tracking', 'BLE Beacons', 'Inventory'],
    metrics: [{ label: 'Tracking', value: 'BLE Live' }],
    actions: [{ label: 'Open Asset Vault', href: '/assets' }],
  },

  // ── 5. Safety & Governance (4) ───────────────────────────────────
  {
    id: 'compliance',
    filterKey: 'safety',
    categoryLabel: 'Safety & Governance',
    name: 'RTA Compliance & Salik',
    status: 'LIVE',
    icon: 'verified_user',
    href: '/compliance',
    summary:
      'RTA commercial road permits, commercial vehicle inspections, insurance policies, and electronic document validation.',
    tags: ['RTA Road Permits', 'Insurance Policies', 'Salik Tag Sync'],
    metrics: [{ label: 'Salik Sync', value: 'Automated' }],
    actions: [{ label: 'Open RTA Compliance', href: '/compliance' }],
  },
  {
    id: 'sustainability',
    filterKey: 'safety',
    categoryLabel: 'Safety & Governance',
    name: 'ESG & Carbon Intelligence',
    status: 'LIVE',
    icon: 'eco',
    href: '/sustainability',
    summary:
      'GHG Protocol / ISO 14064 certified CO2 emission tracking, EV fleet transition roadmap, and UAE Net Zero 2050 metrics.',
    tags: ['GHG Protocol', 'Scope 1/2/3', 'EV Transition'],
    metrics: [{ label: 'Standard', value: 'ISO 14064' }],
    actions: [{ label: 'Open ESG Dashboard', href: '/sustainability' }],
  },
  {
    id: 'reports',
    filterKey: 'safety',
    categoryLabel: 'Safety & Governance',
    name: 'Cross-Module BI Reports',
    status: 'LIVE',
    icon: 'bar_chart',
    href: '/reports',
    summary:
      'Fleet utilization heatmap, revenue analytics, maintenance cost breakdown, and automated PDF / Excel exports.',
    tags: ['Fleet Analytics', 'Revenue BI', 'Scheduled Exports'],
    metrics: [{ label: 'Exports', value: 'PDF / XLSX' }],
    actions: [{ label: 'Open BI Reports', href: '/reports' }],
  },
  {
    id: 'customer-mgmt',
    filterKey: 'safety',
    categoryLabel: 'Safety & Governance',
    name: 'Customer Master & CRM',
    status: 'LIVE',
    icon: 'groups',
    href: '/customer-mgmt',
    summary:
      '3-tier hierarchy (Region, Department, Unit), credit limits, contract master, Customer Portal access, and Transport Services catalogue.',
    tags: ['3-Tier Hierarchy', 'Credit Master', 'Customer Portals', 'Transport Catalogue'],
    metrics: [{ label: 'Structure', value: '3-Tier' }],
    actions: [
      { label: 'Open Customer CRM', href: '/customer-mgmt' },
      { label: 'Portal Access', href: '/customer-mgmt/portal-access' },
      { label: 'Transport Catalogue', href: '/customer-mgmt/transport-catalog' },
    ],
  },

  // ── 6. Finance & Admin (2) ───────────────────────────────────────
  {
    id: 'finance',
    filterKey: 'finance',
    categoryLabel: 'Finance',
    name: 'Finance & VAT Billing',
    status: 'LIVE',
    icon: 'receipt_long',
    href: '/finance',
    summary:
      'Automated FTA-compliant Tax Invoices, Salik toll batch reconciliation, payment receipts, and revenue reports.',
    tags: ['FTA Tax Invoices', 'Salik Tolls', '5% VAT Engine'],
    metrics: [{ label: 'Tax Engine', value: 'UAE 5% VAT' }],
    actions: [{ label: 'Open Finance & VAT', href: '/finance' }],
  },
  {
    id: 'admin',
    filterKey: 'finance',
    categoryLabel: 'Admin',
    name: 'Enterprise Administration & Masters',
    status: 'LIVE',
    icon: 'settings',
    href: '/admin',
    summary:
      'Company profile, 3-tier organizational hierarchy, user roles, NUI reasons, and security governance.',
    tags: ['Organization Masters', 'Roles & RBAC', 'Audit Log'],
    metrics: [{ label: 'Governance', value: 'RBAC' }],
    actions: [{ label: 'Open System Masters', href: '/admin' }],
  },
];

/** Filter accessible directory modules by category chip and free-text query. */
export function filterPlatformModules(
  accessible: readonly PlatformModuleEntry[],
  activeFilter: DirectoryFilterKey,
  searchQuery: string,
): PlatformModuleEntry[] {
  const q = searchQuery.trim().toLowerCase();
  return accessible.filter((m) => {
    const matchCat = activeFilter === 'all' || m.filterKey === activeFilter;
    if (!matchCat) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.categoryLabel.toLowerCase().includes(q) ||
      m.summary.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q)) ||
      m.metrics.some((k) => k.label.toLowerCase().includes(q) || k.value.toLowerCase().includes(q))
    );
  });
}

/** Resolve up to 3 pinned quick-launchers scoped to the tenant's accessible modules. */
export function resolvePinnedLaunchers(
  accessible: readonly PlatformModuleEntry[],
): Array<PinnedLauncherDef & { module: PlatformModuleEntry }> {
  const byId = new Map(accessible.map((m) => [m.id, m]));
  const pinned: Array<PinnedLauncherDef & { module: PlatformModuleEntry }> = [];
  for (const def of PINNED_LAUNCHERS) {
    const mod = byId.get(def.moduleId);
    if (mod) pinned.push({ ...def, module: mod });
  }
  if (pinned.length < 3) {
    const used = new Set(pinned.map((p) => p.moduleId));
    for (const mod of accessible) {
      if (pinned.length >= 3) break;
      if (used.has(mod.id)) continue;
      pinned.push({
        moduleId: mod.id,
        shortTitle: mod.name,
        metricSummary: mod.metrics[0]?.value ?? mod.status,
        tone: pinned.length === 0 ? 'primary' : pinned.length === 1 ? 'surface' : 'secondary',
        module: mod,
      });
      used.add(mod.id);
    }
  }
  return pinned;
}
