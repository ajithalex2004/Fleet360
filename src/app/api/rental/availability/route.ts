export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { serializeVehicleForJson, withSavepoint } from '@/lib/rental/locks';
import { categoriesMatch } from '@/lib/rental-rate-engine';
import { findGroundingBlocks } from '@/lib/fleet/grounding-blocks';

// GET /api/rental/availability?startDate=...&endDate=...&category=...&includeMaintenance=true
// Also accepts pickupDate / dropoffDate aliases.
// Returns BigInt-safe vehicles NOT booked, out on an active agreement, in open workshop
// work_orders, grounded by Fleet compliance/tickets/maintenance, or allocated to active leases.
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const startParam = searchParams.get('pickupDate') ?? searchParams.get('startDate');
      const endParam = searchParams.get('dropoffDate') ?? searchParams.get('endDate');
      const category = searchParams.get('category') ?? searchParams.get('vehicleCategory');
      const includeMaintenance = searchParams.get('includeMaintenance') === 'true';
      const excludeBookingId = searchParams.get('excludeBookingId');

      const parsedStart = startParam ? new Date(startParam) : null;
      const parsedEnd = endParam ? new Date(endParam) : null;
      const hasValidWindow =
        parsedStart !== null &&
        parsedEnd !== null &&
        !Number.isNaN(parsedStart.getTime()) &&
        !Number.isNaN(parsedEnd.getTime()) &&
        parsedEnd.getTime() >= parsedStart.getTime();

      if (
        (startParam || endParam) &&
        parsedStart !== null &&
        parsedEnd !== null &&
        !Number.isNaN(parsedStart.getTime()) &&
        !Number.isNaN(parsedEnd.getTime()) &&
        parsedEnd.getTime() < parsedStart.getTime()
      ) {
        return NextResponse.json(
          { error: 'endDate / dropoffDate must be on or after startDate / pickupDate' },
          { status: 400 },
        );
      }

      // 1. Conflicting CONFIRMED / ACTIVE bookings in [pickupDate, dropoffDate]
      const conflictingBookings = await tx.rentalBooking.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ['CONFIRMED', 'ACTIVE'] },
          vehicleId: { not: null },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
          ...(hasValidWindow
            ? parsedStart.getTime() === parsedEnd.getTime()
              ? {
                  AND: [
                    { pickupDate: { lte: parsedEnd } },
                    { dropoffDate: { gte: parsedStart } },
                  ],
                }
              : {
                  AND: [
                    { pickupDate: { lt: parsedEnd } },
                    { dropoffDate: { gt: parsedStart } },
                  ],
                }
            : {}),
        },
        select: { vehicleId: true },
      });

      // 2. Conflicting ACTIVE rental agreements in [pickupDate, dropoffDate] (excluding soft-deleted rows)
      const rawConflictingAgreements = await tx.rentalAgreement.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          vehicleId: { not: null },
          ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
          ...(hasValidWindow
            ? parsedStart.getTime() === parsedEnd.getTime()
              ? {
                  AND: [
                    { startDate: { lte: parsedEnd } },
                    { endDate: { gte: parsedStart } },
                  ],
                }
              : {
                  AND: [
                    { startDate: { lt: parsedEnd } },
                    { endDate: { gt: parsedStart } },
                  ],
                }
            : {}),
        },
        select: { id: true, vehicleId: true },
      });

      const deletedAgreementRows =
        rawConflictingAgreements.length > 0
          ? await withSavepoint<Array<{ id: string }>>(
              tx,
              'avail_deleted_agreements',
              () =>
                tx.$queryRawUnsafe<Array<{ id: string }>>(
                  `SELECT id::text AS id
                     FROM rental_agreements
                    WHERE tenant_id::text = $1
                      AND id::text = ANY($2::text[])
                      AND deleted_at IS NOT NULL`,
                  tenantId,
                  rawConflictingAgreements.map((a) => a.id),
                ),
              [],
            )
          : [];
      const deletedAgreementIds = new Set(deletedAgreementRows.map((r) => r.id));
      const conflictingAgreements = rawConflictingAgreements.filter(
        (a) => !deletedAgreementIds.has(a.id),
      );

      // 3. Open workshop WorkOrders linked to vehicles via maintenance_requests
      const openWorkOrders = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'avail_open_work_orders',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT mr.vehicle_id::text AS vehicle_id
               FROM "WorkOrder" wo
               JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
              WHERE wo.tenant_id::text = $1
                AND mr.vehicle_id IS NOT NULL
                AND mr.deleted_at IS NULL
                AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
            tenantId,
          ),
        [],
      );

      // 4a. Active lease allocations & v2 contract vehicles
      const activeLeaseAllocations = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'avail_active_lease_allocs',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT lao.vehicle_id::text AS vehicle_id
               FROM lease_allocation_occurrences lao
              WHERE lao.tenant_id::text = $1
                AND lao.vehicle_id IS NOT NULL
                AND lao.status = 'ACTIVE'
             UNION
             SELECT DISTINCT lcv.vehicle_id::text AS vehicle_id
               FROM lease_contract_vehicles lcv
               JOIN lease_contracts_v2 lc ON lc.id = lcv.contract_id
              WHERE lcv.tenant_id::text = $1
                AND lcv.vehicle_id IS NOT NULL
                AND COALESCE(lcv.status, 'ACTIVE') = 'ACTIVE'
                AND UPPER(COALESCE(lc.status, '')) IN ('ACTIVE', 'SIGNED', 'DISPATCHED')`,
            tenantId,
          ),
        [],
      );

      // 4b. Legacy lease_contracts holding physical vehicles
      const activeLeaseContracts = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'avail_active_leases',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT vehicle_id::text AS vehicle_id
               FROM lease_contracts
              WHERE tenant_id::text = $1
                AND vehicle_id IS NOT NULL
                AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'SIGNED', 'DISPATCHED')`,
            tenantId,
          ),
        [],
      );

      // 4c. In-transit inter-branch vehicle transfers
      const inTransitTransfers = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'avail_in_transit_transfers',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT vehicle_id::text AS vehicle_id
               FROM rental_vehicle_transfers
              WHERE tenant_id::text = $1
                AND vehicle_id IS NOT NULL
                AND status = 'IN_TRANSIT'`,
            tenantId,
          ),
        [],
      );

      const occupiedVehicleIdSet = new Set<string>();
      for (const b of conflictingBookings) {
        if (b.vehicleId) occupiedVehicleIdSet.add(b.vehicleId);
      }
      for (const a of conflictingAgreements) {
        if (a.vehicleId) occupiedVehicleIdSet.add(a.vehicleId);
      }
      if (!includeMaintenance) {
        for (const wo of openWorkOrders) {
          if (wo.vehicle_id) occupiedVehicleIdSet.add(wo.vehicle_id);
        }
      }
      for (const la of activeLeaseAllocations) {
        if (la.vehicle_id) occupiedVehicleIdSet.add(la.vehicle_id);
      }
      for (const lc of activeLeaseContracts) {
        if (lc.vehicle_id) occupiedVehicleIdSet.add(lc.vehicle_id);
      }
      for (const tr of inTransitTransfers) {
        if (tr.vehicle_id) occupiedVehicleIdSet.add(tr.vehicle_id);
      }

      const preExcludedIds = Array.from(occupiedVehicleIdSet);

      // 5. When a date window is supplied, vehicles currently RENTED or RESERVED today
      //    with zero overlap in [pickupDate, dropoffDate] are available for that window.
      //    When no date window is supplied, restrict to immediate walk-in AVAILABLE vehicles.
      const allowedStatuses = hasValidWindow
        ? includeMaintenance
          ? ['AVAILABLE', 'RESERVED', 'RENTED', 'MAINTENANCE']
          : ['AVAILABLE', 'RESERVED', 'RENTED']
        : includeMaintenance
          ? ['AVAILABLE', 'MAINTENANCE']
          : null;

      const rawVehicles = await tx.vehicle.findMany({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
          status: allowedStatuses ? { in: allowedStatuses } : 'AVAILABLE',
          ...(preExcludedIds.length > 0 ? { id: { notIn: preExcludedIds } } : {}),
        },
        orderBy: { make: 'asc' },
      });

      // 6. Exclude vehicles with active Fleet grounding blocks (critical DVIR/tickets, workshop, expired mandatory docs)
      const candidateIds = rawVehicles.map((v) => v.id).filter(Boolean);
      const groundingMap =
        candidateIds.length > 0
          ? await withSavepoint(
              tx,
              'avail_grounding_blocks',
              () => findGroundingBlocks(tx, tenantId, candidateIds),
              new Map(),
            )
          : new Map();

      const ungroundedVehicles = rawVehicles.filter((v) => {
        const blocks = groundingMap.get(v.id);
        if (blocks && blocks.length > 0) {
          occupiedVehicleIdSet.add(v.id);
          return false;
        }
        return true;
      });

      const filteredVehicles =
        category && category !== 'ALL'
          ? ungroundedVehicles.filter((v) => {
              const candidate = v.category ?? v.vehicleGroup ?? v.vehicleClass ?? v.type ?? '';
              return candidate ? categoriesMatch(candidate, category) : false;
            })
          : ungroundedVehicles;

      const vehicles = filteredVehicles.map((v) =>
        serializeVehicleForJson(v as unknown as Record<string, unknown>),
      );

      return NextResponse.json({
        available: vehicles.length,
        vehicles,
        booked: occupiedVehicleIdSet.size,
      });
    } catch (e) {
      console.error('Error fetching availability:', e);
      return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
    }
  });
}
