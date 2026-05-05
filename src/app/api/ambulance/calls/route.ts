import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Ambulance Dispatch Calls API
 * Auto-creates `ambulance_calls` table.
 *
 * Lifecycle: CALL_RECEIVED → DISPATCHED → ON_SCENE → TRANSPORTING → AT_HOSPITAL → CLEARED
 *
 * GET  /api/ambulance/calls?status=&date=&vehicleId=
 * POST /api/ambulance/calls  — log new emergency call
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ambulance_calls (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      call_no         TEXT        NOT NULL,
      status          TEXT        NOT NULL DEFAULT 'CALL_RECEIVED',
      priority        TEXT        NOT NULL DEFAULT 'MEDIUM',   -- LOW | MEDIUM | HIGH | CRITICAL
      caller_name     TEXT,
      caller_phone    TEXT,
      patient_name    TEXT,
      patient_age     INT,
      patient_gender  TEXT,
      chief_complaint TEXT,
      pickup_location TEXT        NOT NULL,
      destination     TEXT,
      vehicle_id      UUID        REFERENCES vehicles(id) ON DELETE SET NULL,
      driver_id       UUID,
      paramedic_name  TEXT,
      call_received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dispatched_at      TIMESTAMPTZ,
      on_scene_at        TIMESTAMPTZ,
      transport_start_at TIMESTAMPTZ,
      at_hospital_at     TIMESTAMPTZ,
      cleared_at         TIMESTAMPTZ,
      response_time_min  INT,
      scene_time_min     INT,
      transport_time_min INT,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_amb_calls_status ON ambulance_calls(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_amb_calls_date ON ambulance_calls(call_received_at)
  `);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const status    = searchParams.get('status')    ?? '';
    const date      = searchParams.get('date')      ?? '';
    const vehicleId = searchParams.get('vehicleId') ?? '';
    const limit     = Math.min(100, Number(searchParams.get('limit') ?? 50));

    const conds: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (status)    { conds.push(`c.status = $${pi++}`);      params.push(status); }
    if (vehicleId) { conds.push(`c.vehicle_id = $${pi++}`);  params.push(vehicleId); }
    if (date)      { conds.push(`DATE(c.call_received_at) = $${pi++}`); params.push(date); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    type CallRow = {
      id: string; call_no: string; status: string; priority: string;
      caller_name: string | null; caller_phone: string | null;
      patient_name: string | null; patient_age: number | null; patient_gender: string | null;
      chief_complaint: string | null; pickup_location: string; destination: string | null;
      vehicle_id: string | null; vehicle_plate: string | null; vehicle_model: string | null;
      driver_id: string | null; driver_name: string | null; paramedic_name: string | null;
      call_received_at: string; dispatched_at: string | null; on_scene_at: string | null;
      transport_start_at: string | null; at_hospital_at: string | null; cleared_at: string | null;
      response_time_min: number | null; scene_time_min: number | null; transport_time_min: number | null;
      notes: string | null;
    };

    const calls = await prisma.$queryRawUnsafe<CallRow[]>(
      `SELECT c.*,
              v.plate_number AS vehicle_plate,
              v.model AS vehicle_model,
              CONCAT(d.first_name, ' ', d.last_name) AS driver_name
         FROM ambulance_calls c
         LEFT JOIN vehicles v ON v.id = c.vehicle_id
         LEFT JOIN drivers d  ON d.id = c.driver_id
         ${where}
         ORDER BY c.call_received_at DESC
         LIMIT $${pi}`,
      ...params, limit
    ).catch(() => [] as CallRow[]);

    // Summary stats (all-time / today)
    const today = new Date().toISOString().slice(0, 10);
    type StatRow = { status: string; cnt: bigint };
    const stats = await prisma.$queryRawUnsafe<StatRow[]>(
      `SELECT status, COUNT(*) AS cnt FROM ambulance_calls GROUP BY status`
    ).catch(() => [] as StatRow[]);

    type AvgRow = { avg_response: number | null };
    const avgResponse = await prisma.$queryRawUnsafe<AvgRow[]>(
      `SELECT AVG(response_time_min) AS avg_response FROM ambulance_calls WHERE response_time_min IS NOT NULL AND DATE(call_received_at) >= NOW() - INTERVAL '30 days'`
    ).catch(() => [{ avg_response: null }]);

    const statusMap = Object.fromEntries(stats.map(s => [s.status, Number(s.cnt)]));

    return NextResponse.json({
      calls: calls.map(c => ({
        id: c.id, callNo: c.call_no, status: c.status, priority: c.priority,
        callerName: c.caller_name, callerPhone: c.caller_phone,
        patientName: c.patient_name, patientAge: c.patient_age, patientGender: c.patient_gender,
        chiefComplaint: c.chief_complaint, pickupLocation: c.pickup_location, destination: c.destination,
        vehicleId: c.vehicle_id, vehiclePlate: c.vehicle_plate, vehicleModel: c.vehicle_model,
        driverId: c.driver_id, driverName: c.driver_name, paramedicName: c.paramedic_name,
        callReceivedAt: c.call_received_at, dispatchedAt: c.dispatched_at,
        onSceneAt: c.on_scene_at, transportStartAt: c.transport_start_at,
        atHospitalAt: c.at_hospital_at, clearedAt: c.cleared_at,
        responseTimeMin: c.response_time_min, sceneTimeMin: c.scene_time_min,
        transportTimeMin: c.transport_time_min, notes: c.notes,
      })),
      stats: {
        callReceived:  statusMap['CALL_RECEIVED']  ?? 0,
        dispatched:    statusMap['DISPATCHED']      ?? 0,
        onScene:       statusMap['ON_SCENE']        ?? 0,
        transporting:  statusMap['TRANSPORTING']    ?? 0,
        atHospital:    statusMap['AT_HOSPITAL']     ?? 0,
        cleared:       statusMap['CLEARED']         ?? 0,
        avgResponseMin: Math.round(Number(avgResponse[0]?.avg_response ?? 0)),
        today,
      },
    });
  } catch (err) {
    console.error('[ambulance/calls GET]', err);
    return NextResponse.json({ error: 'Failed to load calls' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const {
      priority = 'MEDIUM', callerName, callerPhone,
      patientName, patientAge, patientGender, chiefComplaint,
      pickupLocation, destination, vehicleId, driverId, paramedicName, notes,
    } = body;

    if (!pickupLocation?.trim()) {
      return NextResponse.json({ error: 'Pickup location is required' }, { status: 400 });
    }

    // Generate call number: AMB-YYYYMMDD-XXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 9000) + 1000;
    const callNo = `AMB-${dateStr}-${rand}`;

    type NewCall = { id: string; call_no: string };
    const [call] = await prisma.$queryRawUnsafe<NewCall[]>(
      `INSERT INTO ambulance_calls
         (call_no, priority, caller_name, caller_phone, patient_name, patient_age, patient_gender,
          chief_complaint, pickup_location, destination, vehicle_id, driver_id, paramedic_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, call_no`,
      callNo, priority, callerName || null, callerPhone || null,
      patientName || null, patientAge || null, patientGender || null,
      chiefComplaint || null, pickupLocation.trim(), destination || null,
      vehicleId || null, driverId || null, paramedicName || null, notes || null
    );

    return NextResponse.json({ id: call.id, callNo: call.call_no }, { status: 201 });
  } catch (err) {
    console.error('[ambulance/calls POST]', err);
    return NextResponse.json({ error: 'Failed to create call' }, { status: 500 });
  }
}
