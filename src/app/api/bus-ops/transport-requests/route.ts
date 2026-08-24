import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    const requests = await getRequests(tenantId, status);
    return NextResponse.json(requests, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
    } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const count = await tx.staffTransportRequest.count();
        const requestNo = body.requestNo ?? `REQ-${String(count + 1).padStart(5, '0')}`;
        const request = await tx.staffTransportRequest.create({
          data: { ...body, requestNo, tenantId },
          include: { staffMember: true },
        });
        revalidateCache([CACHE_TAG]);
        return NextResponse.json(request, { status: 201 });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
      }
  });
}

