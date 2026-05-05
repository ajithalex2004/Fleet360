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
    const vehicleId = sp.get('vehicleId');
    const { take, skip, page, limit } = paginate(sp);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`fa.status = $${params.length}`);
    }
    if (vehicleId) {
      params.push(vehicleId);
      conditions.push(`fa.vehicle_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    const dataParams = [...params];
    dataParams.push(take, skip);

    const [countResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM fleet_allocations fa
         LEFT JOIN vehicles v ON v.id = fa.vehicle_id
         ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT fa.*, v.vehicle_code, v.make, v.model, v.license_plate
         FROM fleet_allocations fa
         LEFT JOIN vehicles v ON v.id = fa.vehicle_id
         ${where}
         ORDER BY fa.created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching allocations:', error);
    return NextResponse.json({ error: 'Failed to fetch allocations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO fleet_allocations (
        id, vehicle_id, allocated_to_type, allocated_to_id, allocated_to_name,
        allocation_date, expected_return_date, purpose, authorized_by,
        mileage_at_allocation, notes, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14
      ) RETURNING *`,
      id,
      body.vehicleId ?? null,
      body.allocatedToType ?? null,
      body.allocatedToId ?? null,
      body.allocatedToName ?? null,
      body.allocationDate ?? null,
      body.expectedReturnDate ?? null,
      body.purpose ?? null,
      body.authorizedBy ?? null,
      body.mileageAtAllocation ?? null,
      body.notes ?? null,
      body.status ?? 'ACTIVE',
      now,
      now,
    );

    // Update vehicle lifecycle_stage and status to ALLOCATED
    if (body.vehicleId) {
      await prisma.$executeRawUnsafe(
        `UPDATE vehicles SET lifecycle_stage = 'ALLOCATED', status = 'ALLOCATED', updated_at = $1 WHERE id = $2`,
        now,
        body.vehicleId,
      );
    }

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating allocation:', error);
    return NextResponse.json({ error: 'Failed to create allocation' }, { status: 500 });
  }
}
