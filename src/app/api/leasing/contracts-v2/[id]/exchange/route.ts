export const dynamic = 'force-dynamic';

/**
 * /api/leasing/contracts-v2/[id]/exchange — list and create vehicle exchanges.
 *
 * Tenant scoping: requires x-tenant-id. The contract must belong to the
 * caller's tenant; the created LeaseVehicleExchange row is stamped with the
 * same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        // Verify contract ownership before exposing exchange history.
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const exchanges = await tx.leaseVehicleExchange.findMany({
          where: { tenantId, contractId: params.id },
          orderBy: { exchangeDate: 'desc' },
        });
        return NextResponse.json(exchanges);
      } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

    const contract = await prisma.leaseContract2.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const exchange = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseVehicleExchange.create({
      data: {
        ...body,
        contractId: params.id,
        exchangeDate: body.exchangeDate ? new Date(body.exchangeDate) : new Date(),
        status: body.status ?? 'PENDING',
        tenantId,
      },
    }),
    );

    // If incoming vehicle provided, update the contract vehicle record.
    // LeaseContractVehicle has no tenant_id column (scoped only via the
    // parent contract), so the contractId + ownership check above is
    // sufficient guard.
    if (body.incomingVehicleId && body.outgoingVehicleId) {
      await withTenantRls(prisma, tenantId, async (tx) =>
        // The source comment claimed LeaseContractVehicle has no tenant
        // column. It does, in both schema.prisma and the database — so the
        // guarantee no longer rests solely on the parent contract check.
        tx.leaseContractVehicle.updateMany({
        where: { tenantId, contractId: params.id, vehicleId: body.outgoingVehicleId },
        data: { vehicleId: body.incomingVehicleId, status: 'EXCHANGED' },
      }),
      );
    }

    return NextResponse.json(exchange, { status: 201 });
    } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
