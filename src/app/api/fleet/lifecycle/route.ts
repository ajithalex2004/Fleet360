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
    const vehicleId = sp.get('vehicleId');
    const eventType = sp.get('eventType');
    const { take, skip, page, limit } = paginate(sp);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (vehicleId) {
      params.push(vehicleId);
      conditions.push(`fle.vehicle_id = $${params.length}`);
    }
    if (eventType) {
      params.push(eventType);
      conditions.push(`fle.event_type = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    const dataParams = [...params];
    dataParams.push(take, skip);

    const [countResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM fleet_lifecycle_events fle
         LEFT JOIN vehicles v ON v.id = fle.vehicle_id
         ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT fle.*, v.vehicle_code, v.make, v.model, v.license_plate
         FROM fleet_lifecycle_events fle
         LEFT JOIN vehicles v ON v.id = fle.vehicle_id
         ${where}
         ORDER BY fle.event_date DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching lifecycle events:', error);
    return NextResponse.json({ error: 'Failed to fetch lifecycle events' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO fleet_lifecycle_events (
        id, vehicle_id, event_type, event_date, description,
        reference_no, performed_by, from_stage, to_stage,
        cost, metadata, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14
      ) RETURNING *`,
      id,
      body.vehicleId ?? null,
      body.eventType ?? null,
      body.eventDate ?? null,
      body.description ?? null,
      body.referenceNo ?? null,
      body.performedBy ?? null,
      body.fromStage ?? null,
      body.toStage ?? null,
      body.cost ?? null,
      body.metadata ? JSON.stringify(body.metadata) : null,
      body.notes ?? null,
      now,
      now,
    );

    // If toStage is provided, update the vehicle's lifecycle_stage
    if (body.toStage && body.vehicleId) {
      await prisma.$executeRawUnsafe(
        `UPDATE vehicles SET lifecycle_stage = $1, updated_at = $2 WHERE id = $3`,
        body.toStage,
        now,
        body.vehicleId,
      );
    }

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating lifecycle event:', error);
    return NextResponse.json({ error: 'Failed to create lifecycle event' }, { status: 500 });
  }
}
