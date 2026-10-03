/**
 * RBAC permissions registry + helpers.
 *
 * Drift history:
 * The Module taxonomy was previously maintained as a parallel snake_case
 * tuple (`'rac'`, `'bus_ops'`, `'drivers'`) that drifted from the canonical
 * kebab-case registry in `@/lib/modules`. That fourth (and last) taxonomy
 * is gone.
 *
 * What this file does:
 *   1. Declares the RBAC `Module` type — derived from `ModuleKey | 'admin'`.
 *      Every value is a canonical kebab-case identifier from `@/lib/modules`,
 *      plus the platform-level `'admin'` meta-module for tenant/user/role
 *      management. (The `'admin'` shape mirrors `AppModule` in
 *      `@/lib/access-control` — same union, intentionally separate file
 *      so the RBAC layer doesn't depend on the route-gating layer.)
 *   2. Declares the curated subset of modules that have explicit permission
 *      matrix entries (`MODULES`). Not every canonical module has granular
 *      permissions — e.g. `service-tickets`, `agents`, `assets` are
 *      always-on modules without per-action gating.
 *   3. Declares the full `ALL_PERMISSIONS` matrix and the `SYSTEM_ROLES`
 *      that compose them.
 *   4. Provides `hasPermission()` and the `can*` helpers for UI checks.
 *      `hasPermission()` is alias-aware: it accepts both canonical and
 *      legacy module keys in permStrings (e.g. `'rac:create:*'` resolves
 *      to `'rental:create:*'`), so users with pre-migration permission
 *      rows keep working without a forced re-seed.
 *
 * Adding a new permission:
 *   1. Add a row to `ALL_PERMISSIONS` using a canonical ModuleKey.
 *   2. Optionally grant it in one of the `SYSTEM_ROLES` entries.
 *   3. Re-run the seed (`/api/admin/seed` POST) to populate the DB.
 *
 * Adding a new RBAC module:
 *   1. Add an entry to `MODULES` in `@/lib/modules` (canonical registry).
 *   2. Add the key to `MODULES` below and to `ALL_PERMISSIONS`.
 *   3. Re-run the seed.
 */

import type { ModuleKey } from '@/lib/modules';
import { LEGACY_MODULE_ALIASES } from '@/lib/modules';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Module = ModuleKey | 'admin'.
 *   - Every ModuleKey (rental, leasing, bus-ops, driver-mgmt, etc.) is a
 *     canonical kebab-case identifier from `@/lib/modules`.
 *   - `'admin'` is the platform-level RBAC module for tenant / user / role
 *     management. It's not in the registry because it's a meta-module
 *     (no subscription, no landing page, no gradient).
 *
 * Same shape as `AppModule` in `@/lib/access-control`. Intentionally
 * duplicated rather than imported, so the RBAC layer stays free of any
 * Next.js dependency.
 */
export type Module = ModuleKey | 'admin';

/**
 * Modules with explicit permission matrix entries. A subset of `Module`
 * — always-on platform modules (service-tickets, agents, assets, …) and
 * the customer/portal modules (customer-mgmt, booking-portal, customer)
 * are intentionally absent because they don't have per-action gating.
 *
 * Typed `as const satisfies readonly Module[]` so:
 *   - each entry is verified to be a real `Module` at compile time
 *   - the array keeps its narrow tuple type for ergonomic `.includes()` checks
 */
export const MODULES = [
  'leasing', 'rental', 'bus-ops', 'fleet',
  'maintenance', 'finance', 'driver-mgmt',
  'compliance', 'reports', 'admin',
  // Modules the authorization policy maps API areas to (policy v1).
  'school-bus', 'logistics', 'incidents', 'dispatch', 'service-tickets',
  'customer-mgmt', 'booking-portal', 'assets', 'sustainability', 'agents',
] as const satisfies readonly Module[];

export const ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'export', 'admin',
] as const;

export type Action = typeof ACTIONS[number];

/** A single grantable permission: (module, action, resource) triple. */
export interface AppPermission {
  module: Module;
  action: Action;
  resource: string;
  label: string;
}

// ── Permission matrix ───────────────────────────────────────────────────────

