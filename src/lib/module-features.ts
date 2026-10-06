/**
 * Module → Feature Flag catalog — which feature flags each module offers.
 *
 * Every flag belongs to exactly one module from `@/lib/modules`. A flag is
 * only effective while its module is enabled for the tenant; switching a
 * module off keeps the stored flag values so switching it back on restores
 * them.
 *
 * Storage (see `@/lib/tenant-features`):
 *   - Flags with `settingsField` live in that `tenant_settings` column, which
 *     the runtime already reads (e.g. the dispatch merge engine reads
 *     `tripMergingEnabled`). The tenant "Feature Settings" tab edits their
 *     parameters.
 *   - Every other flag is a row in `tenant_feature_overrides`
 *     (tenant_id, feature_key, is_enabled), the table the Go
 *     `featureflags.Resolver` reads.
 *
 * Adding a flag: add an entry below. Keys are `<module>.<feature>`, kebab
 * case, and must never be renamed once tenants have stored values.
 *
 * React-agnostic and Prisma-agnostic, like `@/lib/modules`.
 */
import { MODULES, type ModuleKey } from '@/lib/modules';

/** tenant_settings boolean columns that double as feature flags. */
export type SettingsFlagField =
  | 'tripMergingEnabled'
  | 'autoMergeEnabled'
  | 'autoDispatchEnabled'
  | 'routeOptimizationEnabled';

export interface ModuleFeatureDef {
  /** Stable flag key (`tenant_feature_overrides.feature_key`). */
  key: string;
  /** Owning module. */
  module: ModuleKey;
  name: string;
  description: string;
  /** Value for a new tenant, and for a tenant with no stored value. */
  defaultEnabled: boolean;
  /** Stored in this tenant_settings column instead of tenant_feature_overrides. */
  settingsField?: SettingsFlagField;
}

const f = (
  module: ModuleKey,
  key: string,
  name: string,
  description: string,
  defaultEnabled: boolean,
  settingsField?: SettingsFlagField,
): ModuleFeatureDef => ({ key, module, name, description, defaultEnabled, settingsField });

