/**
 * The versioned authorization matrix: which rule decides each API route.
 *
 * Every /api route belongs to exactly one area below (longest matching path
 * prefix wins); tests/unit/authz-policy-matrix.test.ts fails when a route
 * file matches none. The rule kinds, and which model decides them:
 *
 *   module        the role's permissions (catalogue ALL_PERMISSIONS in
 *                 src/lib/permissions.ts). Action from the HTTP method
 *                 (GET view, POST create, PUT/PATCH edit, DELETE delete)
 *                 unless the path says approve/export; resource from the
 *                 path segment after the area when the catalogue has it.
 *   admin-level   ADMIN_ROUTE_POLICY in src/lib/admin-access.ts
 *                 (/api/admin/*: platform | admin | member).
 *   tenant-admin  TENANT_ADMIN or SUPER_ADMIN: tenant configuration.
 *   platform      SUPER_ADMIN only.
 *   self          any signed-in member acting on their own account or
 *                 notifications; the handler scopes to the caller.
 *   partner       Exchange partner portal: partner membership
 *                 (requirePartnerContext in src/lib/exchange/partner-auth.ts).
 *   external      authenticated by the area's own credential (portal or
 *                 driver session, scheduler or webhook secret) and public
 *                 in middleware; no staff permission applies.
 *
 * A rule may differ for reads (GET/HEAD) and writes: { read, write }.
 *
 * The Go backend enforces the same matrix: backend/authz/policy.json is
 * generated from it (src/lib/authz/go-policy.ts), with test vectors both
 * sides must decide identically. Go serves /api/v1/<path> as /api/<path>.
 *
 * Changing the matrix means bumping POLICY_VERSION (and saying why in the
 * commit): the version is logged with every decision.
 */
import type { ModuleKey } from '@/lib/modules';

export const POLICY_VERSION = '2026-10-12.1';

