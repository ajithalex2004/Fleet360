import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { cacheRead, publicCacheControl, revalidateCache } from '@/lib/server-cache';

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
  try {
    const { searchParams } = new URL(req.url);
    const module = searchParams.get('module');
    const perms = await getPermissions(module);
    return NextResponse.json(perms, {
      headers: { 'Cache-Control': publicCacheControl() },
    });
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