export const MODULE_FEATURES: readonly ModuleFeatureDef[] = [
  // ── Service & Support Ticketing ──
  f('service-tickets', 'service-tickets.sla-tracking', 'SLA Tracking', 'SLA timers, breach warnings and escalation on tickets', true),
  f('service-tickets', 'service-tickets.auto-assignment', 'Auto Assignment', 'Route new tickets to the right team automatically', true),
  f('service-tickets', 'service-tickets.customer-notifications', 'Customer Notifications', 'Email/SMS updates to the requester as a ticket progresses', true),

  // ── AI Agents ──
  f('agents', 'agents.predictive-maintenance', 'Predictive Maintenance Agent', 'AI predictions of upcoming vehicle failures', true),
  f('agents', 'agents.smart-dispatch', 'Smart Dispatch Agent', 'AI-recommended driver and vehicle assignments', false),
  f('agents', 'agents.whatsapp-ai', 'WhatsApp AI Assistant', 'AI support bot on the tenant WhatsApp channel', false),

  // ── Maintenance ──
  f('maintenance', 'maintenance.quotations', 'Quotations', 'Garage quotations against service requests', true),
  f('maintenance', 'maintenance.estimate-approval', 'Estimate Approval Workflow', 'Approval rules before a maintenance estimate becomes a work order', true),
  f('maintenance', 'maintenance.preventive-plans', 'Preventive Maintenance Plans', 'Time and mileage based PM schedules', true),
  f('maintenance', 'maintenance.warranty-claims', 'Warranty Claims', 'Track vehicle warranties and raise claims', true),

  // ── Leasing ──
  f('leasing', 'leasing.customer-portal', 'Lessee Portal', 'Self-service portal for lessees (contracts, invoices, documents)', true),
  f('leasing', 'leasing.e-signing', 'E-Signing', 'Digital signature of lease contracts', false),
  f('leasing', 'leasing.vehicle-returns', 'Return Settlement', 'Vehicle return inspection and settlement workflow', true),

  // ── Rent-a-Car ──
  f('rental', 'rental.booking-approvals', 'Booking Approvals', 'Approval workflow for RAC bookings', true),
  f('rental', 'rental.deposit-refunds', 'Deposit Refund Requests', 'Request and approve rental deposit refunds', true),
  f('rental', 'rental.dynamic-pricing', 'Dynamic Pricing', 'Demand and event based rate adjustments', false),
  f('rental', 'rental.damage-claims', 'Damage Claims', 'Inspections and damage claim processing', true),

  // ── Staff Transportation ──
  f('bus-ops', 'bus-ops.live-tracking', 'Live Tracking', 'Live vehicle positions and geofence alerts', true),
  f('bus-ops', 'bus-ops.rider-notifications', 'Rider Notifications', 'Arrival and delay notifications to passengers', true),
  f('bus-ops', 'bus-ops.disruption-recovery', 'Disruption Recovery', 'Breakdown and delay recovery with replacement vehicles', true),

  // ── School Bus ──
  f('school-bus', 'school-bus.rfid-attendance', 'RFID Attendance', 'Student boarding and alighting via RFID', true),
  f('school-bus', 'school-bus.guardian-notifications', 'Guardian Notifications', 'Pickup and drop-off alerts to guardians', true),

  // ── Logistics ──
  f('logistics', 'logistics.shipper-portal', 'Shipper Portal', 'Self-service portal for shippers to book and track', true),
  f('logistics', 'logistics.proof-of-delivery', 'Proof of Delivery', 'Photo and signature capture on delivery', true),
  f('logistics', 'logistics.carrier-marketplace', 'Carrier Marketplace', 'RFQs and bids from external carriers', false),

  // ── Incidents & Ambulance ──
  f('incidents', 'incidents.ambulance-dispatch', 'Ambulance Dispatch', 'Emergency ambulance call handling and dispatch', true),
  f('incidents', 'incidents.breakdown-reports', 'Breakdown Reports', 'Driver-reported breakdowns and roadside incidents', true),

  // ── Fleet ──
  f('fleet', 'fleet.fuel-management', 'Fuel Management', 'Fuel cards, fuel logs and consumption analytics', true),
  f('fleet', 'fleet.traffic-fines', 'Traffic Fines', 'Fine capture and driver allocation', true),
  f('fleet', 'fleet.tco-analysis', 'TCO Analysis', 'Total cost of ownership per vehicle', true),

  // ── Driver Management ──
  f('driver-mgmt', 'driver-mgmt.performance-scoring', 'Performance Scoring', 'Driver behaviour scoring and coaching', true),
  f('driver-mgmt', 'driver-mgmt.training-records', 'Training Records', 'Training and certification tracking', true),
  f('driver-mgmt', 'driver-mgmt.dvir', 'Vehicle Inspection Reports (DVIR)', 'Pre-trip and post-trip inspections in the driver app', false),

  // ── Customer Management ──
  f('customer-mgmt', 'customer-mgmt.hierarchy', 'Customer Hierarchy', 'Region / Department / Unit structure under each customer', true),
  f('customer-mgmt', 'customer-mgmt.credit-control', 'Credit Control', 'Credit limits and holds on customer accounts', false),

  // ── Booking Portal ──
  f('booking-portal', 'booking-portal.approval-workflow', 'Booking Approvals', 'Line-manager approval before a booking is confirmed', true),
  f('booking-portal', 'booking-portal.multi-service', 'Multi-Service Booking', 'Book rentals, leasing and shuttles from one portal', true),

  // ── Finance ──
  f('finance', 'finance.vat-compliance', 'VAT Compliance', 'UAE VAT on invoices and VAT returns', true),
  f('finance', 'finance.dunning', 'Dunning & Collections', 'Overdue reminders and collections workflow', true),
  f('finance', 'finance.budgets', 'Budgets', 'Budget vs actual tracking', true),
  f('finance', 'finance.online-payments', 'Online Payments', 'Card payments through the payment gateway', false),

  // ── Compliance ──
  f('compliance', 'compliance.expiry-alerts', 'Expiry Alerts', 'Alerts before permits, insurance and registrations expire', true),
  f('compliance', 'compliance.salik', 'Salik Accounts', 'Salik toll account tracking', true),

  // ── Customer App ──
  f('customer', 'customer.self-service-booking', 'Self-Service Booking', 'Customers book and manage trips from the app', true),
  f('customer', 'customer.shuttle-schedules', 'Shuttle Schedules', 'Published shuttle timetables in the app', true),

  // ── Mobile Apps ──
  f('mobile-apps', 'mobile-apps.driver-app', 'Driver App', 'Driver PWA access', true),
  f('mobile-apps', 'mobile-apps.passenger-app', 'Passenger App', 'Passenger PWA access', true),
  f('mobile-apps', 'mobile-apps.offline-mode', 'Offline Mode', 'Offline caching and background sync', true),

  // ── Reports ──
  // Key matches FeatureAdvancedReporting in backend/featureflags/featureflags.go.
  f('reports', 'reporting.advanced', 'Advanced Reporting', 'Custom report builder and cross-module BI', false),
  f('reports', 'reports.scheduled-exports', 'Scheduled Exports', 'Emailed report exports on a schedule', true),

  // ── Dispatch (stored in tenant_settings; parameters on the Feature Settings tab) ──
  f('dispatch', 'dispatch.trip-merging', 'Trip Merging', 'Merge compatible trips to improve utilisation', false, 'tripMergingEnabled'),
  f('dispatch', 'dispatch.auto-merge', 'Auto-Merge', 'Merge eligible trips automatically before departure', false, 'autoMergeEnabled'),
  f('dispatch', 'dispatch.auto-dispatch', 'Auto Dispatch', 'Assign the best-scored driver to confirmed trips', false, 'autoDispatchEnabled'),
  f('dispatch', 'dispatch.route-optimization', 'Route Optimization', 'Road-distance routing via the configured engine', false, 'routeOptimizationEnabled'),

  // ── Sustainability ──
  f('sustainability', 'sustainability.scope3', 'Scope 3 Emissions', 'Value-chain (Scope 3) emissions accounting', false),
  f('sustainability', 'sustainability.esg-reports', 'ESG Reports', 'GHG Protocol / ISO 14064 report packs', true),

  // ── Assets ──
  f('assets', 'assets.ble-tracking', 'BLE Tracking', 'Bluetooth tag and gateway tracking of assets', false),
  f('assets', 'assets.calibration', 'Calibration & Insurance', 'Calibration schedules and insurance on high-value assets', true),
  f('assets', 'assets.stock-management', 'Stock Management', 'Stock levels, issues and reverse logistics', true),
];

