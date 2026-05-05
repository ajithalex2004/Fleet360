import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await ensureFleetSchema();
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM fleet_vehicle_insurance WHERE id = $1", params.id
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
      policyNumber: 'policy_number',
      insurer: 'insurer',
      policyType: 'policy_type',
      startDate: 'start_date',
      endDate: 'end_date',
      premiumAmount: 'premium_amount',
      coverageAmount: 'coverage_amount',
      deductible: 'deductible',
      status: 'status',
      renewalReminderDays: 'renewal_reminder_days',
      documentUrl: 'document_url',
      notes: 'notes',
    };
    const sets: string[] = [`updated_at = $1`];
    const vals: any[] = [now];
    let idx = 2;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) { sets.push(`${col} = $${idx++}`); vals.push(body[key]); }
    }
    // Also sync insurance_expiry_date on vehicles if endDate changed
    vals.push(params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE fleet_vehicle_insurance SET ${sets.join(', ')} WHERE id = $${idx}`, ...vals
    );
    // Sync vehicle expiry if endDate provided
    if (body.endDate) {
      const insRows = await prisma.$queryRawUnsafe<any[]>(
        "SELECT vehicle_id FROM fleet_vehicle_insurance WHERE id = $1", params.id
      );
      if (insRows.length) {
        await prisma.$executeRawUnsafe(
          "UPDATE vehicles SET insurance_expiry_date = $1 WHERE id = $2",
          new Date(body.endDate).toISOString(), insRows[0].vehicle_id
        ).catch(() => {});
      }
    }
    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM fleet_vehicle_insurance WHERE id = $1", params.id
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
      "DELETE FROM fleet_vehicle_insurance WHERE id = $1", params.id
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Failed to delete' }, { status: 500 });
  }
}
