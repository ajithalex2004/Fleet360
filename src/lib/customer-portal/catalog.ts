/**
 * Customer Portal — portals, roles and Transport categories.
 *
 * Browser-safe (no Node imports) so onboarding screens and server code share
 * one list. A customer is given the FSM and/or TRANSPORT portal; for
 * TRANSPORT the tenant also picks which categories the customer may use.
 * Each account has one role per portal (customer_portal_user_roles).
 */

/**
 * ADMIN      raises requests, manages the company's sites, assets and team
 * REQUESTER  raises and tracks requests
 * FINANCE    views everything, signs agreements and pays invoices; cannot raise requests
 * VIEWER     views only
 */
export type PortalRole = 'ADMIN' | 'REQUESTER' | 'FINANCE' | 'VIEWER';
export const PORTAL_ROLES: PortalRole[] = ['ADMIN', 'REQUESTER', 'FINANCE', 'VIEWER'];

export const ROLE_LABEL: Record<PortalRole, string> = {
  ADMIN: 'Admin', REQUESTER: 'Requester', FINANCE: 'Finance', VIEWER: 'Viewer',
};

/** Roles that may raise (and cancel) requests. */
export const REQUEST_ROLES: PortalRole[] = ['ADMIN', 'REQUESTER'];
export const canRaiseRequests = (role: PortalRole | null | undefined): boolean => !!role && REQUEST_ROLES.includes(role);

export type CustomerPortal = 'FSM' | 'TRANSPORT';
export const CUSTOMER_PORTALS: CustomerPortal[] = ['FSM', 'TRANSPORT'];

export const PORTAL_LABEL: Record<CustomerPortal, string> = {
  FSM: 'Field Services',
  TRANSPORT: 'Transport Services',
};

export type TransportCategory =
  | 'RAC' | 'LEASING' | 'LIMOUSINE' | 'STAFF_TRANSPORT' | 'EXECUTIVE' | 'LOGISTICS' | 'SCHOOL_BUS' | 'RECOVERY';

/** Built-in TransportCategory or a tenant-defined custom category code (e.g. VIP_CONCIERGE). */
export type TransportCategoryCode = TransportCategory | (string & {});

/** Same list as the built-in Transport categories. */
export const TRANSPORT_CATEGORIES: TransportCategory[] = [
  'RAC', 'LEASING', 'LIMOUSINE', 'STAFF_TRANSPORT', 'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS', 'RECOVERY',
];

export const TRANSPORT_CATEGORY_LABEL: Record<TransportCategory, string> = {
  RAC: 'Rent-a-Car',
  LEASING: 'Leasing',
  LIMOUSINE: 'Limousine',
  STAFF_TRANSPORT: 'Staff Transport',
  EXECUTIVE: 'Executive Vehicles',
  LOGISTICS: 'Logistics',
  SCHOOL_BUS: 'School Bus',
  RECOVERY: 'Recovery',
};

const CATEGORY_CODE_RE = /^[A-Z][A-Z0-9_]{1,47}$/;

export function isPortalRole(v: unknown): v is PortalRole { return PORTAL_ROLES.includes(v as PortalRole); }
export function isCustomerPortal(v: unknown): v is CustomerPortal { return CUSTOMER_PORTALS.includes(v as CustomerPortal); }
export function isTransportCategory(v: unknown): v is TransportCategory {
  return TRANSPORT_CATEGORIES.includes(v as TransportCategory);
}

/** True for any valid built-in or tenant-defined custom Transport category code. */
export function isValidCategoryCode(v: unknown): v is string {
  return typeof v === 'string' && CATEGORY_CODE_RE.test(v);
}

/** Normalizes a human title or slug into a valid uppercase category code (e.g. "VIP Shuttle" → "VIP_SHUTTLE"). */
export function normalizeCategoryCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^[0-9_]+/, '')
    .replace(/_+$/, '')
    .slice(0, 48);
}

/** Human label for built-in or custom category codes, with optional tenant title lookup. */
export function categoryLabel(code: string, customTitles?: Record<string, string>): string {
  if (customTitles?.[code]) return customTitles[code];
  if (isTransportCategory(code)) return TRANSPORT_CATEGORY_LABEL[code];
  return code
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** Roles per portal as sent by the onboarding screen; `null` removes the portal. */
export type PortalRoleMap = Partial<Record<CustomerPortal, PortalRole | null>>;

/** Keeps only known portals with a known role or null. */
export function parsePortalRoleMap(v: unknown): PortalRoleMap | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: PortalRoleMap = {};
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    if (!isCustomerPortal(k)) return null;
    if (r === null) out[k] = null;
    else if (isPortalRole(r)) out[k] = r;
    else return null;
  }
  return out;
}

/** Known built-in categories only, de-duplicated, in catalogue order. */
export function parseTransportCategories(v: unknown): TransportCategory[] | null {
  if (!Array.isArray(v) || !v.every(isTransportCategory)) return null;
  return TRANSPORT_CATEGORIES.filter((c) => v.includes(c));
}

/** Built-in and tenant custom category codes, de-duplicated, built-ins first. */
export function parseTenantCategories(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every(isValidCategoryCode)) return null;
  const seen = new Set<string>();
  const builtIn = TRANSPORT_CATEGORIES.filter((c) => {
    if (v.includes(c)) { seen.add(c); return true; }
    return false;
  });
  const custom = v.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });
  return [...builtIn, ...custom];
}
