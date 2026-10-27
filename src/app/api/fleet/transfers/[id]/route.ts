export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { sqlCast } from '@/lib/fleet/sql-cast';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<any[]>(
        "SELECT * FROM fleet_transfers WHERE id::text = $1", params.id
      );
      if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rowToCamel(rows[0]));
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to fetch') }, { status: 500 });
    }
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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
      const now = new Date().toISOString();

      const existing = await tx.$queryRawUnsafe<any[]>(
        "SELECT * FROM fleet_transfers WHERE id::text = $1", params.id
      );
      if (!existing.length) {
        return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
      }
      const prevRecord = existing[0];

      const fieldMap: Record<string, string> = {
        vehicleId: 'vehicle_id',
        fromBranchId: 'from_branch_id',
        fromBranchName: 'from_branch_name',
        toBranchId: 'to_branch_id',
        toBranchName: 'to_branch_name',
        transferDate: 'transfer_date',
        requestedBy: 'requested_by',
        requestedById: 'requested_by_id',
        approvedBy: 'approved_by',
        approvedById: 'approved_by_id',
        reason: 'reason',
        reasonId: 'reason_id',
        reasonType: 'reason_type',
        status: 'status',
        mileageAtTransfer: 'mileage_at_transfer',
        fuelLevelAtTransfer: 'fuel_level_at_transfer',
        notes: 'notes',
      };

      const sets: string[] = [`updated_at = $1::timestamptz`];
      const vals: any[] = [now];
      let idx = 2;
      for (const [key, col] of Object.entries(fieldMap)) {
        if (key in body) {
          sets.push(`${col} = $${idx++}${sqlCast('fleet_transfers', col)}`);
          vals.push(body[key]);
        }
      }
      vals.push(params.id);
      await tx.$executeRawUnsafe(
        `UPDATE fleet_transfers SET ${sets.join(', ')} WHERE id::text = $${idx}`, ...vals
      );

      const rows = await tx.$queryRawUnsafe<any[]>(
        "SELECT * FROM fleet_transfers WHERE id::text = $1", params.id
      );
      const updated = rows[0];

      // If status transitioned to COMPLETED, update vehicle's branch and record lifecycle event
      if (body.status === 'COMPLETED' && prevRecord.status !== 'COMPLETED' && updated.vehicle_id) {
        const vId = String(updated.vehicle_id);
        const toBranchId = updated.to_branch_id;
        const toBranchName = updated.to_branch_name;
        const mileage = updated.mileage_at_transfer != null ? Number(updated.mileage_at_transfer) : null;

        await tx.$executeRawUnsafe(
          `UPDATE vehicles 
           SET branch_id = COALESCE($1, branch_id),
               branch_name = COALESCE($2, branch_name),
               odometer_reading = COALESCE($3, odometer_reading),
               current_mileage = COALESCE($3, current_mileage),
               updated_at = $4::timestamptz
           WHERE id = $5`,
          toBranchId,
          toBranchName,
          mileage,
          now,
          vId,
        );

        // Record lifecycle event
        await recordLifecycleEvent(tx, {
          vehicleId: vId,
          eventType: 'BRANCH_TRANSFER',
          description: `Vehicle transferred from ${updated.from_branch_name || 'Origin'} to ${toBranchName || 'Destination'} (Reason: ${updated.reason || 'Branch Transfer'})`,
          referenceNo: updated.transfer_no || params.id,
          performedBy: updated.approved_by || updated.requested_by || 'Fleet Manager',
          notes: updated.notes || null,
        });
      }

      return NextResponse.json(rowToCamel(updated));
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to update') }, { status: 500 });
    }
  });
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await tx.$executeRawUnsafe(
        "DELETE FROM fleet_transfers WHERE id::text = $1", params.id
      );
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to delete') }, { status: 500 });
    }
  });
}