export type Rule =
  | { kind: 'module'; module: ModuleKey; action?: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' }
  | { kind: 'admin-level' }
  | { kind: 'tenant-admin' }
  | { kind: 'platform' }
  | { kind: 'self' }
  | { kind: 'partner' }
  | { kind: 'external' };

export type AreaRule = Rule | { read: Rule; write: Rule };

const m = (module: ModuleKey): Rule => ({ kind: 'module', module });
const SELF: Rule = { kind: 'self' };
const TENANT_ADMIN: Rule = { kind: 'tenant-admin' };
const EXTERNAL: Rule = { kind: 'external' };

/** Path prefix (under /api) → rule. Longest prefix wins. */
export const AREAS: Readonly<Record<string, AreaRule>> = {
  // ── Platform and tenant administration ────────────────────────────────
  admin: { kind: 'admin-level' },
  debug: { kind: 'platform' },
  billing: TENANT_ADMIN,
  'tenant-subscriptions': TENANT_ADMIN,
  'tenant-branches': { read: SELF, write: TENANT_ADMIN },
  tenant: { read: SELF, write: TENANT_ADMIN },
  users: { read: SELF, write: TENANT_ADMIN },
  'integration-configs': TENANT_ADMIN,
  integrations: TENANT_ADMIN,
  'alert-configs': TENANT_ADMIN,
  whatsapp: TENANT_ADMIN,
  workflow: TENANT_ADMIN,
  // Starting a module's workflow (a leasing quotation's approval, …): the
  // handler requires create in that module (module-access.ts).
  'workflow/trigger': { read: TENANT_ADMIN, write: SELF },

  // ── The signed-in user's own things ───────────────────────────────────
  auth: SELF,
  notifications: SELF,
  push: SELF,
  'my-approvals': SELF,
  search: SELF,
  chat: SELF,
  operations: SELF,        // assistant chat
  files: SELF,             // object-level check in src/lib/storage/file-access.ts
  realtime: SELF,
  alerts: SELF,
  'alerts/configs': TENANT_ADMIN,   // Go /api/v1/alerts/configs (as /api/alert-configs)
  places: { read: SELF, write: m('dispatch') },

  // ── Partner portal ────────────────────────────────────────────────────
  exchange: { kind: 'partner' },

  // ── Own credential (portals, devices, schedulers, webhooks, public) ──
  'driver-app': EXTERNAL,
  'leasing-portal': EXTERNAL,
  'carrier-portal': EXTERNAL,
  'shipper-portal': EXTERNAL,
  public: EXTERNAL,
  track: EXTERNAL,
  // Email approval decision links: a signed token per approver and level
  // (src/lib/workflow/decision-link.ts), checked by the handler.
  'approval-link': EXTERNAL,
  webhooks: EXTERNAL,
  stripe: EXTERNAL,
  cron: EXTERNAL,
  jobs: EXTERNAL,
  health: EXTERNAL,
  readyz: EXTERNAL,
  version: EXTERNAL,
  setup: EXTERNAL,
  branding: EXTERNAL,
  platform: EXTERNAL,
  mobile: EXTERNAL,
  tenants: EXTERNAL,       // provisioning and domain verification (public)
  'integrations/enterprise/webhook': EXTERNAL,
  'bus-ops/gateway': EXTERNAL,
  'assets/ble/ingest': EXTERNAL,
  'push/run-scheduler': EXTERNAL,
  'documents/intelligence/cron': EXTERNAL,

  // ── Modules ───────────────────────────────────────────────────────────
  leasing: m('leasing'),
  // Shared document upload: the leasing documents page and the RAC counter.
  // The handler requires leasing or rental create (module-access.ts).
  'leasing/documents/upload': { read: m('leasing'), write: SELF },
  esign: m('leasing'),
  rental: m('rental'),
  'bus-ops': m('bus-ops'),
  // Leasing and rental branch staff (module LEASING | RENTAL | BOTH). The
  // module is in the query or body, so the handler checks it
  // (requireModuleAccess in src/lib/authz/module-access.ts).
  'branch-staff': SELF,
  'route-optimizer': m('bus-ops'),
  'school-bus': m('school-bus'),
  logistics: m('logistics'),
  // A price calculation for the caller's tenant, also asked by shipper-portal
  // tokens (no staff permissions); the Go handler scopes to the tenant.
  'logistics/rates/quote': SELF,
  dispatch: m('dispatch'),
  'dispatch/ambulance-calls': m('incidents'),   // Go /api/v1/dispatch/ambulance-calls
  dispatcher: m('dispatch'),
  incidents: m('incidents'),
  ambulance: m('incidents'),
  fleet: m('fleet'),
  vehicles: m('fleet'),
  telematics: m('fleet'),
  drivers: m('driver-mgmt'),
  maintenance: m('maintenance'),
  service: m('maintenance'),                    // Go /api/v1/service/requests
  'maintenance-requests': m('maintenance'),
  'work-orders': m('maintenance'),
  garages: m('maintenance'),
  finance: m('finance'),
  compliance: m('compliance'),
  documents: m('compliance'),
  reports: m('reports'),
  powerbi: m('reports'),
  'service-tickets': m('service-tickets'),
  'service-requests': m('service-tickets'),
  customers: m('customer-mgmt'),
  'customer-hierarchy': m('customer-mgmt'),
  kyc: m('customer-mgmt'),
  'booking-portal': m('booking-portal'),
  bookings: m('booking-portal'),
  // Customer portal: the signed-in customer's own profile and bookings;
  // the handlers scope every query to the caller (src/lib/customer/portal.ts).
  customer: SELF,
  quotations: m('booking-portal'),
  assets: m('assets'),
  sustainability: m('sustainability'),
  agents: m('agents'),
  // AI panels embedded in a module's own screens are decided by that module,
  // not by the AI agents area.
  'agents/anomalies': m('finance'),
  'agents/preventive-maintenance': m('maintenance'),
  'agents/route-results': m('school-bus'),
};

/**
 * Areas served only by the Go backend (/api/v1/<area>), with no Next.js
 * route file: reached directly or through the shim (src/lib/api-shim.ts).
 * tests/unit/authz-go-policy.test.ts checks each one has a Go route.
 */
export const GO_ONLY_AREAS: readonly string[] = ['alerts/configs', 'dispatch/ambulance-calls', 'logistics/rates/quote', 'service'];

const SORTED_AREAS = Object.keys(AREAS).sort((a, b) => b.length - a.length);

/** The area (key of AREAS) an /api path belongs to, or null. */
export function areaOf(pathname: string): string | null {
  if (!pathname.startsWith('/api/')) return null;
  const rest = pathname.slice('/api/'.length).replace(/\/+$/, '');
  return SORTED_AREAS.find((a) => rest === a || rest.startsWith(`${a}/`)) ?? null;
}
