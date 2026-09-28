export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { cacheRead, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { withAuditedAction } from '@/lib/audited-action';

/**
 * Modules a tenant created here gets when the request names none. Pinned:
 * the permission module list (MODULES in @/lib/permissions) grew with the
 * authorization policy, and that must not change what new tenants get.
 */
const DEFAULT_TENANT_MODULES = [
  'leasing', 'rental', 'bus-ops', 'fleet', 'maintenance', 'finance',
  'driver-mgmt', 'compliance', 'reports', 'admin',
];
const CACHE_TAG = 'tenants:list';

const getTenants = cacheRead(
  async (search: string, limit: number) => withPlatformAdmin(prisma, async (tx) => {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { code: { contains: search, mode: 'insensitive' as const } },
            { id:   { contains: search, mode: 'insensitive' as const } },
            { contactEmail: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return tx.tenant.findMany({
      where,
      include: {
        modules: true,
        _count: { select: { userTenants: true, roles: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }),
  [CACHE_TAG],
);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const limit  = Math.min(parseInt(searchParams.get('limit') ?? '200'), 200);

    // Non-super-admins (e.g. finance branch P&L, tenant pickers) only see
    // their own tenant.
    const tenants = isSuperAdmin(req.headers)
      ? await getTenants(search, limit)
      : await withPlatformAdmin(prisma, (tx) => tx.tenant.findMany({
          where: { id: tenantId },
          include: { modules: true, _count: { select: { userTenants: true, roles: true } } },
        }));
    return NextResponse.json(tenants, {
      // private: the list depends on the caller, so shared caches must not reuse it.
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    return await withPlatformAdmin(prisma, async (tx) => {
      const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
      const {
        enabledModules = DEFAULT_TENANT_MODULES,
        localizedName, localizedDesc, bookingTypes,
        supportedLanguages, defaultLanguage,
        domain, address, contactName, contactEmail, contactPhone,
        plan, industry, code, name,
      } = body;

      const tenant = await tx.tenant.create({
        data: {
          name:              name,
          code:              code   || undefined,
          plan:              plan   || 'STANDARD',
          industry:          industry || undefined,
          domain:            domain   || undefined,
          address:           address  || undefined,
          contactName:       contactName  || undefined,
          contactEmail:      contactEmail || undefined,
          contactPhone:      contactPhone || undefined,
          defaultLanguage:   defaultLanguage  || 'en',
          supportedLanguages: supportedLanguages || 'en',
          localizedName:     localizedName  || undefined,
          localizedDesc:     localizedDesc  || undefined,
          bookingTypes:      bookingTypes   || undefined,
          modules: {
            create: (enabledModules as string[]).map((m: string) => ({ module: m, isEnabled: true })),
          },
        },
        include: { modules: true },
      });
      // New tenant means the cached tenant list is now stale.
      await revalidateCache(CACHE_TAG);
      return NextResponse.json(tenant, { status: 201 });
    });
    } catch (e) {
    console.error('[CREATE TENANT]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
