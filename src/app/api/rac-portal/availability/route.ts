export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { findGroundingBlocks } from '@/lib/fleet/grounding-blocks';
import { RENTAL_VEHICLE_CATEGORIES } from '@/lib/rental/categories';
import { serializeVehicleForJson, withSavepoint } from '@/lib/rental/locks';
import {
  ALL_RAC_PORTAL_ROLES,
  BUILTIN_ANCILLARIES,
  canonicalPortalCategory,
  portalCategoriesMatch,
  quoteCorporatePortalRateInTx,
  requireRacPortalRole,
} from '../_helpers';

interface BranchRow {
  id: string;
  branch_code: string;
  branch_name: string;
  emirate: string;
  address: string | null;
  phone: string | null;
  operating_hours: string | null;
  status: string;
}

export interface PublicPortalPreviewVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  category: string;
  transmission: string;
  seats: number;
}

const DEFAULT_UAE_BRANCHES = [
  {
    id: 'default-dxb-t3',
    branchCode: 'DXB-T3',
    branchName: 'Dubai International Airport — Terminal 3 Corporate Desk',
    emirate: 'Dubai',
    address: 'Arrivals Concourse B, DXB Terminal 3',
    phone: '+971 4 220 3600',
    operatingHours: '24 Hours',
  },
  {
    id: 'default-dxb-marina',
    branchCode: 'DXB-MAR',
    branchName: 'Dubai Marina & JLT Corporate Mobility Hub',
    emirate: 'Dubai',
    address: 'Sheikh Zayed Road, Marina Plaza Level G',
    phone: '+971 4 445 3600',
    operatingHours: '08:00 AM - 10:00 PM',
  },
  {
    id: 'default-auh-t1',
    branchCode: 'AUH-T1',
    branchName: 'Zayed International Airport — Abu Dhabi Executive Counter',
    emirate: 'Abu Dhabi',
    address: 'Arrivals Hall, Terminal A, Abu Dhabi',
    phone: '+971 2 505 3600',
    operatingHours: '24 Hours',
  },
  {
    id: 'default-shj-ctr',
    branchCode: 'SHJ-CTR',
    branchName: 'Sharjah Industrial & Corporate Fleet Centre',
    emirate: 'Sharjah',
    address: 'Al Wahda Street, Sharjah',
    phone: '+971 6 555 3600',
    operatingHours: '08:00 AM - 08:00 PM',
  },
];

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const sp = req.nextUrl.searchParams;
    const pickupParam = sp.get('pickupDate');
    const dropoffParam = sp.get('dropoffDate');
    const categoryFilter = sp.get('category')?.trim() || null;
    const pickupLocation = sp.get('pickupLocation')?.trim() || null;
    const insuranceTier = sp.get('insuranceTier')?.trim().toUpperCase() || 'BASIC';
    const ancillariesRaw = sp.get('ancillaries')?.trim() || '';
    const ancillaryCodes = ancillariesRaw
      ? ancillariesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const defaultPickup = new Date(Date.now() + 24 * 3_600_000);
    defaultPickup.setMinutes(0, 0, 0);
    const defaultDropoff = new Date(defaultPickup.getTime() + 3 * 86_400_000);

    const pickupDt = pickupParam ? new Date(pickupParam) : defaultPickup;
    const dropoffDt = dropoffParam ? new Date(dropoffParam) : defaultDropoff;

    if (isNaN(pickupDt.getTime()) || isNaN(dropoffDt.getTime())) {
      return NextResponse.json(
        { error: 'Invalid pickupDate or dropoffDate format' },
        { status: 400 },
      );
    }
    if (dropoffDt <= pickupDt) {
      return NextResponse.json(
        { error: 'Drop-off date and time must be after pick-up date and time' },
        { status: 400 },
      );
    }

    const result = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const branchRows = await withSavepoint<BranchRow[]>(
        tx,
        'rac_avail_branches',
        () =>
          tx.$queryRawUnsafe<BranchRow[]>(
            `SELECT id::text AS id, branch_code, branch_name, emirate, address, phone, operating_hours, status
               FROM rental_branches
              WHERE tenant_id::text = $1
                AND deleted_at IS NULL
                AND status = 'ACTIVE'
              ORDER BY branch_name ASC`,
            ctx.tenantId,
          ),
        [],
      );

      const branches =
        branchRows.length > 0
          ? branchRows.map((b) => ({
              id: b.id,
              branchCode: b.branch_code,
              branchName: b.branch_name,
              emirate: b.emirate,
              address: b.address,
              phone: b.phone,
              operatingHours: b.operating_hours ?? '08:00 AM - 08:00 PM',
            }))
          : DEFAULT_UAE_BRANCHES;

      // Cross-module exclusions: open workshop WorkOrders, active lease allocations, and IN_TRANSIT transfers
      const openWorkOrders = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'rac_avail_open_wo',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT mr.vehicle_id::text AS vehicle_id
               FROM "WorkOrder" wo
               JOIN maintenance_requests mr ON mr.id::text = wo."requestId"::text
              WHERE wo.tenant_id::text = $1
                AND mr.vehicle_id IS NOT NULL
                AND mr.deleted_at IS NULL
                AND UPPER(COALESCE(wo.status::text, '')) NOT IN ('COMPLETED', 'CLOSED', 'CANCELLED')`,
            ctx.tenantId,
          ),
        [],
      );

      const activeLeaseAllocations = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'rac_avail_lease_allocs',
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
            ctx.tenantId,
          ),
        [],
      );

      const activeLeaseContracts = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'rac_avail_lease_legacy',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT vehicle_id::text AS vehicle_id
               FROM lease_contracts
              WHERE tenant_id::text = $1
                AND vehicle_id IS NOT NULL
                AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'SIGNED', 'DISPATCHED')`,
            ctx.tenantId,
          ),
        [],
      );

      const inTransitTransfers = await withSavepoint<Array<{ vehicle_id: string | null }>>(
        tx,
        'rac_avail_transfers',
        () =>
          tx.$queryRawUnsafe<Array<{ vehicle_id: string | null }>>(
            `SELECT DISTINCT vehicle_id::text AS vehicle_id
               FROM rental_vehicle_transfers
              WHERE tenant_id::text = $1
                AND vehicle_id IS NOT NULL
                AND status = 'IN_TRANSIT'`,
            ctx.tenantId,
          ),
        [],
      );

      const crossModuleExcludedIds = new Set<string>();
      for (const r of openWorkOrders) if (r.vehicle_id) crossModuleExcludedIds.add(r.vehicle_id);
      for (const r of activeLeaseAllocations) if (r.vehicle_id) crossModuleExcludedIds.add(r.vehicle_id);
      for (const r of activeLeaseContracts) if (r.vehicle_id) crossModuleExcludedIds.add(r.vehicle_id);
      for (const r of inTransitTransfers) if (r.vehicle_id) crossModuleExcludedIds.add(r.vehicle_id);

      const baseWhereAndOrder = `
           FROM vehicles v
          WHERE v.tenant_id::text = $1
            AND v.deleted_at IS NULL
            AND COALESCE(v.is_active, true) = true
            AND UPPER(COALESCE(v.vehicle_usage, 'RENTAL')) = 'RENTAL'
            AND v.status IN ('AVAILABLE', 'RESERVED', 'RENTED')
            AND NOT EXISTS (
              SELECT 1
                FROM rental_bookings rb
               WHERE rb.tenant_id::text = $1
                 AND rb.vehicle_id = v.id
                 AND rb.deleted_at IS NULL
                 AND rb.status IN ('CONFIRMED', 'ACTIVE')
                 AND rb.pickup_date < $3::timestamptz
                 AND rb.dropoff_date > $2::timestamptz
            )
            AND NOT EXISTS (
              SELECT 1
                FROM rental_agreements ra
               WHERE ra.tenant_id::text = $1
                 AND ra.vehicle_id = v.id
                 AND ra.deleted_at IS NULL
                 AND ra.status = 'ACTIVE'
                 AND ra.start_date < $3::timestamptz
                 AND ra.end_date > $2::timestamptz
            )
          ORDER BY COALESCE(v.category, v.vehicle_group, 'MID_SIZE') ASC, v.make ASC, v.model ASC`;

      const withTransmission = await withSavepoint<Record<string, unknown>[] | null>(
        tx,
        'rac_avail_veh_tx',
        () =>
          tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT v.id, v.make, v.model, v.type, v.year, v.color,
                    v.seating_capacity, v.vehicle_group, v.vehicle_class, v.category,
                    v.transmission
             ${baseWhereAndOrder}`,
            ctx.tenantId,
            pickupDt.toISOString(),
            dropoffDt.toISOString(),
          ),
        null,
      );

      const rawVehicles =
        withTransmission ??
        (await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT v.id, v.make, v.model, v.type, v.year, v.color,
                  v.seating_capacity, v.vehicle_group, v.vehicle_class, v.category
           ${baseWhereAndOrder}`,
          ctx.tenantId,
          pickupDt.toISOString(),
          dropoffDt.toISOString(),
        ));

      const nonExcludedVehicles = rawVehicles.filter(
        (v) => v.id != null && !crossModuleExcludedIds.has(String(v.id)),
      );
      const candidateIds = nonExcludedVehicles.map((v) => String(v.id));
      const groundingMap =
        candidateIds.length > 0
          ? await withSavepoint(
              tx,
              'rac_avail_grounding',
              () => findGroundingBlocks(tx, ctx.tenantId, candidateIds),
              new Map(),
            )
          : new Map();

      const ungroundedVehicles = nonExcludedVehicles.filter(
        (v) => (groundingMap.get(String(v.id)) ?? []).length === 0,
      );

      const matchedInternal = ungroundedVehicles
        .map((v) => {
          const sv = serializeVehicleForJson(v);
          const rawCat = String(
            sv.category ?? sv.vehicle_group ?? sv.vehicle_class ?? sv.type ?? 'MID_SIZE',
          );
          const category = canonicalPortalCategory(rawCat);
          // Redact physical plateNumber / plateCode on availability previews (`PORTAL-06`)
          const publicVehicle: PublicPortalPreviewVehicle = {
            id: String(sv.id),
            make: String(sv.make ?? 'Fleet'),
            model: String(sv.model ?? 'Vehicle'),
            year: sv.year != null ? Number(sv.year) : null,
            color: (sv.color as string | null) ?? null,
            category,
            transmission:
              typeof sv.transmission === 'string' && sv.transmission.trim()
                ? sv.transmission.trim()
                : 'Automatic',
            seats: sv.seating_capacity != null ? Number(sv.seating_capacity) : 5,
          };
          return { rawCategory: rawCat, publicVehicle };
        })
        .filter((item) => {
          if (!categoryFilter || categoryFilter === 'ALL') return true;
          return (
            portalCategoriesMatch(item.publicVehicle.category, categoryFilter) ||
            portalCategoriesMatch(item.rawCategory, categoryFilter)
          );
        });

      const publicVehicles = matchedInternal.map((item) => item.publicVehicle);

      const byCategory = new Map<string, PublicPortalPreviewVehicle[]>();
      for (const v of publicVehicles) {
        const list = byCategory.get(v.category) ?? [];
        list.push(v);
        byCategory.set(v.category, list);
      }

      const CATEGORY_ORDER = RENTAL_VEHICLE_CATEGORIES.map((c) => c.value);
      const sortedCats = Array.from(byCategory.keys()).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      const categories = [];
      for (const cat of sortedCats) {
        const group = byCategory.get(cat) ?? [];
        const quote = await quoteCorporatePortalRateInTx(tx, ctx.tenantId, {
          category: cat,
          pickupDate: pickupDt,
          dropoffDate: dropoffDt,
          pickupLocationCode: pickupLocation,
          customerId: ctx.customerId,
          insuranceTier,
          ancillaryCodes,
        });

        categories.push({
          category: cat,
          availableCount: group.length,
          sampleVehicles: group.slice(0, 8),
          quote,
          requiredPreAuthAmount: quote.preAuthSizing.requiredPreAuthAmount,
          recommendedHoldAmount: quote.preAuthSizing.recommendedHoldAmount,
          preAuthBreakdown: quote.preAuthSizing,
        });
      }

      return {
        pickupDate: pickupDt.toISOString(),
        dropoffDate: dropoffDt.toISOString(),
        insuranceTier,
        branches,
        ancillaryCatalog: Object.values(BUILTIN_ANCILLARIES),
        categories,
        vehicles: publicVehicles,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[rac-portal/availability] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load fleet availability and corporate rates' },
      { status: 500 },
    );
  }
}
