import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

const CACHE_TAG = 'bus-ops:transport-requests';

const getRequests = cacheRead(
  async (tenantId: string | null, status: string | null) => {
    return prisma.staffTransportRequest.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(status   ? { status }   : {}),
      },
      include: { staffMember: true },
      orderBy: { createdAt: 'desc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const tenantId = req.headers.get('x-tenant-id') ?? null;

    const requests = await getRequests(tenantId, status);
    return NextResponse.json(requests, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') ?? null;
    const body = await req.json();
    const count = await prisma.staffTransportRequest.count();
    const requestNo = body.requestNo ?? `REQ-${String(count + 1).padStart(5, '0')}`;
    const request = await prisma.staffTransportRequest.create({
      data: { ...body, requestNo, tenantId },
      include: { staffMember: true },
    });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
