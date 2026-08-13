import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

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
    const { stops, ...routeData } = body;
    const route = await prisma.busRoute.create({
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
  } catch (error) {
    console.error('Error creating route:', error);
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}
