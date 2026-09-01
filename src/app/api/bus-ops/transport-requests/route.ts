export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAG = 'bus-ops:transport-requests';

// Runs inside unstable_cache (via cacheRead), which strips Next.js request
// context - next/headers() is unavailable there, so the plain prisma client's
// header-based auto-scoping middleware never engages and RLS (force-applied
// to fleet360_app regardless of the WHERE clause) filters out every row for
// every tenant. withTenantRls sets app.tenant_id explicitly from the
// argument instead of relying on headers, matching the pattern already used
// correctly in src/app/api/bus-ops/plan/route.ts.
const getRequests = cacheRead(
  async (tenantId: string | null, status: string | null) => {
    const query = (client: { staffTransportRequest: typeof prisma.staffTransportRequest }) =>
      client.staffTransportRequest.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          ...(status   ? { status }   : {}),
        },
        include: { staffMember: true },
        orderBy: { createdAt: 'desc' },
      });
    return tenantId ? withTenantRls(prisma, tenantId, query) : query(prisma);
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
        // Highest existing number for THIS tenant, not a global row count.
        //
        // The count was unscoped, so REQ- numbers were a platform-wide sequence:
        // a tenant's second request could be REQ-00087, and the number leaked
        // how many requests every other organisation had made. Counting is also
        // wrong on its own terms — delete a row and the next number collides
        // with one already issued. uniq_staff_transport_requests_tenant_request_no
        // now rejects that rather than letting it through.
        const [{ max }] = await tx.$queryRawUnsafe<Array<{ max: number | null }>>(
          `SELECT MAX(NULLIF(regexp_replace(request_no, '^REQ-', ''), '')::int) AS max
             FROM staff_transport_requests
            WHERE tenant_id = $1 AND request_no ~ '^REQ-[0-9]+$'`,
          tenantId,
        );
        const requestNo = body.requestNo ?? `REQ-${String((max ?? 0) + 1).padStart(5, '0')}`;
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

