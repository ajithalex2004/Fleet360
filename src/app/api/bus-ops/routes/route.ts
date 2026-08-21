import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import {
  allocateNextRouteCode,
  isUniqueConstraintError,
} from '@/lib/bus-ops/allocate-route-code';

const CACHE_TAG = 'bus-ops:routes';

const getRoutes = cacheRead(
  async (tenantId: string, active: string | null) => {
    return prisma.busRoute.findMany({
      where: {
        deletedAt: null,
        tenantId,
        ...(active === 'true' ? { isActive: true } : {}),
      },
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active');
    const routes = await getRoutes(tenantId, active);
    return NextResponse.json(routes, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    console.error('Error fetching routes:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { stops, code: bodyCode, ...routeData } = body;

    // Prefer explicit admin-supplied code only if non-empty; otherwise allocate.
    const explicit =
      typeof bodyCode === 'string' && bodyCode.trim().length > 0
        ? bodyCode.trim().toUpperCase()
        : null;

    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const code =
          explicit ??
          (await allocateNextRouteCode(
            prisma,
            tenantId,
            routeData.routeType ?? 'STAFF',
          ));

        const route = await prisma.busRoute.create({
          data: {
            ...routeData,
            tenantId,
            code,
            stops: stops?.length
              ? {
                  create: stops.map((s: Record<string, unknown>, i: number) => ({
                    ...s,
                    sequence: (s.sequence as number | undefined) ?? i + 1,
                  })),
                }
              : undefined,
          },
          include: { stops: { orderBy: { sequence: 'asc' } } },
        });
        revalidateCache([CACHE_TAG]);
        return NextResponse.json(route, { status: 201 });
      } catch (err) {
        lastError = err;
        // Only retry auto-allocation on unique races; explicit code collisions fail fast.
        if (explicit || !isUniqueConstraintError(err) || attempt === maxAttempts - 1) {
          throw err;
        }
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Error creating route:', error);
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: 'Route code already exists for this tenant' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}