export const ALL_PERMISSIONS: readonly AppPermission[] = [
  // ── LEASING ────────────────────────────────────────────────────────────
  { module: 'leasing', action: 'view',    resource: '*',             label: 'View Leasing Module' },
  { module: 'leasing', action: 'create',  resource: 'inquiries',     label: 'Create Lease Inquiries' },
  { module: 'leasing', action: 'edit',    resource: 'inquiries',     label: 'Edit Lease Inquiries' },
  { module: 'leasing', action: 'delete',  resource: 'inquiries',     label: 'Delete Lease Inquiries' },
  { module: 'leasing', action: 'create',  resource: 'quotations',    label: 'Create Quotations' },
  { module: 'leasing', action: 'edit',    resource: 'quotations',    label: 'Edit Quotations' },
  { module: 'leasing', action: 'approve', resource: 'quotations',    label: 'Approve Quotations' },
  { module: 'leasing', action: 'delete',  resource: 'quotations',    label: 'Delete Quotations' },
  { module: 'leasing', action: 'create',  resource: 'contracts',     label: 'Create Lease Contracts' },
  { module: 'leasing', action: 'edit',    resource: 'contracts',     label: 'Edit Lease Contracts' },
  { module: 'leasing', action: 'approve', resource: 'contracts',     label: 'Approve Lease Contracts' },
  { module: 'leasing', action: 'delete',  resource: 'contracts',     label: 'Delete Lease Contracts' },
  { module: 'leasing', action: 'create',  resource: 'traffic_fines', label: 'Log Traffic Fines' },
  { module: 'leasing', action: 'edit',    resource: 'traffic_fines', label: 'Update Fine Billing Status' },
  { module: 'leasing', action: 'create',  resource: 'fuel',          label: 'Log Fuel Charges' },
  { module: 'leasing', action: 'edit',    resource: 'fuel',          label: 'Update Fuel Billing Status' },
  { module: 'leasing', action: 'create',  resource: 'insurance',     label: 'Create Insurance Policies' },
  { module: 'leasing', action: 'edit',    resource: 'insurance',     label: 'Edit Insurance Policies' },
  { module: 'leasing', action: 'create',  resource: 'mileage',       label: 'Log Mileage Readings' },
  { module: 'leasing', action: 'approve', resource: 'mileage',       label: 'Approve Mileage Overage Waivers' },
  { module: 'leasing', action: 'create',  resource: 'renewals',      label: 'Propose Contract Renewals' },
  { module: 'leasing', action: 'approve', resource: 'renewals',      label: 'Approve Contract Renewals' },
  { module: 'leasing', action: 'create',  resource: 'terminations',  label: 'Request Early Termination' },
  { module: 'leasing', action: 'approve', resource: 'terminations',  label: 'Approve Early Termination' },
  { module: 'leasing', action: 'create',  resource: 'credit',        label: 'Create Credit Assessments' },
  { module: 'leasing', action: 'approve', resource: 'credit',        label: 'Approve Credit Limits' },
  { module: 'leasing', action: 'create',  resource: 'documents',     label: 'Upload Documents' },
  { module: 'leasing', action: 'delete',  resource: 'documents',     label: 'Delete Documents' },
  { module: 'leasing', action: 'export',  resource: '*',             label: 'Export Leasing Data' },
  { module: 'leasing', action: 'create',  resource: 'dunning_suppressions', label: 'Create Dunning Suppressions' },
  { module: 'leasing', action: 'delete',  resource: 'dunning_suppressions', label: 'Lift Dunning Suppressions' },
  { module: 'leasing', action: 'approve', resource: 'legal_referral',       label: 'Approve Dunning Legal Referral' },
  { module: 'leasing', action: 'approve', resource: 'dunning_delivery',     label: 'Resolve Uncertain Dunning Delivery' },

  // ── RENTAL (was 'rac' pre-migration) ───────────────────────────────────
  { module: 'rental', action: 'view',    resource: '*',          label: 'View RAC Module' },
  { module: 'rental', action: 'create',  resource: 'bookings',   label: 'Create RAC Bookings' },
  { module: 'rental', action: 'edit',    resource: 'bookings',   label: 'Edit RAC Bookings' },
  { module: 'rental', action: 'approve', resource: 'bookings',   label: 'Confirm/Activate Bookings' },
  { module: 'rental', action: 'delete',  resource: 'bookings',   label: 'Cancel Bookings' },
  { module: 'rental', action: 'create',  resource: 'customers',  label: 'Add RAC Customers' },
  { module: 'rental', action: 'edit',    resource: 'customers',  label: 'Edit RAC Customers' },
  { module: 'rental', action: 'create',  resource: 'damage',     label: 'Log Damage Claims' },
  { module: 'rental', action: 'approve', resource: 'damage',     label: 'Close Damage Claims' },
  { module: 'rental', action: 'edit',    resource: 'pricing',    label: 'Manage Pricing Rules' },
  { module: 'rental', action: 'export',  resource: '*',          label: 'Export RAC Data' },

  // ── BUS OPS (was 'bus_ops' pre-migration) ──────────────────────────────
  { module: 'bus-ops', action: 'admin', resource: 'device-credentials', label: 'Bus Ops admin: device-credentials' },
  { module: 'bus-ops', action: 'admin', resource: 'finance-recharge', label: 'Bus Ops admin: finance-recharge' },
  { module: 'bus-ops', action: 'admin', resource: 'jobs', label: 'Bus Ops admin: jobs' },
  { module: 'bus-ops', action: 'approve', resource: 'planning-core', label: 'Bus Ops approve: planning-core' },
  { module: 'bus-ops', action: 'approve', resource: 'requests', label: 'Bus Ops approve: requests' },
  { module: 'bus-ops', action: 'approve', resource: 'route-consolidation', label: 'Bus Ops approve: route-consolidation' },
  { module: 'bus-ops', action: 'approve', resource: 'vehicle-resource-optimization', label: 'Bus Ops approve: vehicle-resource-optimization' },
  { module: 'bus-ops', action: 'create', resource: 'calendars', label: 'Bus Ops create: calendars' },
  { module: 'bus-ops', action: 'create', resource: 'drivers', label: 'Bus Ops create: drivers' },
  { module: 'bus-ops', action: 'create', resource: 'geofences', label: 'Bus Ops create: geofences' },
  { module: 'bus-ops', action: 'create', resource: 'outsource', label: 'Bus Ops create: outsource' },
  { module: 'bus-ops', action: 'create', resource: 'passengers', label: 'Bus Ops create: passengers' },
  { module: 'bus-ops', action: 'create', resource: 'requests', label: 'Bus Ops create: requests' },
  { module: 'bus-ops', action: 'create', resource: 'self-service', label: 'Bus Ops create: self-service' },
  { module: 'bus-ops', action: 'create', resource: 'telemetry', label: 'Bus Ops create: telemetry' },
  { module: 'bus-ops', action: 'delete', resource: 'calendars', label: 'Bus Ops delete: calendars' },
  { module: 'bus-ops', action: 'delete', resource: 'devices', label: 'Bus Ops delete: devices' },
  { module: 'bus-ops', action: 'delete', resource: 'geofences', label: 'Bus Ops delete: geofences' },
  { module: 'bus-ops', action: 'delete', resource: 'incidents', label: 'Bus Ops delete: incidents' },
  { module: 'bus-ops', action: 'delete', resource: 'passengers', label: 'Bus Ops delete: passengers' },
  { module: 'bus-ops', action: 'delete', resource: 'requests', label: 'Bus Ops delete: requests' },
  { module: 'bus-ops', action: 'delete', resource: 'route-consolidation', label: 'Bus Ops delete: route-consolidation' },
  { module: 'bus-ops', action: 'delete', resource: 'staff', label: 'Bus Ops delete: staff' },
  { module: 'bus-ops', action: 'delete', resource: 'trips', label: 'Bus Ops delete: trips' },
  { module: 'bus-ops', action: 'edit', resource: 'calendars', label: 'Bus Ops edit: calendars' },
  { module: 'bus-ops', action: 'edit', resource: 'devices', label: 'Bus Ops edit: devices' },
  { module: 'bus-ops', action: 'edit', resource: 'geofences', label: 'Bus Ops edit: geofences' },
  { module: 'bus-ops', action: 'edit', resource: 'passengers', label: 'Bus Ops edit: passengers' },
  { module: 'bus-ops', action: 'edit', resource: 'requests', label: 'Bus Ops edit: requests' },
  { module: 'bus-ops', action: 'edit', resource: 'trips', label: 'Bus Ops edit: trips' },
  { module: 'bus-ops', action: 'export', resource: 'trips', label: 'Bus Ops export: trips' },
  { module: 'bus-ops', action: 'view', resource: 'analytics', label: 'Bus Ops view: analytics' },
  { module: 'bus-ops', action: 'view', resource: 'calendars', label: 'Bus Ops view: calendars' },
  { module: 'bus-ops', action: 'view', resource: 'cba-rules', label: 'Bus Ops view: cba-rules' },
  { module: 'bus-ops', action: 'view', resource: 'cost-allocation', label: 'Bus Ops view: cost-allocation' },
  { module: 'bus-ops', action: 'view', resource: 'devices', label: 'Bus Ops view: devices' },
  { module: 'bus-ops', action: 'view', resource: 'driver-performance', label: 'Bus Ops view: driver-performance' },
  { module: 'bus-ops', action: 'view', resource: 'drivers', label: 'Bus Ops view: drivers' },
  { module: 'bus-ops', action: 'view', resource: 'esg', label: 'Bus Ops view: esg' },
  { module: 'bus-ops', action: 'view', resource: 'geofences', label: 'Bus Ops view: geofences' },
  { module: 'bus-ops', action: 'view', resource: 'headway', label: 'Bus Ops view: headway' },
  { module: 'bus-ops', action: 'view', resource: 'incidents', label: 'Bus Ops view: incidents' },
  { module: 'bus-ops', action: 'view', resource: 'outsource', label: 'Bus Ops view: outsource' },
  { module: 'bus-ops', action: 'view', resource: 'passengers', label: 'Bus Ops view: passengers' },
  { module: 'bus-ops', action: 'view', resource: 'planning-constraints', label: 'Bus Ops view: planning-constraints' },
  { module: 'bus-ops', action: 'view', resource: 'planning-core', label: 'Bus Ops view: planning-core' },
  { module: 'bus-ops', action: 'view', resource: 'requests', label: 'Bus Ops view: requests' },
  { module: 'bus-ops', action: 'view', resource: 'route-consolidation', label: 'Bus Ops view: route-consolidation' },
  { module: 'bus-ops', action: 'view', resource: 'routes', label: 'Bus Ops view: routes' },
  { module: 'bus-ops', action: 'view', resource: 'self-service', label: 'Bus Ops view: self-service' },
  { module: 'bus-ops', action: 'view', resource: 'sla-monitor', label: 'Bus Ops view: sla-monitor' },
  { module: 'bus-ops', action: 'view', resource: 'staff', label: 'Bus Ops view: staff' },
  { module: 'bus-ops', action: 'view', resource: 'telemetry', label: 'Bus Ops view: telemetry' },
  { module: 'bus-ops', action: 'view', resource: 'trips', label: 'Bus Ops view: trips' },
  { module: 'bus-ops', action: 'view', resource: 'vehicle-resource-optimization', label: 'Bus Ops view: vehicle-resource-optimization' },
  { module: 'bus-ops', action: 'view',    resource: '*',         label: 'View Staff Transport Module' },
  { module: 'bus-ops', action: 'create',  resource: 'routes',    label: 'Create Bus Routes' },
  { module: 'bus-ops', action: 'edit',    resource: 'routes',    label: 'Edit Bus Routes' },
  { module: 'bus-ops', action: 'delete',  resource: 'routes',    label: 'Delete Bus Routes' },
  { module: 'bus-ops', action: 'create',  resource: 'trips',     label: 'Schedule Trips' },
  { module: 'bus-ops', action: 'approve', resource: 'trips',     label: 'Depart / Complete Trips' },
  { module: 'bus-ops', action: 'create',  resource: 'staff',     label: 'Register Staff' },
  { module: 'bus-ops', action: 'edit',    resource: 'staff',     label: 'Edit Staff Records' },
  { module: 'bus-ops', action: 'create',  resource: 'incidents', label: 'Log Incidents' },
  { module: 'bus-ops', action: 'approve', resource: 'incidents', label: 'Resolve Incidents' },
  { module: 'bus-ops', action: 'export',  resource: '*',         label: 'Export Transport Data' },
  { module: 'bus-ops', action: 'edit',    resource: 'route-consolidation-scoring-policy', label: 'Edit Route Consolidation Scoring Policy' },
  // Tenant-Admin-only planning/optimization engines. Deliberately a
  // distinct 'admin' action (not 'view') — the existing
  // { action: 'view', resource: '*' } row above is already granted to
  // Transport Manager/Operator, and hasPermission()'s resource-wildcard
  // match (`bus-ops:view:*`) would silently defeat a same-action
  // resource-specific row. 'admin' has no wildcard row anywhere, so
  // these are exclusively opt-in per role. Still explicitly excluded
  // from Transport Manager/Operator below as a second, explicit layer —
  // don't rely on the action-naming trick alone to keep this working if
  // someone reworks those filters later.
  { module: 'bus-ops', action: 'admin', resource: 'planning-core', label: 'Access Planning Core (runcutting/blocking/roster)' },
  { module: 'bus-ops', action: 'admin', resource: 'route-consolidation', label: 'Access Route Consolidation Engine' },
  { module: 'bus-ops', action: 'admin', resource: 'planning-constraints', label: 'Access Planning Constraints Engine (PCE)' },
  { module: 'bus-ops', action: 'admin', resource: 'vehicle-resource-optimization', label: 'Access Vehicle/Resource Optimization Engine' },
  // CBA rule-sets drive pay and hours-of-service, and headway rules bind to
  // them via HeadwayRule.cbaRuleSetId. Both screens and both APIs shipped
  // with no RBAC gate at all — any authenticated user in the tenant could
  // read and rewrite them. Kept as separate resources rather than folded
  // into planning-core so the two can be granted independently later.
  { module: 'bus-ops', action: 'admin', resource: 'cba-rules', label: 'Manage CBA / Union Rule Sets' },
  { module: 'bus-ops', action: 'admin', resource: 'headway',   label: 'Manage Headway Rules' },

  // ── FLEET ──────────────────────────────────────────────────────────────
  { module: 'fleet', action: 'view',    resource: '*',       label: 'View Fleet Module' },
  { module: 'fleet', action: 'create',  resource: 'vehicles', label: 'Add Vehicles' },
  { module: 'fleet', action: 'edit',    resource: 'vehicles', label: 'Edit Vehicles' },
  { module: 'fleet', action: 'delete',  resource: 'vehicles', label: 'Retire Vehicles' },
  { module: 'fleet', action: 'create',  resource: 'documents', label: 'Upload Fleet Documents' },
  { module: 'fleet', action: 'export',  resource: '*',        label: 'Export Fleet Data' },

  // ── MAINTENANCE ────────────────────────────────────────────────────────
  { module: 'maintenance', action: 'view',    resource: '*',          label: 'View Maintenance Module' },
  { module: 'maintenance', action: 'create',  resource: 'requests',   label: 'Create Service Requests' },
  { module: 'maintenance', action: 'edit',    resource: 'requests',   label: 'Edit Service Requests' },
  { module: 'maintenance', action: 'approve', resource: 'requests',   label: 'Approve Service Requests' },
  { module: 'maintenance', action: 'create',  resource: 'work_orders', label: 'Create Work Orders' },
  { module: 'maintenance', action: 'approve', resource: 'work_orders', label: 'Close Work Orders' },
  { module: 'maintenance', action: 'export',  resource: '*',          label: 'Export Maintenance Data' },

  // ── FINANCE ────────────────────────────────────────────────────────────
  { module: 'finance', action: 'view',    resource: '*',       label: 'View Finance Module' },
  { module: 'finance', action: 'create',  resource: 'invoices', label: 'Create Finance Invoices' },
  { module: 'finance', action: 'approve', resource: 'invoices', label: 'Approve Finance Invoices' },
  { module: 'finance', action: 'view',    resource: 'reports',  label: 'View Financial Reports' },
  { module: 'finance', action: 'export',  resource: '*',        label: 'Export Finance Data' },

  // ── DRIVERS (was 'drivers' pre-migration, canonical 'driver-mgmt') ─────
  { module: 'driver-mgmt', action: 'view',    resource: '*',        label: 'View Drivers Module' },
  { module: 'driver-mgmt', action: 'create',  resource: 'profiles', label: 'Add Driver Profiles' },
  { module: 'driver-mgmt', action: 'edit',    resource: 'profiles', label: 'Edit Driver Profiles' },
  { module: 'driver-mgmt', action: 'delete',  resource: 'profiles', label: 'Deactivate Drivers' },
  { module: 'driver-mgmt', action: 'export',  resource: '*',        label: 'Export Driver Data' },

  // ── COMPLIANCE ─────────────────────────────────────────────────────────
  { module: 'compliance', action: 'view',    resource: '*',      label: 'View Compliance Module' },
  { module: 'compliance', action: 'create',  resource: '*',      label: 'Add Compliance Records' },
  { module: 'compliance', action: 'approve', resource: '*',      label: 'Approve Compliance Items' },
  { module: 'compliance', action: 'export',  resource: '*',      label: 'Export Compliance Data' },

  // ── REPORTS ────────────────────────────────────────────────────────────
  { module: 'reports', action: 'view',   resource: '*', label: 'View Reports' },
  { module: 'reports', action: 'export', resource: '*', label: 'Export Reports' },

  // ── ADMIN ──────────────────────────────────────────────────────────────
  { module: 'admin', action: 'view',   resource: 'tenants', label: 'View Tenants' },
  { module: 'admin', action: 'create', resource: 'tenants', label: 'Create Tenants' },
  { module: 'admin', action: 'edit',   resource: 'tenants', label: 'Edit Tenants' },
  { module: 'admin', action: 'delete', resource: 'tenants', label: 'Delete Tenants' },
  { module: 'admin', action: 'view',   resource: 'users',   label: 'View All Users' },
  { module: 'admin', action: 'create', resource: 'users',   label: 'Create Users' },
  { module: 'admin', action: 'edit',   resource: 'users',   label: 'Edit Users' },
  { module: 'admin', action: 'delete', resource: 'users',   label: 'Deactivate Users' },
  { module: 'admin', action: 'view',   resource: 'roles',   label: 'View Roles' },
  { module: 'admin', action: 'create', resource: 'roles',   label: 'Create Roles' },
  { module: 'admin', action: 'edit',   resource: 'roles',   label: 'Edit Role Permissions' },
  { module: 'admin', action: 'delete', resource: 'roles',   label: 'Delete Roles' },

  // ── Modules without resource-level permissions (policy v1) ─────────────
  // Every module an API area maps to in src/lib/authz/policy-matrix.ts has
  // its permissions here, so the authorization policy never needs a role
  // outside this catalogue. Appended at the end: the session permission
  // claim encodes catalogue positions (src/lib/authz/permission-claim.ts).
  // School Bus
  { module: 'school-bus', action: 'view', resource: '*', label: 'View School Bus' },
  { module: 'school-bus', action: 'create', resource: '*', label: 'Create School Bus' },
  { module: 'school-bus', action: 'edit', resource: '*', label: 'Edit School Bus' },
  { module: 'school-bus', action: 'delete', resource: '*', label: 'Delete School Bus' },
  { module: 'school-bus', action: 'approve', resource: '*', label: 'Approve School Bus' },
  { module: 'school-bus', action: 'export', resource: '*', label: 'Export School Bus' },
  // Logistics
  { module: 'logistics', action: 'view', resource: '*', label: 'View Logistics' },
  { module: 'logistics', action: 'create', resource: '*', label: 'Create Logistics' },
  { module: 'logistics', action: 'edit', resource: '*', label: 'Edit Logistics' },
  { module: 'logistics', action: 'delete', resource: '*', label: 'Delete Logistics' },
  { module: 'logistics', action: 'approve', resource: '*', label: 'Approve Logistics' },
  { module: 'logistics', action: 'export', resource: '*', label: 'Export Logistics' },
  // Incidents & Ambulance
  { module: 'incidents', action: 'view', resource: '*', label: 'View Incidents & Ambulance' },
  { module: 'incidents', action: 'create', resource: '*', label: 'Create Incidents & Ambulance' },
  { module: 'incidents', action: 'edit', resource: '*', label: 'Edit Incidents & Ambulance' },
  { module: 'incidents', action: 'delete', resource: '*', label: 'Delete Incidents & Ambulance' },
  { module: 'incidents', action: 'approve', resource: '*', label: 'Approve Incidents & Ambulance' },
  { module: 'incidents', action: 'export', resource: '*', label: 'Export Incidents & Ambulance' },
  // Dispatch
  { module: 'dispatch', action: 'view', resource: '*', label: 'View Dispatch' },
  { module: 'dispatch', action: 'create', resource: '*', label: 'Create Dispatch' },
  { module: 'dispatch', action: 'edit', resource: '*', label: 'Edit Dispatch' },
  { module: 'dispatch', action: 'delete', resource: '*', label: 'Delete Dispatch' },
  { module: 'dispatch', action: 'approve', resource: '*', label: 'Approve Dispatch' },
  { module: 'dispatch', action: 'export', resource: '*', label: 'Export Dispatch' },
  // Service Tickets
  { module: 'service-tickets', action: 'view', resource: '*', label: 'View Service Tickets' },
  { module: 'service-tickets', action: 'create', resource: '*', label: 'Create Service Tickets' },
  { module: 'service-tickets', action: 'edit', resource: '*', label: 'Edit Service Tickets' },
  { module: 'service-tickets', action: 'delete', resource: '*', label: 'Delete Service Tickets' },
  { module: 'service-tickets', action: 'approve', resource: '*', label: 'Approve Service Tickets' },
  { module: 'service-tickets', action: 'export', resource: '*', label: 'Export Service Tickets' },
  // Customers
  { module: 'customer-mgmt', action: 'view', resource: '*', label: 'View Customers' },
  { module: 'customer-mgmt', action: 'create', resource: '*', label: 'Create Customers' },
  { module: 'customer-mgmt', action: 'edit', resource: '*', label: 'Edit Customers' },
  { module: 'customer-mgmt', action: 'delete', resource: '*', label: 'Delete Customers' },
  { module: 'customer-mgmt', action: 'approve', resource: '*', label: 'Approve Customers' },
  { module: 'customer-mgmt', action: 'export', resource: '*', label: 'Export Customers' },
  // Bookings
  { module: 'booking-portal', action: 'view', resource: '*', label: 'View Bookings' },
  { module: 'booking-portal', action: 'create', resource: '*', label: 'Create Bookings' },
  { module: 'booking-portal', action: 'edit', resource: '*', label: 'Edit Bookings' },
  { module: 'booking-portal', action: 'delete', resource: '*', label: 'Delete Bookings' },
  { module: 'booking-portal', action: 'approve', resource: '*', label: 'Approve Bookings' },
  { module: 'booking-portal', action: 'export', resource: '*', label: 'Export Bookings' },
  // Assets
  { module: 'assets', action: 'view', resource: '*', label: 'View Assets' },
  { module: 'assets', action: 'create', resource: '*', label: 'Create Assets' },
  { module: 'assets', action: 'edit', resource: '*', label: 'Edit Assets' },
  { module: 'assets', action: 'delete', resource: '*', label: 'Delete Assets' },
  { module: 'assets', action: 'approve', resource: '*', label: 'Approve Assets' },
  { module: 'assets', action: 'export', resource: '*', label: 'Export Assets' },
  // Sustainability
  { module: 'sustainability', action: 'view', resource: '*', label: 'View Sustainability' },
  { module: 'sustainability', action: 'create', resource: '*', label: 'Create Sustainability' },
  { module: 'sustainability', action: 'edit', resource: '*', label: 'Edit Sustainability' },
  { module: 'sustainability', action: 'delete', resource: '*', label: 'Delete Sustainability' },
  { module: 'sustainability', action: 'approve', resource: '*', label: 'Approve Sustainability' },
  { module: 'sustainability', action: 'export', resource: '*', label: 'Export Sustainability' },
  // AI Agents
  { module: 'agents', action: 'view', resource: '*', label: 'View AI Agents' },
  { module: 'agents', action: 'create', resource: '*', label: 'Create AI Agents' },
  { module: 'agents', action: 'edit', resource: '*', label: 'Edit AI Agents' },
  { module: 'agents', action: 'delete', resource: '*', label: 'Delete AI Agents' },
  { module: 'agents', action: 'approve', resource: '*', label: 'Approve AI Agents' },
  { module: 'agents', action: 'export', resource: '*', label: 'Export AI Agents' },
  // Appended 2026-09-30 (keep new entries at the end: claims are encoded by
  // catalogue position). Routes already required these, but no role could
  // hold them, so under AUTHZ_MODE=enforce even TENANT_ADMIN was refused.
  { module: 'finance', action: 'edit', resource: '*', label: 'Edit Finance Records' },
  { module: 'finance', action: 'delete', resource: '*', label: 'Delete Finance Records' },
  { module: 'leasing', action: 'edit', resource: 'renewals', label: 'Edit Contract Renewals' },
  { module: 'bus-ops', action: 'create', resource: 'route-consolidation', label: 'Run Route Consolidation' },
  { module: 'bus-ops', action: 'edit', resource: 'incidents', label: 'Update Incidents' },
  { module: 'reports', action: 'create', resource: '*', label: 'Schedule Reports' },
];

