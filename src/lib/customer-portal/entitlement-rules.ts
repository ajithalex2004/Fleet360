/**
 * Browser-safe Customer Portal entitlement rules (Field Services & Transport Services).
 *
 * Shared by:
 *   - Admin UI (`CustomerPortalsProvisioningCard` in Create Tenant & Manage Tenant)
 *   - Server loader (`@/lib/customer-portal/tenant-entitlements`)
 *   - Customer Portal access & Transport Services catalogue enforcement
 */

import { resolveModuleKey } from '@/lib/modules';
import {
  CUSTOMER_PORTAL_FSM_FLAG,
  CUSTOMER_PORTAL_TRANSPORT_FLAG,
} from '@/lib/module-features';
import type { CustomerPortal } from './catalog';

export const TRANSPORT_PORTAL_MODULE_KEYS = [
  'booking-portal',
  'rental',
  'leasing',
  'bus-ops',
  'school-bus',
  'logistics',
  'drayage',
  'dispatch',
] as const;

export const TRANSPORT_VERTICAL_MODULE_KEYS = [
  'rental',
  'leasing',
  'bus-ops',
  'school-bus',
  'logistics',
  'drayage',
  'dispatch',
] as const;

export interface PortalEntitlementDetail {
  enabled: boolean;
  flagEnabled: boolean;
  moduleEnabled: boolean;
}

export interface TenantPortalEntitlements {
  enabledModules: string[];
  hasModuleRestrictions: boolean;
  enabledPortals: CustomerPortal[];
  portals: Record<CustomerPortal, PortalEntitlementDetail>;
  transportModules: string[];
}

/** Pure resolver usable in client components, server routes, and unit tests. */
export function computeTenantPortalEntitlements(input: {
  enabledModules: readonly string[];
  featureFlags: Partial<Record<string, boolean>>;
}): TenantPortalEntitlements {
  const normalizedSet = new Set<string>();
  for (const raw of input.enabledModules) {
    const key = resolveModuleKey(raw);
    if (key) normalizedSet.add(key);
  }

  const enabledModules = [...normalizedSet];
  const hasModuleRestrictions = enabledModules.length > 0;
  const transportModules = TRANSPORT_PORTAL_MODULE_KEYS.filter((k) => normalizedSet.has(k));

  const fsmFlag = input.featureFlags[CUSTOMER_PORTAL_FSM_FLAG] !== false;
  const fsmModule = !hasModuleRestrictions || normalizedSet.has('service-tickets');

  const transportFlag = input.featureFlags[CUSTOMER_PORTAL_TRANSPORT_FLAG] !== false;
  const transportModule = !hasModuleRestrictions || transportModules.length > 0;

  const portals: Record<CustomerPortal, PortalEntitlementDetail> = {
    FSM: {
      enabled: fsmFlag && fsmModule,
      flagEnabled: fsmFlag,
      moduleEnabled: fsmModule,
    },
    TRANSPORT: {
      enabled: transportFlag && transportModule,
      flagEnabled: transportFlag,
      moduleEnabled: transportModule,
    },
  };

  const enabledPortals: CustomerPortal[] = [];
  if (portals.FSM.enabled) enabledPortals.push('FSM');
  if (portals.TRANSPORT.enabled) enabledPortals.push('TRANSPORT');

  return {
    enabledModules,
    hasModuleRestrictions,
    enabledPortals,
    portals,
    transportModules,
  };
}

/** Whether a Transport catalogue category's linked module is enabled for the tenant. */
export function isCategoryAllowedByTenantModules(
  moduleKey: string | null,
  enabledModules: readonly string[],
  hasModuleRestrictions: boolean,
): boolean {
  if (!hasModuleRestrictions || !moduleKey) return true;
  return enabledModules.includes(moduleKey);
}
