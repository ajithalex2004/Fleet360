import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { ensureFleetSchema } from '@/lib/fleet/schema';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const woType = sp.get('woType');
    const vehicleId = sp.get('vehicleId');
    const priority = sp.get('priority');
    const { take, skip, page, limit } = paginate(sp);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`fwo.status = $${params.length}`);
    }
    if (woType) {
      params.push(woType);
      conditions.push(`fwo.wo_type = $${params.length}`);
    }
    if (vehicleId) {
      params.push(vehicleId);
      conditions.push(`fwo.vehicle_id = $${params.length}`);
    }
    if (priority) {
      params.push(priority);
      conditions.push(`fwo.priority = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    const dataParams = [...params];
    dataParams.push(take, skip);

    const [countResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM fleet_work_orders fwo
         LEFT JOIN vehicles v ON v.id = fwo.vehicle_id
         ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT fwo.*, v.vehicle_code, v.make, v.model, v.license_plate
         FROM fleet_work_orders fwo
         LEFT JOIN vehicles v ON v.id = fwo.vehicle_id
         ${where}
         ORDER BY fwo.created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching work orders:', error);
    return NextResponse.json({ error: 'Failed to fetch work orders' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-generate wo_number
    const seqResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM fleet_work_orders`,
    );
    const seq = Number(seqResult[0].count) + 1;
    const woNumber = 'FWO-' + String(seq).padStart(6, '0');

    const actualCost = body.actualCost ?? null;
    const authorizedPoAmount = body.authorizedPoAmount ?? null;
    const variance =
      actualCost !== null && authorizedPoAmount !== null
        ? Number(actualCost) - Number(authorizedPoAmount)
        : null;
    const varianceAlert = variance !== null ? variance > 0 : false;

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO fleet_work_orders (
        id, wo_number, vehicle_id, wo_type, status, priority,
        garage_name, garage_contact, assigned_to, scheduled_date,
        start_date, end_date, odometer_at_entry, authorized_po_amount,
        actual_cost, description, findings, actions_taken, line_items,
        requested_by, approved_by, notes, variance, variance_alert,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25, $26
      ) RETURNING *`,
      id,
      woNumber,
      body.vehicleId ?? null,
      body.woType ?? null,
      body.status ?? 'OPEN',
      body.priority ?? null,
      body.garageName ?? null,
      body.garageContact ?? null,
      body.assignedTo ?? null,
      body.scheduledDate ?? null,
      body.startDate ?? null,
      body.endDate ?? null,
      body.odometerAtEntry ?? null,
      authorizedPoAmount,
      actualCost,
      body.description ?? null,
      body.findings ?? null,
      body.actionsTaken ?? null,
      body.lineItems ? JSON.stringify(body.lineItems) : null,
      body.requestedBy ?? null,
      body.approvedBy ?? null,
      body.notes ?? null,
      variance,
      varianceAlert,
      now,
      now,
    );

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating work order:', error);
    return NextResponse.json({ error: 'Failed to create work order' }, { status: 500 });
  }
}
