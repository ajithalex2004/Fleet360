import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM vehicle_types WHERE id = $1 AND deleted_at IS NULL`,
      id,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error fetching vehicle type:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicle type' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    const body = await req.json();

    const fieldMap: Record<string, string> = {
      code: 'code',
      name: 'name',
      make: 'make',
      model: 'model',
      description: 'description',
      vehicleGroup: 'vehicle_group',
      vehicleClass: 'vehicle_class',
      transmissionType: 'transmission_type',
      fuelType: 'fuel_type',
      numPassengers: 'num_passengers',
      maxSpeedKmh: 'max_speed_kmh',
      fuelEfficiencyKml: 'fuel_efficiency_kml',
      costPerKm: 'cost_per_km',
      idleFuelConsumption: 'idle_fuel_consumption',
      co2EmissionFactor: 'co2_emission_factor',
      isActive: 'is_active',
      notes: 'notes',
    };

    const setClauses: string[] = [];
    const queryParams: unknown[] = [new Date().toISOString()];
    setClauses.push(`updated_at = $1`);

    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
        queryParams.push(body[camelKey]);
        setClauses.push(`${snakeKey} = $${queryParams.length}`);
      }
    }

    queryParams.push(id);
    const idParam = queryParams.length;

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `UPDATE vehicle_types SET ${setClauses.join(', ')} WHERE id = $${idParam} AND deleted_at IS NULL RETURNING *`,
      ...queryParams,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error updating vehicle type:', error);
    return NextResponse.json({ error: 'Failed to update vehicle type' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureFleetSchema();
  try {
    const { id } = await params;
    await prisma.$executeRawUnsafe(
      `UPDATE vehicle_types SET deleted_at = NOW() WHERE id = $1`,
      id,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting vehicle type:', error);
    return NextResponse.json({ error: 'Failed to delete vehicle type' }, { status: 500 });
  }
}
