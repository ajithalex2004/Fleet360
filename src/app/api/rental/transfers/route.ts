export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  approvalGate,
  approvalInProgress,
  withApprovalStart,
  withdrawApproval,
} from '@/lib/workflow/approvals';
import { prisma } from '@/lib/prisma';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { nextRentalSerial, withRentalLock, withSavepoint } from '@/lib/rental/locks';
import { normalizeFuelToPct } from '@/lib/rental/fuel-odometer';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

/**
 * Rental Inter-Branch Vehicle Transfers API
 *
 * Status workflow: REQUESTED → APPROVED → IN_TRANSIT → COMPLETED | CANCELLED
 * Reasons: REBALANCING / CUSTOMER_DROPOFF / MAINTENANCE / OVERFLOW / OTHER
 *
 * GET   /api/rental/transfers?status=&from_branch=&to_branch=&search=&page=&limit=
 * POST  /api/rental/transfers      — create transfer request (auto-generates RVT-YYYYMM-XXXX)
 * PATCH /api/rental/transfers?id=  — workflow transitions (`APPROVE`/`ARRIVE`/`CANCEL` require `rental:approve:transfers`)
 */

type TransferRow = {
  id: string;
  created_at: string;
  updated_at: string;
  transfer_no: string;
  vehicle_id: string | null;
  vehicle_no: string;
  vehicle_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  from_branch_id: string | null;
  from_branch_name: string;
  from_emirate: string | null;
  to_branch_id: string | null;
  to_branch_name: string;
  to_emirate: string | null;
  transfer_date: string;
  reason: string;
  fuel_level: number | null;
  odometer_reading: number | null;
  condition_notes: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  cancelled_reason: string | null;
  notes: string | null;
};

type CountRow = { status: string; cnt: bigint };

