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
      `SELECT v.*,
              vt.name AS vehicle_type_name,
              vt.vehicle_group,
              vt.vehicle_class,
              vt.num_passengers,
              vt.fuel_type,
              vt.transmission_type
       FROM vehicles v
       LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
       WHERE v.id = $1 AND v.deleted_at IS NULL`,
      id,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
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
      vehicleCode: 'vehicle_code',
      make: 'make',
      model: 'model',
      type: 'type',
      year: 'year',
      vin: 'vin',
      chassisNo: 'chassis_no',
      color: 'color',
      yearOfManufacture: 'year_of_manufacture',
      licensePlate: 'license_plate',
      registrationNo: 'registration_no',
      plateNumber: 'plate_number',
      plateCode: 'plate_code',
      plateCategory: 'plate_category',
      emirate: 'emirate',
      vehicleTypeId: 'vehicle_type_id',
      vehicleUsage: 'vehicle_usage',
      hierarchyId: 'hierarchy_id',
      hierarchyName: 'hierarchy_name',
      branchId: 'branch_id',
      branchName: 'branch_name',
      deviceId: 'device_id',
      simCardNo: 'sim_card_no',
      stopModeCommFrequency: 'stop_mode_comm_frequency',
      lifecycleStage: 'lifecycle_stage',
      purchaseDate: 'purchase_date',
      purchasePrice: 'purchase_price',
      acquisitionType: 'acquisition_type',
      odometerReading: 'odometer_reading',
      fuelLevel: 'fuel_level',
      status: 'status',
      notes: 'notes',
      category: 'category',
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
      `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${idParam} AND deleted_at IS NULL RETURNING *`,
      ...queryParams,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    return NextResponse.json(rowToCamel(rows[0]));
  } catch (error) {
    console.error('Error updating vehicle:', error);
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
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
      `UPDATE vehicles SET deleted_at = NOW() WHERE id = $1`,
      id,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 });
  }
}
