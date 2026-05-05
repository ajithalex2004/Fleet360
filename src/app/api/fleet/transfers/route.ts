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
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM fleet_transfers ft
         LEFT JOIN vehicles v ON v.id = ft.vehicle_id
         ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT ft.*, v.vehicle_code, v.make, v.model, v.license_plate
         FROM fleet_transfers ft
         LEFT JOIN vehicles v ON v.id = ft.vehicle_id
         ${where}
         ORDER BY ft.created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching transfers:', error);
    return NextResponse.json({ error: 'Failed to fetch transfers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-generate transfer_no
    const seqResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM fleet_transfers`,
    );
    const seq = Number(seqResult[0].count) + 1;
    const transferNo = 'FTR-' + String(seq).padStart(6, '0');

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO fleet_transfers (
        id, transfer_no, vehicle_id, from_branch_id, from_branch_name,
        to_branch_id, to_branch_name, transfer_date, requested_by,
        reason, mileage_at_transfer, fuel_level_at_transfer, notes,
        status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16
      ) RETURNING *`,
      id,
      transferNo,
      body.vehicleId ?? null,
      body.fromBranchId ?? null,
      body.fromBranchName ?? null,
      body.toBranchId ?? null,
      body.toBranchName ?? null,
      body.transferDate ?? null,
      body.requestedBy ?? null,
      body.reason ?? null,
      body.mileageAtTransfer ?? null,
      body.fuelLevelAtTransfer ?? null,
      body.notes ?? null,
      'PENDING',
      now,
      now,
    );

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating transfer:', error);
    return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
  }
}