function mapTransfer(r: TransferRow) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    transferNo: r.transfer_no,
    vehicleId: r.vehicle_id,
    vehicleNo: r.vehicle_no,
    vehicleName: r.vehicle_name,
    vehicleMake: r.vehicle_make,
    vehicleModel: r.vehicle_model,
    fromBranchId: r.from_branch_id,
    fromBranchName: r.from_branch_name,
    fromEmirate: r.from_emirate,
    toBranchId: r.to_branch_id,
    toBranchName: r.to_branch_name,
    toEmirate: r.to_emirate,
    transferDate: r.transfer_date,
    reason: r.reason,
    fuelLevel: r.fuel_level,
    odometerReading: r.odometer_reading,
    conditionNotes: r.condition_notes,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    status: r.status,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    departedAt: r.departed_at,
    arrivedAt: r.arrived_at,
    cancelledReason: r.cancelled_reason,
    notes: r.notes,
  };
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'transfers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status') ?? '';
      const fromBranch = sp.get('from_branch') ?? '';
      const toBranch = sp.get('to_branch') ?? '';
      const search = sp.get('search') ?? '';
      const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? 20) || 20));
      const offset = (page - 1) * limit;

      const conds: string[] = ['t.tenant_id::text = $1'];
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (status) {
        conds.push(`t.status = $${pi++}`);
        params.push(status);
      }
      if (fromBranch) {
        conds.push(`t.from_branch_name ILIKE $${pi++} ESCAPE '\\'`);
        params.push(`%${escapeIlikePattern(fromBranch)}%`);
      }
      if (toBranch) {
        conds.push(`t.to_branch_name ILIKE $${pi++} ESCAPE '\\'`);
        params.push(`%${escapeIlikePattern(toBranch)}%`);
      }
      if (search) {
        conds.push(
          `(t.vehicle_no ILIKE $${pi} ESCAPE '\\' OR t.transfer_no ILIKE $${pi} ESCAPE '\\' OR t.vehicle_name ILIKE $${pi} ESCAPE '\\')`,
        );
        params.push(`%${escapeIlikePattern(search)}%`);
        pi++;
      }

      const where = `WHERE ${conds.join(' AND ')}`;

      const rows = await withSavepoint<TransferRow[]>(
        tx,
        'transfers_list',
        () =>
          tx.$queryRawUnsafe<TransferRow[]>(
            `SELECT t.* FROM rental_vehicle_transfers t ${where} ORDER BY t.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
            ...params,
            limit,
            offset,
          ),
        [],
      );

      const countRows = await withSavepoint<Array<{ cnt: bigint }>>(
        tx,
        'transfers_count',
        () =>
          tx.$queryRawUnsafe<Array<{ cnt: bigint }>>(
            `SELECT COUNT(*) AS cnt FROM rental_vehicle_transfers t ${where}`,
            ...params,
          ),
        [{ cnt: BigInt(0) }],
      );

      const statusCounts = await withSavepoint<CountRow[]>(
        tx,
        'transfers_status_counts',
        () =>
          tx.$queryRawUnsafe<CountRow[]>(
            `SELECT status, COUNT(*) AS cnt FROM rental_vehicle_transfers WHERE tenant_id::text = $1 GROUP BY status`,
            tenantId,
          ),
        [],
      );

      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
      const completedRows = await withSavepoint<Array<{ cnt: bigint }>>(
        tx,
        'transfers_completed_month',
        () =>
          tx.$queryRawUnsafe<Array<{ cnt: bigint }>>(
            `SELECT COUNT(*) AS cnt FROM rental_vehicle_transfers WHERE tenant_id::text = $1 AND status = 'COMPLETED' AND arrived_at >= $2::timestamptz`,
            tenantId,
            firstOfMonth,
          ),
        [{ cnt: BigInt(0) }],
      );

      const total = Number(countRows[0]?.cnt ?? 0);
      const statusMap = Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.cnt)]));

      return NextResponse.json({
        data: rows.map(mapTransfer),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: {
          byStatus: statusMap,
          requested: statusMap['REQUESTED'] ?? 0,
          approved: statusMap['APPROVED'] ?? 0,
          inTransit: statusMap['IN_TRANSIT'] ?? 0,
          completed: statusMap['COMPLETED'] ?? 0,
          cancelled: statusMap['CANCELLED'] ?? 0,
          completedThisMonth: Number(completedRows[0]?.cnt ?? 0),
        },
      });
    } catch (err) {
      console.error('[rental/transfers GET]', err);
      return NextResponse.json({ error: 'Failed to load transfers' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'transfers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  const actorUserId = req.headers.get('x-user-id')?.trim() || 'staff';

  let createdId: string | null = null;
  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      );

      const {
        vehicleId,
        vehicleNo,
        vehicleName,
        vehicleMake,
        vehicleModel,
        fromBranchId,
        fromBranchName,
        fromEmirate,
        toBranchId,
        toBranchName,
        toEmirate,
        transferDate,
        reason,
        fuelLevel,
        odometerReading,
        conditionNotes,
        driverName,
        driverPhone,
        notes,
      } = body;

      if (typeof vehicleNo !== 'string' || !vehicleNo.trim()) {
        return NextResponse.json({ error: 'vehicle_no is required' }, { status: 400 });
      }
      if (typeof fromBranchName !== 'string' || !fromBranchName.trim()) {
        return NextResponse.json({ error: 'from_branch_name is required' }, { status: 400 });
      }
      if (typeof toBranchName !== 'string' || !toBranchName.trim()) {
        return NextResponse.json({ error: 'to_branch_name is required' }, { status: 400 });
      }
      if (!transferDate) {
        return NextResponse.json({ error: 'transfer_date is required' }, { status: 400 });
      }
      if (typeof reason !== 'string' || !reason) {
        return NextResponse.json({ error: 'reason is required' }, { status: 400 });
      }

      const validReasons = [
        'REBALANCING',
        'CUSTOMER_DROPOFF',
        'MAINTENANCE',
        'OVERFLOW',
        'OTHER',
      ];
      if (!validReasons.includes(reason)) {
        return NextResponse.json(
          { error: `reason must be one of: ${validReasons.join(', ')}` },
          { status: 400 },
        );
      }

      const normVehicleId =
        typeof vehicleId === 'string' && vehicleId.trim() ? vehicleId.trim() : null;
      const normFromBranchId =
        typeof fromBranchId === 'string' && fromBranchId.trim() ? fromBranchId.trim() : null;
      const normToBranchId =
        typeof toBranchId === 'string' && toBranchId.trim() ? toBranchId.trim() : null;

      if (normFromBranchId && normToBranchId && normFromBranchId === normToBranchId) {
        return NextResponse.json(
          { error: 'Origin and destination branches must be different' },
          { status: 400 },
        );
      }

      await assertRentalForeignKeysInTenant(tx, tenantId, {
        vehicleId: normVehicleId,
        branchIds: [normFromBranchId, normToBranchId],
      });

      const rawFuelUnit =
        typeof body.fuelUnit === 'string' ? body.fuelUnit.trim().toUpperCase() : '';
      const explicitFuelUnit =
        rawFuelUnit === 'EIGHTHS' || rawFuelUnit === '8THS'
          ? 'EIGHTHS'
          : rawFuelUnit === 'PCT' || rawFuelUnit === 'PERCENT' || rawFuelUnit === '%'
            ? 'PCT'
            : null;
      const hasFuelInput =
        (fuelLevel !== undefined && fuelLevel !== null && fuelLevel !== '') ||
        (body.fuelLevelPct !== undefined && body.fuelLevelPct !== null && body.fuelLevelPct !== '') ||
        (body.fuelLevelEighths !== undefined &&
          body.fuelLevelEighths !== null &&
          body.fuelLevelEighths !== '');
      const normalizedFuelLevel =
        body.fuelLevelPct !== undefined && body.fuelLevelPct !== null && body.fuelLevelPct !== ''
          ? normalizeFuelToPct(body.fuelLevelPct, { unit: 'PCT' })
          : body.fuelLevelEighths !== undefined &&
              body.fuelLevelEighths !== null &&
              body.fuelLevelEighths !== ''
            ? normalizeFuelToPct(body.fuelLevelEighths, { unit: 'EIGHTHS' })
            : normalizeFuelToPct(fuelLevel, { unit: explicitFuelUnit });

      if (hasFuelInput && normalizedFuelLevel === null) {
        return NextResponse.json(
          { error: 'fuel_level must be a valid fuel reading (0-100%, 0-8 eighths, or fraction)' },
          { status: 400 },
        );
      }

      const parsedOdometer =
        odometerReading !== undefined && odometerReading !== null && odometerReading !== ''
          ? Math.round(Number(odometerReading))
          : null;
      if (parsedOdometer !== null && (!Number.isFinite(parsedOdometer) || parsedOdometer < 0)) {
        return NextResponse.json(
          { error: 'odometer_reading must be zero or more' },
          { status: 400 },
        );
      }

      return withRentalLock(
        tx,
        tenantId,
        { vehicleIds: normVehicleId ? [normVehicleId] : [] },
        async () => {
          // Generate canonical MAX+1 transfer_no: RVT-YYYYMM-NNNN scoped strictly to tenantId
          const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
          const prefix = `RVT-${yyyymm}-`;
          const transferNo = await nextRentalSerial(tx, {
            tenantId,
            series: `rental-transfer:${yyyymm}`,
            prefix,
            table: 'rental_vehicle_transfers',
            column: 'transfer_no',
            padWidth: 4,
          });

          type NewRow = { id: string; transfer_no: string };
          const [row] = await tx.$queryRawUnsafe<NewRow[]>(
            `INSERT INTO rental_vehicle_transfers
               (tenant_id, transfer_no, vehicle_id, vehicle_no, vehicle_name, vehicle_make, vehicle_model,
                from_branch_id, from_branch_name, from_emirate,
                to_branch_id, to_branch_name, to_emirate,
                transfer_date, reason, fuel_level, odometer_reading, condition_notes,
                driver_name, driver_phone, requested_by, notes, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'REQUESTED')
             RETURNING id, transfer_no`,
            tenantId,
            transferNo,
            normVehicleId,
            vehicleNo.trim(),
            typeof vehicleName === 'string' && vehicleName.trim() ? vehicleName.trim() : null,
            typeof vehicleMake === 'string' && vehicleMake.trim() ? vehicleMake.trim() : null,
            typeof vehicleModel === 'string' && vehicleModel.trim() ? vehicleModel.trim() : null,
            normFromBranchId,
            fromBranchName.trim(),
            typeof fromEmirate === 'string' && fromEmirate.trim() ? fromEmirate.trim() : null,
            normToBranchId,
            toBranchName.trim(),
            typeof toEmirate === 'string' && toEmirate.trim() ? toEmirate.trim() : null,
            transferDate,
            reason,
            normalizedFuelLevel,
            parsedOdometer,
            typeof conditionNotes === 'string' && conditionNotes.trim()
              ? conditionNotes.trim()
              : null,
            typeof driverName === 'string' && driverName.trim() ? driverName.trim() : null,
            typeof driverPhone === 'string' && driverPhone.trim() ? driverPhone.trim() : null,
            actorUserId,
            typeof notes === 'string' && notes.trim() ? notes.trim() : null,
          );

          createdId = row.id;
          return NextResponse.json({ id: row.id, transferNo: row.transfer_no }, { status: 201 });
        },
      );
    } catch (err) {
      if (isRentalSecurityError(err)) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[rental/transfers POST]', err);
      return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
    }
  });

  return createdId
    ? withApprovalStart(response, {
        headers: req.headers,
        tenantId,
        referenceType: 'rental_transfer',
        referenceId: createdId,
        mapRow: (r) => mapTransfer(r as unknown as TransferRow),
      })
    : response;
}

export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const bodyRaw = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(
    (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
  );
  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  const cancelledReason =
    typeof body.cancelledReason === 'string' ? body.cancelledReason.trim() : '';

  if (!['APPROVE', 'DEPART', 'ARRIVE', 'CANCEL'].includes(action)) {
    return NextResponse.json(
      { error: 'action must be one of: APPROVE, DEPART, ARRIVE, CANCEL' },
      { status: 400 },
    );
  }

  // Approving, completing (ARRIVE), or cancelling a transfer requires `rental:approve:transfers`
  if (action === 'APPROVE' || action === 'ARRIVE' || action === 'CANCEL') {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'approve',
      'transfers',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  } else {
    const denied = await requireRentalPermission(
      req.headers,
      tenantId,
      'edit',
      'transfers',
      req.nextUrl.pathname,
    );
    if (denied) return denied;
  }

  if (action === 'APPROVE') {
    const gated = await approvalGate({
      headers: req.headers,
      tenantId,
      referenceType: 'rental_transfer',
      referenceId: id,
      action: 'APPROVE',
      comments: '',
      mapRow: (row) => mapTransfer(row as unknown as TransferRow),
    });
    if (gated) return gated;
  } else if (action === 'DEPART' || action === 'ARRIVE') {
    const busy = await approvalInProgress(tenantId, 'rental_transfer', id);
    if (busy) return busy;
  }

  const actorApprovedBy = req.headers.get('x-user-id')?.trim() || 'manager';

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const [initial] = await tx.$queryRawUnsafe<TransferRow[]>(
        'SELECT * FROM rental_vehicle_transfers WHERE id::text = $1 AND tenant_id::text = $2',
        id,
        tenantId,
      );
      if (!initial) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });

      return withRentalLock(
        tx,
        tenantId,
        {
          entityKey: `transfer:${id}`,
          vehicleIds: initial.vehicle_id ? [initial.vehicle_id] : [],
        },
        async () => {
          const [current] = await tx.$queryRawUnsafe<TransferRow[]>(
            'SELECT * FROM rental_vehicle_transfers WHERE id::text = $1 AND tenant_id::text = $2 FOR UPDATE',
            id,
            tenantId,
          );
          if (!current) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });

          const now = new Date().toISOString();

          if (action === 'APPROVE') {
            if (current.status !== 'REQUESTED') {
              return NextResponse.json(
                { error: 'Only REQUESTED transfers can be approved' },
                { status: 400 },
              );
            }
            await tx.$executeRawUnsafe(
              "UPDATE rental_vehicle_transfers SET status='APPROVED', approved_by=$1, approved_at=$2, updated_at=$3 WHERE id::text=$4 AND tenant_id::text=$5",
              actorApprovedBy,
              now,
              now,
              id,
              tenantId,
            );
          } else if (action === 'DEPART') {
            if (current.status !== 'APPROVED') {
              return NextResponse.json(
                { error: 'Only APPROVED transfers can be departed' },
                { status: 400 },
              );
            }
            if (current.vehicle_id) {
              const activeAgr = await withSavepoint<Array<{ agreement_no: string | null }>>(
                tx,
                'transfer_depart_active_agr',
                () =>
                  tx.$queryRawUnsafe<Array<{ agreement_no: string | null }>>(
                    `SELECT agreement_no
                       FROM rental_agreements
                      WHERE tenant_id::text = $1
                        AND vehicle_id = $2
                        AND deleted_at IS NULL
                        AND status = 'ACTIVE'
                      LIMIT 1`,
                    tenantId,
                    current.vehicle_id,
                  ),
                [],
              );
              if (activeAgr.length > 0) {
                return NextResponse.json(
                  {
                    error: `Vehicle is currently out on active rental agreement ${activeAgr[0].agreement_no ?? ''} and cannot depart on an inter-branch transfer`,
                  },
                  { status: 409 },
                );
              }
            }
            await tx.$executeRawUnsafe(
              "UPDATE rental_vehicle_transfers SET status='IN_TRANSIT', departed_at=$1, updated_at=$2 WHERE id::text=$3 AND tenant_id::text=$4",
              now,
              now,
              id,
              tenantId,
            );
          } else if (action === 'ARRIVE') {
            if (current.status !== 'IN_TRANSIT') {
              return NextResponse.json(
                { error: 'Only IN_TRANSIT transfers can be completed' },
                { status: 400 },
              );
            }

            const rawArriveFuelUnit =
              typeof body.fuelUnit === 'string' ? body.fuelUnit.trim().toUpperCase() : '';
            const arriveFuelUnit =
              rawArriveFuelUnit === 'EIGHTHS' || rawArriveFuelUnit === '8THS'
                ? 'EIGHTHS'
                : rawArriveFuelUnit === 'PCT' ||
                    rawArriveFuelUnit === 'PERCENT' ||
                    rawArriveFuelUnit === '%'
                  ? 'PCT'
                  : null;
            const hasArriveFuel =
              (body.fuelLevel !== undefined && body.fuelLevel !== null && body.fuelLevel !== '') ||
              (body.fuelLevelPct !== undefined &&
                body.fuelLevelPct !== null &&
                body.fuelLevelPct !== '');
            const arrivalFuel =
              body.fuelLevelPct !== undefined &&
              body.fuelLevelPct !== null &&
              body.fuelLevelPct !== ''
                ? normalizeFuelToPct(body.fuelLevelPct, { unit: 'PCT' })
                : hasArriveFuel
                  ? normalizeFuelToPct(body.fuelLevel, { unit: arriveFuelUnit })
                  : null;
            if (hasArriveFuel && arrivalFuel === null) {
              return NextResponse.json(
                { error: 'fuel_level must be a valid fuel reading (0-100%)' },
                { status: 400 },
              );
            }

            const hasArriveOdo =
              body.odometerReading !== undefined &&
              body.odometerReading !== null &&
              body.odometerReading !== '';
            const arrivalOdo = hasArriveOdo ? Math.round(Number(body.odometerReading)) : null;
            if (arrivalOdo !== null && (!Number.isFinite(arrivalOdo) || arrivalOdo < 0)) {
              return NextResponse.json(
                { error: 'odometer_reading must be zero or more' },
                { status: 400 },
              );
            }

            if (arrivalFuel !== null || arrivalOdo !== null) {
              await tx.$executeRawUnsafe(
                "UPDATE rental_vehicle_transfers SET status='COMPLETED', arrived_at=$1, fuel_level=COALESCE($2, fuel_level), odometer_reading=COALESCE($3, odometer_reading), updated_at=$4 WHERE id::text=$5 AND tenant_id::text=$6",
                now,
                arrivalFuel,
                arrivalOdo,
                now,
                id,
                tenantId,
              );
            } else {
              await tx.$executeRawUnsafe(
                "UPDATE rental_vehicle_transfers SET status='COMPLETED', arrived_at=$1, updated_at=$2 WHERE id::text=$3 AND tenant_id::text=$4",
                now,
                now,
                id,
                tenantId,
              );
            }

            // Sync destination branch, odometer, and fuel level onto the vehicle when arriving
            if (current.vehicle_id) {
              const targetBranchId =
                typeof body.toBranchId === 'string' && body.toBranchId.trim()
                  ? body.toBranchId.trim()
                  : current.to_branch_id;
              const targetOdometer = arrivalOdo ?? current.odometer_reading;
              const targetFuel = arrivalFuel ?? current.fuel_level;

              const setClauses: string[] = [];
              const updateParams: unknown[] = [current.vehicle_id, tenantId];
              let paramIdx = 3;

              if (targetBranchId) {
                setClauses.push(`branch_id = $${paramIdx++}`);
                updateParams.push(targetBranchId);
              }
              if (targetOdometer !== null && targetOdometer !== undefined) {
                setClauses.push(`odometer = $${paramIdx++}`);
                updateParams.push(targetOdometer);
              }
              if (targetFuel !== null && targetFuel !== undefined) {
                setClauses.push(`fuel_level = $${paramIdx++}`);
                updateParams.push(targetFuel);
              }

              if (setClauses.length > 0) {
                setClauses.push(`updated_at = $${paramIdx++}`);
                updateParams.push(now);

                const combinedResult = await withSavepoint<number>(
                  tx,
                  'transfer_arrive_vehicle_sync',
                  () =>
                    tx.$executeRawUnsafe(
                      `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`,
                      ...updateParams,
                    ),
                  -1,
                );

                if (combinedResult === -1) {
                  if (targetBranchId) {
                    await withSavepoint(
                      tx,
                      'transfer_arrive_veh_branch',
                      () =>
                        tx.$executeRawUnsafe(
                          'UPDATE vehicles SET branch_id = $3 WHERE id = $1 AND tenant_id = $2',
                          current.vehicle_id,
                          tenantId,
                          targetBranchId,
                        ),
                      0,
                    );
                  }
                  if (targetOdometer !== null && targetOdometer !== undefined) {
                    const odoRes = await withSavepoint<number>(
                      tx,
                      'transfer_arrive_veh_odometer',
                      () =>
                        tx.$executeRawUnsafe(
                          'UPDATE vehicles SET odometer = $3 WHERE id = $1 AND tenant_id = $2',
                          current.vehicle_id,
                          tenantId,
                          targetOdometer,
                        ),
                      -1,
                    );
                    if (odoRes === -1) {
                      await withSavepoint(
                        tx,
                        'transfer_arrive_veh_mileage',
                        () =>
                          tx.$executeRawUnsafe(
                            'UPDATE vehicles SET mileage = $3 WHERE id = $1 AND tenant_id = $2',
                            current.vehicle_id,
                            tenantId,
                            targetOdometer,
                          ),
                        0,
                      );
                    }
                  }
                  if (targetFuel !== null && targetFuel !== undefined) {
                    await withSavepoint(
                      tx,
                      'transfer_arrive_veh_fuel',
                      () =>
                        tx.$executeRawUnsafe(
                          'UPDATE vehicles SET fuel_level = $3 WHERE id = $1 AND tenant_id = $2',
                          current.vehicle_id,
                          tenantId,
                          targetFuel,
                        ),
                      0,
                    );
                  }
                }
              }
            }
          } else if (action === 'CANCEL') {
            if (current.status === 'COMPLETED') {
              return NextResponse.json(
                { error: 'Completed transfers cannot be cancelled' },
                { status: 400 },
              );
            }
            if (!cancelledReason) {
              return NextResponse.json({ error: 'cancelled_reason is required' }, { status: 400 });
            }
            await tx.$executeRawUnsafe(
              "UPDATE rental_vehicle_transfers SET status='CANCELLED', cancelled_reason=$1, updated_at=$2 WHERE id::text=$3 AND tenant_id::text=$4",
              cancelledReason,
              now,
              id,
              tenantId,
            );
          }

          const [updated] = await tx.$queryRawUnsafe<TransferRow[]>(
            'SELECT * FROM rental_vehicle_transfers WHERE id::text = $1 AND tenant_id::text = $2',
            id,
            tenantId,
          );
          return NextResponse.json(mapTransfer(updated));
        },
      );
    } catch (err) {
      console.error('[rental/transfers PATCH]', err);
      return NextResponse.json({ error: 'Failed to update transfer' }, { status: 500 });
    }
  });

  if (action === 'CANCEL' && response.ok) {
    await withdrawApproval(tenantId, 'rental_transfer', id, 'the transfer was cancelled');
  }
  return response;
}
