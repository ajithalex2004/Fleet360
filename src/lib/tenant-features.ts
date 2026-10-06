/**
 * Per-tenant feature flag storage for the catalog in `@/lib/module-features`.
 *
 * Flags with a `settingsField` are columns of tenant_settings (the runtime
 * reads them there); the rest are rows of tenant_feature_overrides. Callers
 * pass the transaction client of an RLS scope that covers the tenant
 * (withTenantRls for one tenant, withPlatformAdmin when creating one).
 */
import type { TxClient } from '@/lib/rls';
import {
  MODULE_FEATURES,
  FEATURE_BY_KEY,
  defaultFeatureFlags,
  type FeatureFlagMap,
  type SettingsFlagField,
} from '@/lib/module-features';

/** Stored value of every catalog flag for the tenant; defaults fill the gaps. */
export async function readTenantFeatureFlags(tx: TxClient, tenantId: string): Promise<FeatureFlagMap> {
  const [overrides, settings] = await Promise.all([
    tx.tenantFeatureOverride.findMany({
      where: { tenantId },
      select: { featureKey: true, isEnabled: true },
    }),
    tx.tenantSettings.findUnique({ where: { tenantId } }),
  ]);
  const flags = defaultFeatureFlags();
  for (const o of overrides) {
    const def = FEATURE_BY_KEY[o.featureKey];
    if (def && !def.settingsField) flags[o.featureKey] = o.isEnabled;
  }
  if (settings) {
    for (const def of MODULE_FEATURES) {
      if (def.settingsField) flags[def.key] = Boolean(settings[def.settingsField]);
    }
  }
  return flags;
}

/**
 * Store the given flags (already validated by parseFeatureFlags). Flags not
 * in `flags` are left as they are.
 */
export async function writeTenantFeatureFlags(
  tx: TxClient,
  tenantId: string,
  flags: FeatureFlagMap,
): Promise<void> {
  const settingsData: Partial<Record<SettingsFlagField, boolean>> = {};
  const keys: string[] = [];
  const values: boolean[] = [];
  for (const [key, isEnabled] of Object.entries(flags)) {
    const def = FEATURE_BY_KEY[key];
    if (!def) continue;
    if (def.settingsField) settingsData[def.settingsField] = isEnabled;
    else { keys.push(key); values.push(isEnabled); }
  }
  if (keys.length > 0) {
    // One statement for every flag: the admin routes run inside a
    // transaction with Prisma's default 5 s timeout. set_by is left empty:
    // it has a foreign key to "User", and the route's audit row
    // (withAuditedAction) already records the actor.
    await tx.$executeRaw`
      INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason)
      SELECT ${tenantId}, k, v, 'Tenant module configuration'
      FROM unnest(${keys}::text[], ${values}::boolean[]) AS t(k, v)
      ON CONFLICT (tenant_id, feature_key)
      DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()`;
  }
  if (Object.keys(settingsData).length > 0) {
    await tx.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...settingsData },
      update: { ...settingsData, updatedAt: new Date() },
    });
  }
}
