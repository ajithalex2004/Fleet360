/**
 * Keeps the database copy of the permission catalogue and the platform
 * system roles in line with the code (src/lib/permissions.ts).
 *
 * Sessions take a platform system role's permissions from the code
 * (src/lib/authz/session-permissions.ts); the database copy is what Admin >
 * Roles lists and what tenant role copies are built from. It used to be
 * written only by POST /api/admin/seed, so it lagged: Admin > Roles showed
 * Finance Manager with 0 permissions while sessions granted it 36.
 *
 * ensurePermissionCatalogSynced() runs the sync once per catalogue version
 * (recorded in platform_settings), so each deploy that changes the
 * catalogue brings the database along on the first Roles read.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/permissions';
import { CATALOGUE_VERSION } from '@/lib/authz/permission-claim';

type Tx = Parameters<Parameters<typeof withPlatformAdmin>[1]>[0];

const VERSION_KEY = 'permission_catalog_version';

/** Upsert every catalogue permission, and each platform system role with exactly its code grants. */
export async function syncPermissionCatalog(tx: Tx): Promise<void> {
  const permValues = ALL_PERMISSIONS.map(p =>
    Prisma.sql`(gen_random_uuid()::text, ${p.module}::text, ${p.action}::text, ${p.resource ?? '*'}::text, ${p.label}::text)`
  );
  await tx.$executeRaw`
    INSERT INTO permissions (id, module, action, resource, label)
    VALUES ${Prisma.join(permValues)}
    ON CONFLICT (module, action, resource)
    DO UPDATE SET label = EXCLUDED.label
  `;

  const allPerms = await tx.permission.findMany({
    select: { id: true, module: true, action: true, resource: true },
  });
  const permMap = new Map<string, string>(
    allPerms.map(p => [`${p.module}:${p.action}:${p.resource ?? '*'}`, p.id])
  );

  for (const sr of SYSTEM_ROLES) {
    let role = await tx.role.findFirst({ where: { code: sr.code, tenantId: null } });
    if (!role) {
      role = await tx.role.create({
        data: { name: sr.name, code: sr.code, description: sr.description, isSystem: true, tenantId: null },
      });
    } else {
      await tx.role.update({ where: { id: role.id }, data: { name: sr.name, description: sr.description, isSystem: true } });
    }
    const permIds = [...new Set(
      sr.permissions
        .map(p => permMap.get(`${p.module}:${p.action}:${p.resource ?? '*'}`))
        .filter((id): id is string => Boolean(id)),
    )];
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permIds.map(permissionId => ({ roleId: role!.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
}

let synced: Promise<boolean> | null = null;

/**
 * Sync once per catalogue version. Resolves true when this call changed the
 * database (callers then drop their caches). Failures are logged and retried
 * on the next call; they never fail the read that triggered them.
 */
export function ensurePermissionCatalogSynced(): Promise<boolean> {
  synced ??= (async () => {
    const rows = await prisma.$queryRawUnsafe<{ value: string | null }[]>(
      `SELECT value FROM platform_settings WHERE key = $1`, VERSION_KEY,
    );
    if (rows[0]?.value === CATALOGUE_VERSION) return false;
    await withPlatformAdmin(prisma, (tx) => syncPermissionCatalog(tx));
    await prisma.$executeRawUnsafe(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      VERSION_KEY, CATALOGUE_VERSION,
    );
    return true;
  })().catch((e) => {
    console.error('[permission-catalog-sync] failed; will retry:', e);
    synced = null;
    return false;
  });
  return synced;
}
