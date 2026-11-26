/**
 * Customer Portal — portals, roles and Transport categories.
 *
 * Browser-safe (no Node imports) so onboarding screens and server code share
 * one list. A customer is given the FSM and/or TRANSPORT portal; for
 * TRANSPORT the tenant also picks which categories the customer may use.
 * Each account has one role per portal (customer_portal_user_roles).
 */

export type PortalRole = 'ADMIN' | 'REQUESTER' | 'VIEWER';
export const PORTAL_ROLES: PortalRole[] = ['ADMIN', 'REQUESTER', 'VIEWER'];

export type CustomerPortal = 'FSM' | 'TRANSPORT';
export const CUSTOMER_PORTALS: CustomerPortal[] = ['FSM', 'TRANSPORT'];

export const PORTAL_LABEL: Record<CustomerPortal, string> = {
  FSM: 'Field Services',
  TRANSPORT: 'Transport Services',
};

export type TransportCategory =
  | 'RAC' | 'LEASING' | 'LIMOUSINE' | 'STAFF_TRANSPORT' | 'EXECUTIVE' | 'LOGISTICS' | 'SCHOOL_BUS' | 'RECOVERY';

/** Same list as the CHECK on customer_portal_access.categories. */
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

export function isPortalRole(v: unknown): v is PortalRole { return PORTAL_ROLES.includes(v as PortalRole); }
export function isCustomerPortal(v: unknown): v is CustomerPortal { return CUSTOMER_PORTALS.includes(v as CustomerPortal); }
export function isTransportCategory(v: unknown): v is TransportCategory {
  return TRANSPORT_CATEGORIES.includes(v as TransportCategory);
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

/** Known categories only, de-duplicated, in catalogue order. */
export function parseTransportCategories(v: unknown): TransportCategory[] | null {
  if (!Array.isArray(v) || !v.every(isTransportCategory)) return null;
  return TRANSPORT_CATEGORIES.filter((c) => v.includes(c));
}
