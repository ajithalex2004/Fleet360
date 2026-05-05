import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await ensureFleetSchema();
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM fleet_transfers WHERE id = $1", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureFleetSchema();
  try {
    const body = await req.json();
    const now = new Date().toISOString();
    const fieldMap: Record<string, string> = {
      vehicleId: 'vehicle_id',
      fromBranchId: 'from_branch_id',
      fromBranchName: 'from_branch_name',
      toBranchId: 'to_branch_id',
      toBranchName: 'to_branch_name',
      transferDate: 'transfer_date',
      requestedBy: 'requested_by',
      approvedBy: 'approved_by',
      status: 'status',
      mileageAtTransfer: 'mileage_at_transfer',
      fuelLevelAtTransfer: 'fuel_level_at_transfer',
      reason: 'reason',
      notes: 'notes',
    };
    const sets: string[] = [`updated_at = $1`];
    const vals: any[] = [now];
    let idx = 2;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) { sets.push(`${col} = $${idx++}`); vals.push(body[key]); }
    }
    vals.push(params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE fleet_transfers SET ${sets.join(', ')} WHERE id = $${idx}`, ...vals
    );
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM fleet_transfers WHERE id = $1", params.id
    );
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await ensureFleetSchema();
  try {
    await prisma.$executeRawUnsafe(
      "DELETE FROM fleet_transfers WHERE id = $1", params.id
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to delete' }, { status: 500 });
  }
}