// Helper: all modules view only permissions
const ALL_MODULES_VIEW_ONLY = MODULES.map(m => ({ module: m as string, action: 'view', resource: '*' }));

/**
 * bus-ops resources carved out of Transport Manager/Operator's otherwise-
 * blanket module grant below — currently empty, meaning Planning Core,
 * Route Consolidation (+ its scoring policy), Planning Constraints (PCE),
 * and Vehicle/Resource Optimization are open to Transport Manager and
 * Transport Operator, same as every other bus-ops resource. Re-add a
 * resource name here (see git history for the original 5-entry list) to
 * scope it back to Tenant Admin / Super Admin only — the bus-ops:admin:*
 * permission rows above and requireBusOpsAdminAccess() server-side checks
 * stay in place either way, so restoring the restriction is a one-line
 * change with no other code to touch.
 */
const BUS_OPS_ADMIN_ONLY_RESOURCES: string[] = ['device-credentials', 'jobs', 'finance-recharge'];

// ── System roles ────────────────────────────────────────────────────────────

export const SYSTEM_ROLES: {
  code: string;
  name: string;
  description: string;
  permissions: { module: string; action: string; resource: string }[];
}[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full platform access - all tenants, all modules, all actions',
    permissions: ALL_PERMISSIONS.map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'TENANT_ADMIN',
    name: 'Tenant Administrator',
    description: 'Full access within their tenant - all modules except platform admin',
    permissions: ALL_PERMISSIONS.filter(p => p.module !== 'admin').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'LEASING_MANAGER',
    name: 'Leasing Manager',
    description: 'Full leasing + finance view + reports',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'leasing').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'finance', action: 'view', resource: '*' },
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
      { module: 'reports', action: 'create', resource: '*' },
    ],
  },
  {
    code: 'LEASING_OPERATOR',
    name: 'Leasing Operator',
    description: 'Create and edit leasing records, no approve or delete',
    permissions: ALL_PERMISSIONS.filter(p => p.module === 'leasing' && ['view','create','edit'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'RAC_MANAGER',
    name: 'RAC Manager',
    description: 'Full Rent-a-Car module access',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'rental').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'reports', action: 'view', resource: '*' },
    ],
  },
  {
    code: 'RAC_OPERATOR',
    name: 'RAC Operator',
    description: 'Create and edit RAC records, no approve or delete',
    permissions: ALL_PERMISSIONS.filter(p => p.module === 'rental' && ['view','create','edit'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'TRANSPORT_MANAGER',
    name: 'Transport Manager',
    description: 'Full staff transportation module access, including Planning Core, Route Consolidation, Planning Constraints (PCE), Vehicle/Resource Optimization, CBA rule-sets, and Headway rules',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'bus-ops' && !BUS_OPS_ADMIN_ONLY_RESOURCES.includes(p.resource)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'reports', action: 'view', resource: '*' },
      // School Bus and Dispatch are part of the transport operation; vehicles
      // and drivers are read so they can be assigned to routes and trips.
      ...ALL_PERMISSIONS.filter(p => ['school-bus', 'dispatch'].includes(p.module)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'fleet', action: 'view', resource: '*' },
      { module: 'driver-mgmt', action: 'view', resource: '*' },
    ],
  },
  {
    code: 'TRANSPORT_OPERATOR',
    name: 'Transport Operator',
    description: 'Create and edit transport records, can depart/complete trips, including Planning Core, Route Consolidation, Planning Constraints (PCE), Vehicle/Resource Optimization, CBA rule-sets, and Headway rules',
    // 'admin' included alongside view/create/edit/approve so the
    // bus-ops:admin:<resource> rows (Planning Core, Route Consolidation,
    // Planning Constraints, Vehicle/Resource Optimization, CBA rule-sets,
    // Headway rules) are covered —
    // without it, this whitelist-by-action filter would silently drop
    // access to those 4 features even after removing their resource
    // names from BUS_OPS_ADMIN_ONLY_RESOURCES above.
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'bus-ops' && ['view','create','edit','approve','admin'].includes(p.action) && !BUS_OPS_ADMIN_ONLY_RESOURCES.includes(p.resource)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      // School Bus and Dispatch (no delete, as for bus-ops); vehicles and
      // drivers read-only, to assign them to routes and trips.
      ...ALL_PERMISSIONS.filter(p => ['school-bus', 'dispatch'].includes(p.module) && ['view','create','edit','approve'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'fleet', action: 'view', resource: '*' },
      { module: 'driver-mgmt', action: 'view', resource: '*' },
    ],
  },
  {
    code: 'FLEET_MANAGER',
    name: 'Fleet Manager',
    description: 'Fleet + Maintenance + Drivers full access',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => ['fleet','maintenance','driver-mgmt','assets'].includes(p.module)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      // Vehicle documents (document intelligence: extract, review, apply).
      { module: 'compliance', action: 'view', resource: '*' },
      { module: 'compliance', action: 'create', resource: '*' },
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
      { module: 'reports', action: 'create', resource: '*' },
    ],
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    description: 'Finance full access + view all modules + export',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'finance').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      ...ALL_MODULES_VIEW_ONLY,
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
      { module: 'reports', action: 'create', resource: '*' },
      { module: 'leasing', action: 'view', resource: 'receivables' },
      { module: 'leasing', action: 'export', resource: '*' },
      // Dunning & collections is a finance-owned workflow — Finance Manager
      // needs these even though the rest of the leasing module stays view-only.
      { module: 'leasing', action: 'create', resource: 'dunning_suppressions' },
      { module: 'leasing', action: 'delete', resource: 'dunning_suppressions' },
      { module: 'leasing', action: 'approve', resource: 'legal_referral' },
      { module: 'leasing', action: 'approve', resource: 'dunning_delivery' },
    ],
  },
  {
    code: 'VIEWER',
    name: 'Read-Only Viewer',
    description: 'View-only access to all modules, no create/edit/delete/approve',
    permissions: ALL_PERMISSIONS.filter(p => p.action === 'view').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    // Staff of a Fleet360 Exchange transport partner, in the tenant that
    // onboarded the partner. No permissions in the tenant's own modules;
    // the middleware confines the role to the partner portal
    // (src/lib/exchange/partner-role.ts). Also created by migration
    // 20260927140000_partner_tenant_role.
    code: 'PARTNER',
    name: 'Partner',
    description: 'Transport partner staff: partner portal only, no access to the tenant\'s own modules',
    permissions: [],
  },
];

