export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const returns = await tx.leaseVehicleReturn.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { returnDate: 'desc' },
      });
      return NextResponse.json(JSON.parse(JSON.stringify(returns)));
    } catch (e) {
      console.error('Failed to fetch vehicle returns:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (!body.contractNumber || !body.returnDate || !body.inspector) {
        return NextResponse.json({ error: 'contractNumber, returnDate, and inspector are required' }, { status: 400 });
      }

      const created = await tx.leaseVehicleReturn.create({
        data: {
          tenantId,
          contractNumber: body.contractNumber,
          returnDate: new Date(body.returnDate),
          mileage: Number(body.mileage ?? 0),
          condition: body.condition ?? 'Good',
          damages: body.damages ?? null,
          finalCost: body.finalCost ?? 0,
          inspector: body.inspector,
        },
      });
      return NextResponse.json(JSON.parse(JSON.stringify(created)), { status: 201 });
    } catch (e) {
      console.error('Failed to create vehicle return:', e);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  });
}
