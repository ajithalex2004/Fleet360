import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const bookingId = searchParams.get('bookingId');
        const inspections = await tx.vehicleInspection.findMany({
          where: { tenantId, ...(bookingId ? { bookingId } : {}) },
          include: { booking: { include: { customer: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(inspections);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
    const body = { ...stripTenantOwnershipFields((bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>), tenantId };
    const inspection = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.vehicleInspection.create({ data: body }),
    );
    return NextResponse.json(inspection, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
