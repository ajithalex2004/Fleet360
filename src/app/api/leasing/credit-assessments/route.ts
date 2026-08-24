/**
 * /api/leasing/credit-assessments — list + create LeaseCreditAssessment.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new row with the same tenantId.
 */

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
        const lesseeId = searchParams.get('lesseeId');
        const items = await tx.leaseCreditAssessment.findMany({
          where: {
            tenantId,
            ...(lesseeId
              ? { lessee: { id: lesseeId, tenantId } }
              : {}),
          },
          include: { lessee: { select: { name: true, type: true } } },
          orderBy: { assessmentDate: 'desc' },
        });
        return NextResponse.json(items);
      } catch (e) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
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
  const body = stripTenantOwnershipFields(bodyRaw);
    const lessee = await prisma.lessee.findFirst({
      where: { id: body.lesseeId, tenantId },
      select: { id: true },
    });
    if (!lessee) {
      return NextResponse.json({ error: 'Lessee not found' }, { status: 404 });
    }
    const item = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseCreditAssessment.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(item, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
