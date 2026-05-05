/**
 * RAC Handover/Return Checklists API — /api/rental/handover
 * Manages vehicle pickup and return inspection records
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS rental_handovers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    handover_no        TEXT UNIQUE NOT NULL,
    agreement_id       TEXT,
    agreement_no       TEXT,
    customer_name      TEXT,
    vehicle_id         TEXT,
    vehicle_no         TEXT,
    vehicle_name       TEXT,
    handover_type      TEXT NOT NULL DEFAULT 'PICKUP',
    handover_date      TIMESTAMPTZ DEFAULT NOW(),
    fuel_level         INT DEFAULT 4,
    odometer_reading   INT DEFAULT 0,
    condition_score    INT DEFAULT 3,
    body_condition     TEXT DEFAULT 'Good',
    interior_condition TEXT DEFAULT 'Clean',
    tyres_condition    TEXT DEFAULT 'Good',
    keys_count         INT DEFAULT 1,
    spare_key          BOOLEAN DEFAULT false,
    salik_tag          BOOLEAN DEFAULT false,
    parking_card       BOOLEAN DEFAULT false,
    accessories        JSONB DEFAULT '[]',
    checklist_items    JSONB DEFAULT '[]',
    notes              TEXT,
    signed_by          TEXT,
    signed_at          TIMESTAMPTZ,
    status             TEXT DEFAULT 'PENDING',
    branch_id          TEXT
  );
`;

type Row = Record<string, unknown>;

async function nextNo(): Promise<string> {
  const [r] = await prisma
    .$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text as count FROM rental_handovers`,
    )
    .catch(() => [{ count: '0' }]);
  const seq = (parseInt(r?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `RHO-${ym}-${seq}`;
}

/* ─── GET ─── */
export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});

  const sp = req.nextUrl.searchParams;
  const handoverType = sp.get('handoverType');
  const status = sp.get('status');
  const search = sp.get('search');
  const agreementNo = sp.get('agreementNo');
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  let where = `WHERE 1=1`;
  const params: unknown[] = [];
  let pi = 1;

  if (handoverType) {
    where += ` AND handover_type=$${pi++}`;
    params.push(handoverType);
  }
  if (status && status !== 'ALL') {
    where += ` AND status=$${pi++}`;
    params.push(status);
  }
  if (agreementNo) {
    where += ` AND agreement_no=$${pi++}`;
    params.push(agreementNo);
  }
  if (search) {
    where += ` AND (customer_name ILIKE $${pi} OR handover_no ILIKE $${pi} OR agreement_no ILIKE $${pi} OR vehicle_no ILIKE $${pi})`;
    params.push(`%${search}%`);
    pi++;
  }

  const [rows, kpiRows] = await Promise.all([
    prisma
      .$queryRawUnsafe<Row[]>(
        `SELECT * FROM rental_handovers ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
        ...params,
        limit,
        offset,
      )
      .catch(() => []),
    prisma
      .$queryRawUnsafe<{
        pending_pickups: string;
        pending_returns: string;
        completed_today: string;
        avg_condition: string;
      }[]>(
        `SELECT
           COUNT(*) FILTER (WHERE handover_type='PICKUP' AND status='PENDING')::text AS pending_pickups,
           COUNT(*) FILTER (WHERE handover_type='RETURN' AND status='PENDING')::text AS pending_returns,
           COUNT(*) FILTER (WHERE status='COMPLETED' AND DATE(signed_at) = CURRENT_DATE)::text AS completed_today,
           COALESCE(AVG(condition_score),0)::text AS avg_condition
         FROM rental_handovers`,
      )
      .catch(() => [
        { pending_pickups: '0', pending_returns: '0', completed_today: '0', avg_condition: '0' },
      ]),
  ]);

  const kpi = kpiRows[0] ?? {
    pending_pickups: '0',
    pending_returns: '0',
    completed_today: '0',
    avg_condition: '0',
  };

  return NextResponse.json({
    data: rows,
    kpis: {
      pendingPickups: parseInt(kpi.pending_pickups),
      pendingReturns: parseInt(kpi.pending_returns),
      completedToday: parseInt(kpi.completed_today),
      avgConditionScore: parseFloat(parseFloat(kpi.avg_condition).toFixed(1)),
    },
    page,
    limit,
  });
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});

  const body = await req.json();
  const handoverNo = await nextNo();

  const accessories = body.accessories ?? [];
  const checklistItems = body.checklistItems ?? [];

  const [row] = await prisma
    .$queryRawUnsafe<Row[]>(
      `INSERT INTO rental_handovers
         (handover_no, agreement_id, agreement_no, customer_name,
          vehicle_id, vehicle_no, vehicle_name,
          handover_type, handover_date,
          fuel_level, odometer_reading, condition_score,
          body_condition, interior_condition, tyres_condition,
          keys_count, spare_key, salik_tag, parking_card,
          accessories, checklist_items,
          notes, signed_by, signed_at, status, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING *`,
      handoverNo,
      body.agreementId ?? null,
      body.agreementNo ?? null,
      body.customerName ?? null,
      body.vehicleId ?? null,
      body.vehicleNo ?? null,
      body.vehicleName ?? null,
      body.handoverType ?? 'PICKUP',
      body.handoverDate ?? new Date().toISOString(),
      body.fuelLevel ?? 4,
      body.odometerReading ?? 0,
      body.conditionScore ?? 3,
      body.bodyCondition ?? 'Good',
      body.interiorCondition ?? 'Clean',
      body.tyresCondition ?? 'Good',
      body.keysCount ?? 1,
      body.spareKey ?? false,
      body.salikTag ?? false,
      body.parkingCard ?? false,
      JSON.stringify(accessories),
      JSON.stringify(checklistItems),
      body.notes ?? null,
      body.signedBy ?? null,
      body.signedAt ?? null,
      body.status ?? 'PENDING',
      body.branchId ?? null,
    )
    .catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create handover' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}

/* ─── PATCH ─── */
export async function PATCH(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});

  const body = await req.json();
  const { id, signOff, ...fields } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sets: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  // Sign-off action: mark COMPLETED
  if (signOff) {
    sets.push(`status='COMPLETED'`, `signed_by=$${pi++}`, `signed_at=NOW()`);
    params.push(fields.signedBy ?? 'SYSTEM');
  }

  const fieldMap: Record<string, string> = {
    status: 'status',
    fuelLevel: 'fuel_level',
    odometerReading: 'odometer_reading',
    conditionScore: 'condition_score',
    bodyCondition: 'body_condition',
    interiorCondition: 'interior_condition',
    tyresCondition: 'tyres_condition',
    keysCount: 'keys_count',
    spareKey: 'spare_key',
    salikTag: 'salik_tag',
    parkingCard: 'parking_card',
    notes: 'notes',
    branchId: 'branch_id',
  };

  for (const [k, col] of Object.entries(fieldMap)) {
    if (k in fields && !signOff) {
      sets.push(`${col}=$${pi++}`);
      params.push(fields[k]);
    }
  }

  if (fields.accessories !== undefined) {
    sets.push(`accessories=$${pi++}`);
    params.push(JSON.stringify(fields.accessories));
  }
  if (fields.checklistItems !== undefined) {
    sets.push(`checklist_items=$${pi++}`);
    params.push(JSON.stringify(fields.checklistItems));
  }

  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  sets.push(`updated_at=NOW()`);
  params.push(id);

  const [row] = await prisma
    .$queryRawUnsafe<Row[]>(
      `UPDATE rental_handovers SET ${sets.join(',')} WHERE id=$${pi} RETURNING *`,
      ...params,
    )
    .catch(() => []);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}