// ── Client-side permission helpers ──────────────────────────────────────────

export type UserPermission = `${string}:${string}:${string}`;

export function buildPermissionKey(module: string, action: string, resource = '*'): UserPermission {
  return `${module}:${action}:${resource}`;
}

/**
 * Reverse-map a canonical ModuleKey to all of its legacy aliases.
 * Built once at module load from `LEGACY_MODULE_ALIASES` in `@/lib/modules`.
 * Used by `hasPermission()` so callers can pass a canonical key and still
 * match permStrings written before the kebab-case migration.
 */
const CANONICAL_TO_LEGACY: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(LEGACY_MODULE_ALIASES)) {
    const list = m.get(canonical);
    if (list) list.push(alias);
    else m.set(canonical, [alias]);
  }
  return m;
})();

/**
 * Returns true if the user can perform the requested action.
 *
 * Match order:
 *   1. Empty/null user permissions → false
 *   2. `*:*:*` wildcard in user permissions → true (super admin shortcut)
 *   3. Exact match `module:action:resource`
 *   4. Wildcard resource match `module:action:*`
 *   5. Module-level wildcard `module:*:*`
 *
 * Alias-aware: if `module` is a canonical ModuleKey with legacy aliases
 * (e.g. `'rental'` ↔ `'rac'`), every alias is also tried. This keeps
 * users with pre-migration permStrings (e.g. `'rac:create:*'`) working
 * after this file moves to canonical keys. Callers SHOULD pass canonical
 * keys; the alias lookup is a backward-compat shim, not a public API.
 */
export function hasPermission(
  userPermissions: string[],
  module: string,
  action: string,
  resource = '*'
): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;
  if (userPermissions.includes('*:*:*')) return true;

  const aliases = CANONICAL_TO_LEGACY.get(module);
  const keysToCheck = aliases ? [module, ...aliases] : [module];

  for (const m of keysToCheck) {
    if (userPermissions.includes(`${m}:${action}:${resource}`)) return true;
    if (userPermissions.includes(`${m}:${action}:*`))        return true;
    if (userPermissions.includes(`${m}:*:*`))                return true;
  }
  return false;
}

export function canView(perms: string[], module: string)   { return hasPermission(perms, module, 'view'); }
export function canCreate(perms: string[], module: string, resource = '*') { return hasPermission(perms, module, 'create', resource); }
export function canEdit(perms: string[], module: string, resource = '*')   { return hasPermission(perms, module, 'edit', resource); }
export function canDelete(perms: string[], module: string, resource = '*') { return hasPermission(perms, module, 'delete', resource); }
export function canApprove(perms: string[], module: string, resource = '*'){ return hasPermission(perms, module, 'approve', resource); }
export function canExport(perms: string[], module: string)  { return hasPermission(perms, module, 'export'); }
