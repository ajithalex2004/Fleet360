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
    const vehicleUsage = sp.get('vehicleUsage');
    const branchId = sp.get('branchId');
    const lifecycleStage = sp.get('lifecycleStage');
    const vehicleTypeId = sp.get('vehicleTypeId');
    const { take, skip, page, limit } = paginate(sp);

    const conditions: string[] = ['v.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`v.status = $${params.length}`);
    }
    if (vehicleUsage) {
      params.push(vehicleUsage);
      conditions.push(`v.vehicle_usage = $${params.length}`);
    }
    if (branchId) {
      params.push(branchId);
      conditions.push(`v.branch_id = $${params.length}`);
    }
    if (lifecycleStage) {
      params.push(lifecycleStage);
      conditions.push(`v.lifecycle_stage = $${params.length}`);
    }
    if (vehicleTypeId) {
      params.push(vehicleTypeId);
      conditions.push(`v.vehicle_type_id = $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params];
    dataParams.push(take, skip);

    const [countResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count
         FROM vehicles v
         LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
         WHERE ${where}`,
        ...countParams,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT v.*, vt.name AS vehicle_type_name, vt.vehicle_group, vt.vehicle_class
         FROM vehicles v
         LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
         WHERE ${where}
         ORDER BY v.created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    const total = Number(countResult[0].count);
    const data = rows.map(rowToCamel);

    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const body = await req.json();

    const id = crypto.randomUUID();
    const now = new Date(); // pass as Date object so pg driver encodes as TIMESTAMPTZ correctly

    // Auto-generate vehicle_code if not provided
    let vehicleCode = body.vehicleCode ?? body.vehicle_code ?? null;
    if (!vehicleCode) {
      const seqResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) as count FROM vehicles`,
      );
      const seq = Number(seqResult[0].count) + 1;
      vehicleCode = 'VEH-' + String(seq).padStart(6, '0');
    }

    const record = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `INSERT INTO vehicles (
        id, vehicle_code, make, model, type, year, vin, chassis_no, color,
        license_plate, registration_no, plate_number,
        plate_code, plate_category, emirate, vehicle_type_id, vehicle_usage,
        hierarchy_id, hierarchy_name, branch_id, branch_name, device_id,
        sim_card_no, lifecycle_stage, purchase_date,
        purchase_price, acquisition_type, odometer_reading, fuel_level,
        status, notes, category, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25::timestamptz,
        $26, $27, $28, $29,
        $30, $31, $32, $33::timestamptz, $34::timestamptz
      ) RETURNING *`,
      id,
      vehicleCode,
      body.make ?? null,
      body.model ?? null,
      body.type ?? null,
      body.year ?? null,
      body.vin || null,           // unique — convert '' to null to avoid constraint collision
      body.chassisNo ?? null,
      body.color ?? null,
      body.licensePlate || null,  // unique — convert '' to null to avoid constraint collision
      body.registrationNo ?? null,
      body.plateNumber ?? null,
      body.plateCode ?? null,
      body.plateCategory ?? null,
      body.emirate ?? null,
      body.vehicleTypeId ?? null,
      body.vehicleUsage ?? null,
      body.hierarchyId ?? null,
      body.hierarchyName ?? null,
      body.branchId ?? null,
      body.branchName ?? null,
      body.deviceId ?? null,
      body.simCardNo ?? null,
      body.lifecycleStage ?? 'ACTIVE',
      body.purchaseDate || null,   // '' || null = null — TIMESTAMPTZ rejects empty string
      body.purchasePrice ?? null,
      body.acquisitionType ?? null,
      body.odometerReading ?? null,
      body.fuelLevel ?? null,
      body.status ?? 'AVAILABLE',
      body.notes ?? null,
      body.category ?? null,
      now,
      now,
    );

    return NextResponse.json(rowToCamel(record[0]), { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error creating vehicle:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
