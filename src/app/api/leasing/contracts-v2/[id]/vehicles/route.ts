/**
 * /api/leasing/contracts-v2/[id]/vehicles — list and add contract vehicles.
 *
 * Tenant scoping: requires x-tenant-id. The contract must belong to the
 * caller's tenant; every created LeaseContractVehicle row is stamped with
 * the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const vehicles = await (prisma as any).leaseContractVehicle.findMany({
          where: { tenantId, contractId: params.id },
        });
        return NextResponse.json(vehicles.map((v: any) => ({
          id: v.id,
          type: v.vehicleType ?? v.type ?? '',
          make: v.make ?? '',
          model: v.model ?? '',
          licensePlate: v.licensePlate ?? v.plateNumber ?? '',
          driver: v.driverName ?? v.driver ?? '',
          monthlyRate: v.monthlyRate ?? 0,
          status: v.status ?? 'Active',
        })));
      } catch (e) {
        console.error('GET vehicles error:', e?.message);
        return NextResponse.json([], { status: 200 });
      }
  });
}


export async function POST(request: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const body = await request.json();
        const { type, make, model, licensePlate, driver, monthlyRate } = body;

        if (!type) return NextResponse.json({ error: 'Vehicle type is required' }, { status: 400 });
        if (!licensePlate) return NextResponse.json({ error: 'License plate is required' }, { status: 400 });

        const contract = await tx.leaseContract2.findFirst({
          where: { id: params.id, tenantId },
          select: { id: true },
        });
        if (!contract) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // Try to create with Prisma model; fall back to raw SQL if model not found
        let vehicle: any;
        try {
          vehicle = await (prisma as any).leaseContractVehicle.create({
            data: {
              contractId: params.id,
              vehicleType: type,
              make: make ?? null,
              model: model ?? null,
              licensePlate,
              driverName: driver ?? null,
              monthlyRate: parseFloat(monthlyRate) || 0,
              status: 'Active',
              tenantId,
            },
          });
          } catch (e) {
          const result = await tx.$queryRawUnsafe(`
            INSERT INTO "LeaseContractVehicle"
              (id, "contractId", "vehicleType", make, model, "licensePlate", "driverName", "monthlyRate", status, "createdAt", "updatedAt", "tenantId")
            VALUES
              (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'Active', NOW(), NOW(), $8)
            RETURNING *
          `, params.id, type, make ?? null, model ?? null, licensePlate, driver ?? null, parseFloat(monthlyRate) || 0, tenantId);
          vehicle = Array.isArray(result) ? result[0] : result;
        }

        return NextResponse.json({
          id: vehicle.id,
          type: vehicle.vehicleType ?? vehicle.type ?? type,
          make: vehicle.make ?? make ?? '',
          model: vehicle.model ?? model ?? '',
          licensePlate: vehicle.licensePlate ?? licensePlate,
          driver: vehicle.driverName ?? vehicle.driver ?? driver ?? '',
          monthlyRate: vehicle.monthlyRate ?? (parseFloat(monthlyRate) || 0),
          status: vehicle.status ?? 'Active',
        }, { status: 201 });
      } catch (e) {
        console.error('POST /api/leasing/contracts-v2/[id]/vehicles error:', e?.message);
        return NextResponse.json({ error: e?.message ?? 'Failed to add vehicle' }, { status: 500 });
      }
  });
}