// ── Derived lookups ────────────────────────────────────────────────────────

export const FEATURE_BY_KEY: Readonly<Record<string, ModuleFeatureDef>> = Object.fromEntries(
  MODULE_FEATURES.map((d) => [d.key, d]),
);

/** Flags offered by each module (every registry module has an entry, possibly empty). */
export const FEATURES_BY_MODULE: Readonly<Record<ModuleKey, readonly ModuleFeatureDef[]>> = MODULES.reduce(
  (acc, m) => {
    acc[m.key] = MODULE_FEATURES.filter((d) => d.module === m.key);
    return acc;
  },
  {} as Record<ModuleKey, ModuleFeatureDef[]>,
);

export type FeatureFlagMap = Record<string, boolean>;

/** Every catalog flag at its default value. */
export function defaultFeatureFlags(): FeatureFlagMap {
  return Object.fromEntries(MODULE_FEATURES.map((d) => [d.key, d.defaultEnabled]));
}

/**
 * Validate a client-supplied flag map. Unknown keys and non-boolean values
 * are rejected so a typo cannot silently create a flag nothing reads.
 */
export function parseFeatureFlags(
  input: unknown,
): { ok: true; flags: FeatureFlagMap } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, flags: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'featureFlags must be an object of { flagKey: boolean }' };
  }
  const flags: FeatureFlagMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!FEATURE_BY_KEY[key]) return { ok: false, error: `Unknown feature flag: ${key}` };
    if (typeof value !== 'boolean') return { ok: false, error: `Feature flag ${key} must be true or false` };
    flags[key] = value;
  }
  return { ok: true, flags };
}

/** Flags that are on AND whose module is enabled. */
export function activeFeatureKeys(enabledModules: Iterable<string>, flags: FeatureFlagMap): string[] {
  const mods = new Set(enabledModules);
  return MODULE_FEATURES.filter((d) => mods.has(d.module) && flags[d.key]).map((d) => d.key);
}
