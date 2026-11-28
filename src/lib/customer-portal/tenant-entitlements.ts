/**
 * Server loader for tenant-level Customer Portal entitlements.
 * Reads `tenant_modules` and `tenant_feature_overrides` under tenant RLS.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { readTenantFeatureFlags } from '@/lib/tenant-features';
import {
  computeTenantPortalEntitlements,
  type TenantPortalEntitlements,
} from './entitlement-rules';

export * from './entitlement-rules';

/** Loads a tenant's Customer Portal entitlements from `tenant_modules` + `tenant_feature_overrides`. */
export async function getTenantPortalEntitlements(
  tenantId: string,
  tx?: TxClient,
): Promise<TenantPortalEntitlements> {
  const run = async (client: TxClient) => {
    const [moduleRows, flags] = await Promise.all([
      client.tenantModule
        .findMany({
          where: { tenantId, isEnabled: true },
          select: { module: true },
        })
        .catch(() => [] as Array<{ module: string }>),
      readTenantFeatureFlags(client, tenantId).catch(() => ({} as Record<string, boolean>)),
    ]);
    return computeTenantPortalEntitlements({
      enabledModules: moduleRows.map((r) => r.module),
      featureFlags: flags,
    });
  };

  return tx ? run(tx) : withTenantRls(prisma, tenantId, run);
}
