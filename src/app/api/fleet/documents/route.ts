import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const CACHE_TAGS = ['fleet:stats', 'fleet:documents-expiring'];

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const sp = req.nextUrl.searchParams;
        const vehicleId = sp.get('vehicleId');
        const status = sp.get('status');
        const { take, skip, page, limit } = paginate(sp);
        const where = { ...(vehicleId ? { vehicleId } : {}), ...(status ? { status } : {}) };
        const [data, total] = await Promise.all([
          tx.vehicleDocument.findMany({
            where,
            orderBy: { expiryDate: 'asc' },
            take,
            skip,
          }),
          tx.vehicleDocument.count({ where }),
        ]);
        return NextResponse.json(paginatedResponse(data, total, page, limit));
      } catch (e) {
        console.error('Error fetching documents:', e);
        return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
      }
  });
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
        const document = await tx.vehicleDocument.create({ data: body });
        // A new document can shift the expiring-docs list and the fleet-stats
        // counters. Bust the cache so the dashboard and document widgets
        // pick up the change on the next render.
        revalidateCache(CACHE_TAGS);
        return NextResponse.json(document, { status: 201 });
        } catch (e) {
        console.error('Error creating document:', e);
        return NextResponse.json({ error: 'Failed to create document' }, { status: 500 });
      }
  });
}

