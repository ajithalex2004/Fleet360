import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { cachedJson } from '@/lib/response-helpers';
import { ensureFleetSchema } from '@/lib/fleet/schema';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const sp = req.nextUrl.searchParams;
    const vehicleGroup = sp.get('vehicleGroup');
    const vehicleClass = sp.get('vehicleClass');
    const isActive = sp.get('isActive');
    const { take, skip, page, limit } = paginate(sp);

    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];

    if (vehicleGroup) {
      params.push(vehicleGroup);
      conditions.push(`vehicle_group = $${params.length}`);
    }
    if (vehicleClass) {
      params.push(vehicleClass);
      conditions.push(`vehicle_class = $${params.length}`);
    }
    if (isActive !== null && isActive !== undefined && isActive !== '') {
      params.push(isActive === 'true');
      conditions.push(`is_active = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countParams = [...params];
    const dataParams = [...params];
    dataParams.push(take, skip);

    const [countResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicle_types WHERE ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM vehicle_types WHERE ${where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return cachedJson(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching vehicle types:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicle types' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    if (!body.code || !body.name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO vehicle_types (
        id, code, name, make, model, description, vehicle_group, vehicle_class,
        transmission_type, fuel_type, num_passengers, max_speed_kmh,
        fuel_efficiency_kml, cost_per_km, idle_fuel_consumption,
        co2_emission_factor, is_active, notes, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19, $20
      ) RETURNING *`,
      id,
      body.code,
      body.name,
      body.make ?? null,
      body.model ?? null,
      body.description ?? null,
      body.vehicleGroup ?? null,
      body.vehicleClass ?? null,
      body.transmissionType ?? null,
      body.fuelType ?? null,
      body.numPassengers ?? null,
      body.maxSpeedKmh ?? null,
      body.fuelEfficiencyKml ?? null,
      body.costPerKm ?? null,
      body.idleFuelConsumption ?? null,
      body.co2EmissionFactor ?? null,
      body.isActive ?? true,
      body.notes ?? null,
      now,
      now,
    );

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    console.error('Error creating vehicle type:', error);
    return NextResponse.json({ error: 'Failed to create vehicle type' }, { status: 500 });
  }
}
