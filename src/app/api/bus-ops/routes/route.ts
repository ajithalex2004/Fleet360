export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'bus-ops:routes';

// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages and RLS (force-applied
// to fleet360_app regardless of the WHERE clause) filters out every row for
// every tenant. withTenantRls sets app.tenant_id explicitly from the
// argument instead of relying on headers, matching the pattern already used
// correctly in src/app/api/bus-ops/plan/route.ts.
const getRoutes = cacheRead(
  async (tenantId: string, active: string | null) => {
    return withTenantRls(prisma, tenantId, (tx) => tx.busRoute.findMany({
      where: {
        deletedAt: null,
        tenantId,
        ...(active === 'true' ? { isActive: true } : {}),
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }));
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;
    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active');
    const routes = await getRoutes(tenantId, active);
    return NextResponse.json(routes, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    console.error('Error fetching routes:', e);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {

  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { stops, ...routeData } = body;
        const route = await tx.busRoute.create({
          data: {
            ...routeData,
            tenantId,
            stops: stops?.length
              ? { create: stops.map((s: any, i: number) => ({ ...s, sequence: s.sequence ?? i + 1 })) }
              : undefined,
          },
          include: { stops: { orderBy: { sequence: 'asc' } } },
        });
        revalidateCache([CACHE_TAG]);
        return NextResponse.json(route, { status: 201 });
    });
  } catch (e) {
    console.error('Error creating route:', e);
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}

