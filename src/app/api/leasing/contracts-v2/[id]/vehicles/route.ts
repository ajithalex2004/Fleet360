export const dynamic = 'force-dynamic';

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

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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
      const vehicles = await (tx as any).leaseContractVehicle.findMany({
        where: { tenantId, contractId: params.id },
      });
      return NextResponse.json(vehicles.map((v: any) => ({
        id: v.id,
        type: v.vehicleType ?? v.type ?? '',
        make: v.make ?? '',
        model: v.model ?? '',
        year: v.year ?? null,
        licensePlate: v.licensePlate ?? v.plateNumber ?? '',
        driver: v.driverId ?? v.driverName ?? v.driver ?? '',
        monthlyRate: v.monthlyRate != null ? Number(v.monthlyRate) : 0,
        status: v.status ?? 'ACTIVE',
      })));
    } catch (e: any) {
      console.error('GET vehicles error:', e?.message);
      return NextResponse.json([], { status: 200 });
    }
  });
}


export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(request);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const raw = await request.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(
        (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>,
      );
      const {
        type,
        make,
        model,
        year,
        licensePlate,
        driver,
        driverId,
        monthlyRate,
        vehicleId,
        vin,
        mileageStart,
        status,
      } = body as Record<string, any>;

      const contract = await tx.leaseContract2.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        select: { id: true, status: true, monthlyRate: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
      }

      const contractStatus = (contract.status || '').toUpperCase();
      if (['TERMINATED', 'CLOSED'].includes(contractStatus)) {
        return NextResponse.json({ error: 'Cannot allocate vehicles to a terminated or closed contract' }, { status: 400 });
      }

      // Look up real fleet vehicle by vehicleId or licensePlate if provided
      let realVehicle: any = null;
      if (vehicleId || licensePlate) {
        realVehicle = await tx.vehicle.findFirst({
          where: {
            tenantId,
            deletedAt: null,
            ...(vehicleId ? { id: String(vehicleId) } : { licensePlate: String(licensePlate) }),
          },
        });
        if (vehicleId && !realVehicle) {
          return NextResponse.json({ error: 'Specified vehicle not found in this tenant' }, { status: 404 });
        }
      }

      if (realVehicle) {
        if (realVehicle.isActive === false) {
          return NextResponse.json({ error: 'Vehicle is not active' }, { status: 400 });
        }
        const vStatus = (realVehicle.status || '').toUpperCase();
        if (['SOLD', 'DECOMMISSIONED', 'INACTIVE', 'RENTED'].includes(vStatus)) {
          return NextResponse.json({ error: `Vehicle is not available for allocation (status: ${realVehicle.status})` }, { status: 400 });
        }

        // Check for conflicting active contract allocation (double-booking protection)
        const activeAllocation = await (tx as any).leaseContractVehicle.findFirst({
          where: {
            tenantId,
            vehicleId: realVehicle.id,
            status: 'ACTIVE',
            contract: {
              status: { in: ['ACTIVE', 'APPROVED', 'DRAFT'] },
              deletedAt: null,
            },
          },
        });
        if (activeAllocation) {
          return NextResponse.json({ error: 'Vehicle is already allocated to another active lease contract' }, { status: 409 });
        }
      }

      // Rate validation and inheritance
      let finalMonthlyRate: number;
      if (monthlyRate !== undefined && monthlyRate !== null && monthlyRate !== '') {
        const parsedRate = Number(monthlyRate);
        if (isNaN(parsedRate) || parsedRate < 0) {
          return NextResponse.json({ error: 'monthlyRate must be a non-negative number' }, { status: 400 });
        }
        finalMonthlyRate = parsedRate;
      } else {
        // Inherit from parent contract
        finalMonthlyRate = contract.monthlyRate != null ? Number(contract.monthlyRate) : 0;
      }

      const vehicleTypeVal = realVehicle?.type ?? type;
      if (!vehicleTypeVal) {
        return NextResponse.json({ error: 'Vehicle type is required' }, { status: 400 });
      }
      const plateVal = realVehicle?.licensePlate ?? licensePlate;
      if (!plateVal) {
        return NextResponse.json({ error: 'License plate is required' }, { status: 400 });
      }

      const vehicle = await (tx as any).leaseContractVehicle.create({
        data: {
          contractId: params.id,
          vehicleId: realVehicle?.id ?? (vehicleId ? String(vehicleId) : null),
          vehicleType: String(vehicleTypeVal),
          make: realVehicle?.make ?? (make ? String(make) : null),
          model: realVehicle?.model ?? (model ? String(model) : null),
          year: realVehicle?.year != null ? Number(realVehicle.year) : (year != null ? Number(year) : null),
          licensePlate: String(plateVal),
          vin: realVehicle?.vin ?? (vin ? String(vin) : null),
          driverId: driverId ? String(driverId) : (driver ? String(driver) : null),
          monthlyRate: finalMonthlyRate,
          mileageStart: mileageStart != null ? Number(mileageStart) : (realVehicle?.currentMileage != null ? Number(realVehicle.currentMileage) : null),
          status: status ? String(status) : 'ACTIVE',
          tenantId,
        },
      });

      if (realVehicle) {
        await tx.vehicle.update({
          where: { id: realVehicle.id },
          data: {
            status: 'RESERVED',
            lifecycleStage: 'ALLOCATED',
          },
        });
      }

      return NextResponse.json({
        id: vehicle.id,
        vehicleId: vehicle.vehicleId ?? null,
        type: vehicle.vehicleType ?? vehicle.type ?? vehicleTypeVal,
        make: vehicle.make ?? make ?? '',
        model: vehicle.model ?? model ?? '',
        year: vehicle.year ?? year ?? null,
        licensePlate: vehicle.licensePlate ?? plateVal,
        driver: vehicle.driverId ?? driver ?? '',
        monthlyRate: vehicle.monthlyRate != null ? Number(vehicle.monthlyRate) : finalMonthlyRate,
        status: vehicle.status ?? 'ACTIVE',
      }, { status: 201 });
    } catch (e: any) {
      console.error('POST /api/leasing/contracts-v2/[id]/vehicles error:', e?.message);
      return NextResponse.json({ error: e?.message ?? 'Failed to add vehicle' }, { status: 500 });
    }
  });
}

