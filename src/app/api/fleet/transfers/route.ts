export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status');
      const vehicleId = sp.get('vehicleId');
      const { take, skip, page, limit } = paginate(sp);

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) {
        params.push(status);
        conditions.push(`ft.status = $${params.length}`);
      }
      if (vehicleId) {
        params.push(vehicleId);
        conditions.push(`ft.vehicle_id = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countParams = [...params];
      const dataParams = [...params];
      dataParams.push(take, skip);

      const [countResult, rows] = await Promise.all([
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count
           FROM fleet_transfers ft
           LEFT JOIN vehicles v ON v.id = ft.vehicle_id::text
           ${where}`,
          ...countParams,
        ),
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT ft.*, v.vehicle_code, v.make, v.model, v.license_plate
           FROM fleet_transfers ft
           LEFT JOIN vehicles v ON v.id = ft.vehicle_id::text
           ${where}
           ORDER BY ft.created_at DESC
           LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          ...dataParams,
        ),
      ]);

      const total = Number(countResult[0]?.count ?? 0);
      const data = rows.map(rowToCamel);

      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Error fetching transfers:', e);
      return NextResponse.json({ error: 'Failed to fetch transfers' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // Auto-generate transfer_no
      const seqResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM fleet_transfers`,
      );
      const seq = Number(seqResult[0]?.count ?? 0) + 1;
      const transferNo = 'FTR-' + String(seq).padStart(6, '0');

      const transferDate = body.transferDate ? new Date(body.transferDate).toISOString() : now;
      const mileage = body.mileageAtTransfer != null && body.mileageAtTransfer !== ''
        ? parseInt(String(body.mileageAtTransfer), 10)
        : null;
      const status = body.status || 'PENDING';

      const record = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `INSERT INTO fleet_transfers (
          id, transfer_no, vehicle_id, from_branch_id, from_branch_name,
          to_branch_id, to_branch_name, transfer_date, requested_by,
          requested_by_id, approved_by, approved_by_id, reason,
          reason_id, reason_type, mileage_at_transfer, fuel_level_at_transfer,
          notes, status, created_at, updated_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5,
          $6, $7, $8::timestamptz, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17,
          $18, $19, $20::timestamptz, $21::timestamptz
        ) RETURNING *`,
        id,
        transferNo,
        body.vehicleId ? String(body.vehicleId) : null,
        body.fromBranchId ?? null,
        body.fromBranchName ?? null,
        body.toBranchId ?? null,
        body.toBranchName ?? null,
        transferDate,
        body.requestedBy ?? null,
        body.requestedById ?? null,
        body.approvedBy ?? null,
        body.approvedById ?? null,
        body.reason ?? null,
        body.reasonId ?? null,
        body.reasonType ?? null,
        mileage,
        body.fuelLevelAtTransfer ?? null,
        body.notes ?? null,
        status,
        now,
        now,
      );

      // If created directly in COMPLETED status, update vehicle's branch and log lifecycle event
      if (status === 'COMPLETED' && body.vehicleId) {
        const vId = String(body.vehicleId);
        await tx.$executeRawUnsafe(
          `UPDATE vehicles 
           SET branch_id = COALESCE($1, branch_id),
               branch_name = COALESCE($2, branch_name),
               odometer_reading = COALESCE($3, odometer_reading),
               current_mileage = COALESCE($3, current_mileage),
               updated_at = $4::timestamptz
           WHERE id = $5`,
          body.toBranchId ?? null,
          body.toBranchName ?? null,
          mileage,
          now,
          vId,
        );

        // Record lifecycle event
        await recordLifecycleEvent(tx, {
          vehicleId: vId,
          eventType: 'BRANCH_TRANSFER',
          eventDate: transferDate,
          description: `Vehicle transferred from ${body.fromBranchName || 'Origin'} to ${body.toBranchName || 'Destination'} (Reason: ${body.reason || 'Branch Transfer'})`,
          referenceNo: transferNo,
          performedBy: body.approvedBy || body.requestedBy || 'Fleet Manager',
          notes: body.notes ?? null,
        });
      }

      return NextResponse.json(rowToCamel(record[0]), { status: 201 });
    } catch (e) {
      console.error('Error creating transfer:', e);
      return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
    }
  });
}
