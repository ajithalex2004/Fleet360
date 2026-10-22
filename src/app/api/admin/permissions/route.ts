export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { cacheRead, publicCacheControl, revalidateCache } from '@/lib/server-cache';
import { ensurePermissionCatalogSynced } from '@/lib/authz/permission-catalog-sync';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'permissions:all';

/**
 * Cached read of the global permission catalog. The catalog is the same
 * for every user and changes maybe once per release when seeders add new
 * permissions — so we cache aggressively and only revalidate when the
 * admin write routes touch the table.
 *
 * Cache key includes the optional `module` filter so each module
 * permutation is cached independently (small catalog, ~108 rows, so
 * the per-key storage is negligible).
 */
const getPermissions = cacheRead(
  async (module: string | null) => withPlatformAdmin(prisma, (tx) =>
    tx.permission.findMany({
      where: module ? { module } : {},
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    })
  ),
  [CACHE_TAG],
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const moduleParam = searchParams.get('module');
    if (await ensurePermissionCatalogSynced()) await revalidateCache([CACHE_TAG, 'roles:all']);
    const perms = await getPermissions(moduleParam);
    return NextResponse.json(perms, {
      headers: { 'Cache-Control': publicCacheControl() },
    });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
