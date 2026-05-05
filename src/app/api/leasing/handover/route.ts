import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Leasing Vehicle Handover & Return Checklists API
 * Auto-creates `leasing_handovers` table on every request.
 *
 * Handover types: DELIVERY | RETURN
 * Lifecycle:      SCHEDULED → IN_PROGRESS → COMPLETED | DISPUTED
 *
 * GET   /api/leasing/handover?handover_type=&status=&search=&page=&limit=
 * POST  /api/leasing/handover      — schedule a new handover
 * PATCH /api/leasing/handover?id=  — update status / sign off
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS leasing_handovers (
      id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      handover_no        TEXT         UNIQUE NOT NULL,
      contract_id        TEXT,
      contract_no        TEXT,
      lessee_name        TEXT         NOT NULL,
      vehicle_id         TEXT,
      vehicle_no         TEXT         NOT NULL,
      vehicle_name       TEXT,
      handover_type      TEXT         NOT NULL,
      handover_date      TIMESTAMPTZ  NOT NULL,
      location           TEXT,
      fuel_level         INT          CHECK (fuel_level BETWEEN 0 AND 8),
      odometer_reading   INT,
      condition_score    INT          CHECK (condition_score BETWEEN 1 AND 5),
      body_condition     TEXT,
      interior_condition TEXT,
      tyres_condition    TEXT,
      keys_count         INT          NOT NULL DEFAULT 2,
      spare_key          BOOLEAN      NOT NULL DEFAULT FALSE,
      salik_tag          BOOLEAN      NOT NULL DEFAULT FALSE,
      parking_card       BOOLEAN      NOT NULL DEFAULT FALSE,
      service_book       BOOLEAN      NOT NULL DEFAULT FALSE,
      accessories        JSONB        NOT NULL DEFAULT '[]',
      checklist_items    JSONB        NOT NULL DEFAULT '[]',
      damage_notes       TEXT,
      notes              TEXT,
      signed_by          TEXT,
      signed_at          TIMESTAMPTZ,
      witnessed_by       TEXT,
      status             TEXT         NOT NULL DEFAULT 'SCHEDULED',
      branch_id          TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_leasing_handovers_status ON leasing_handovers(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_leasing_handovers_type ON leasing_handovers(handover_type)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_leasing_handovers_date ON leasing_handovers(handover_date)
  `);
}

type HandoverRow = {
  id: string;
  created_at: string;
  updated_at: string;
  handover_no: string;
  contract_id: string | null;
  contract_no: string | null;
  lessee_name: string;
  vehicle_id: string | null;
  vehicle_no: string;
  vehicle_name: string | null;
  handover_type: string;
  handover_date: string;
  location: string | null;
  fuel_level: number | null;
  odometer_reading: number | null;
  condition_score: number | null;
  body_condition: string | null;
  interior_condition: string | null;
  tyres_condition: string | null;
  keys_count: number;
  spare_key: boolean;
  salik_tag: boolean;
  parking_card: boolean;
  service_book: boolean;
  accessories: unknown;
  checklist_items: unknown;
  damage_notes: string | null;
  notes: string | null;
  signed_by: string | null;
  signed_at: string | null;
  witnessed_by: string | null;
  status: string;
  branch_id: string | null;
};

type CountRow = { status: string; cnt: bigint };
type TypeCountRow = { handover_type: string; cnt: bigint };
type SeqRow = { seq: bigint };

function mapHandover(r: HandoverRow) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    handoverNo: r.handover_no,
    contractId: r.contract_id,
    contractNo: r.contract_no,
    lesseeName: r.lessee_name,
    vehicleId: r.vehicle_id,
    vehicleNo: r.vehicle_no,
    vehicleName: r.vehicle_name,
    handoverType: r.handover_type,
    handoverDate: r.handover_date,
    location: r.location,
    fuelLevel: r.fuel_level,
    odometerReading: r.odometer_reading,
    conditionScore: r.condition_score,
    bodyCondition: r.body_condition,
    interiorCondition: r.interior_condition,
    tyresCondition: r.tyres_condition,
    keysCount: r.keys_count,
    spareKey: r.spare_key,
    salikTag: r.salik_tag,
    parkingCard: r.parking_card,
    serviceBook: r.service_book,
    accessories: r.accessories ?? [],
    checklistItems: r.checklist_items ?? [],
    damageNotes: r.damage_notes,
    notes: r.notes,
    signedBy: r.signed_by,
    signedAt: r.signed_at,
    witnessedBy: r.witnessed_by,
    status: r.status,
    branchId: r.branch_id,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const sp           = req.nextUrl.searchParams;
    const handoverType = sp.get('handover_type') ?? '';
    const status       = sp.get('status')        ?? '';
    const search       = sp.get('search')        ?? '';
    const page         = Math.max(1, Number(sp.get('page')  ?? 1));
    const limit        = Math.min(100, Number(sp.get('limit') ?? 20));
    const offset       = (page - 1) * limit;

    const conds: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (handoverType) { conds.push(`h.handover_type = $${pi++}`);  params.push(handoverType); }
    if (status)       { conds.push(`h.status = $${pi++}`);         params.push(status); }
    if (search) {
      conds.push(`(h.vehicle_no ILIKE $${pi} OR h.lessee_name ILIKE $${pi} OR h.handover_no ILIKE $${pi} OR h.contract_no ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows, countRows, statusCounts, typeCounts] = await Promise.all([
      prisma.$queryRawUnsafe<HandoverRow[]>(
        `SELECT h.* FROM leasing_handovers h ${where} ORDER BY h.handover_date DESC LIMIT $${pi} OFFSET $${pi + 1}`,
        ...params, limit, offset
      ).catch(() => [] as HandoverRow[]),

      prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
        `SELECT COUNT(*) AS cnt FROM leasing_handovers h ${where}`,
        ...params
      ).catch(() => [{ cnt: BigInt(0) }]),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT status, COUNT(*) AS cnt FROM leasing_handovers GROUP BY status`
      ).catch(() => [] as CountRow[]),

      prisma.$queryRawUnsafe<TypeCountRow[]>(
        `SELECT handover_type, COUNT(*) AS cnt FROM leasing_handovers GROUP BY handover_type`
      ).catch(() => [] as TypeCountRow[]),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const [completedToday] = await prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
      `SELECT COUNT(*) AS cnt FROM leasing_handovers WHERE status = 'COMPLETED' AND DATE(updated_at) = $1`,
      today
    ).catch(() => [{ cnt: BigInt(0) }]);

    const [pendingSignoff] = await prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
      `SELECT COUNT(*) AS cnt FROM leasing_handovers WHERE status = 'IN_PROGRESS'`
    ).catch(() => [{ cnt: BigInt(0) }]);

    const total = Number(countRows[0]?.cnt ?? 0);
    const statusMap = Object.fromEntries(statusCounts.map(s => [s.status, Number(s.cnt)]));
    const typeMap   = Object.fromEntries(typeCounts.map(t => [t.handover_type, Number(t.cnt)]));

    return NextResponse.json({
      data: rows.map(mapHandover),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        byStatus: statusMap,
        byType: typeMap,
        scheduledDeliveries: statusMap['SCHEDULED'] ? (typeMap['DELIVERY'] ?? 0) : 0,
        scheduledReturns:    statusMap['SCHEDULED'] ? (typeMap['RETURN']   ?? 0) : 0,
        completedToday:      Number(completedToday?.cnt ?? 0),
        pendingSignoff:      Number(pendingSignoff?.cnt ?? 0),
      },
    });
  } catch (err) {
    console.error('[handover GET]', err);
    return NextResponse.json({ error: 'Failed to load handovers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();

    const {
      contractId, contractNo, lesseeName, vehicleId, vehicleNo, vehicleName,
      handoverType, handoverDate, location, fuelLevel, odometerReading,
      conditionScore, bodyCondition, interiorCondition, tyresCondition,
      keysCount = 2, spareKey = false, salikTag = false,
      parkingCard = false, serviceBook = false,
      accessories = [], checklistItems = [],
      damageNotes, notes, signedBy, witnessedBy, branchId,
    } = body;

    if (!lesseeName?.trim()) {
      return NextResponse.json({ error: 'lessee_name is required' }, { status: 400 });
    }
    if (!vehicleNo?.trim()) {
      return NextResponse.json({ error: 'vehicle_no is required' }, { status: 400 });
    }
    if (!handoverType || !['DELIVERY', 'RETURN'].includes(handoverType)) {
      return NextResponse.json({ error: 'handover_type must be DELIVERY or RETURN' }, { status: 400 });
    }
    if (!handoverDate) {
      return NextResponse.json({ error: 'handover_date is required' }, { status: 400 });
    }

    // Generate handover_no: LHO-YYYYMM-XXXX
    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    const [seqRow] = await prisma.$queryRawUnsafe<SeqRow[]>(
      `SELECT COUNT(*) + 1 AS seq FROM leasing_handovers WHERE handover_no LIKE $1`,
      `LHO-${yyyymm}-%`
    );
    const seq = String(Number(seqRow?.seq ?? 1)).padStart(4, '0');
    const handoverNo = `LHO-${yyyymm}-${seq}`;

    type NewRow = { id: string; handover_no: string };
    const [row] = await prisma.$queryRawUnsafe<NewRow[]>(
      `INSERT INTO leasing_handovers
         (handover_no, contract_id, contract_no, lessee_name, vehicle_id, vehicle_no, vehicle_name,
          handover_type, handover_date, location, fuel_level, odometer_reading,
          condition_score, body_condition, interior_condition, tyres_condition,
          keys_count, spare_key, salik_tag, parking_card, service_book,
          accessories, checklist_items, damage_notes, notes,
          signed_by, witnessed_by, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING id, handover_no`,
      handoverNo,
      contractId     || null,
      contractNo     || null,
      lesseeName.trim(),
      vehicleId      || null,
      vehicleNo.trim(),
      vehicleName    || null,
      handoverType,
      new Date(handoverDate).toISOString(),
      location       || null,
      fuelLevel      !== undefined ? Number(fuelLevel)      : null,
      odometerReading !== undefined ? Number(odometerReading) : null,
      conditionScore  !== undefined ? Number(conditionScore)  : null,
      bodyCondition  || null,
      interiorCondition || null,
      tyresCondition || null,
      Number(keysCount),
      Boolean(spareKey),
      Boolean(salikTag),
      Boolean(parkingCard),
      Boolean(serviceBook),
      JSON.stringify(accessories),
      JSON.stringify(checklistItems),
      damageNotes   || null,
      notes         || null,
      signedBy      || null,
      witnessedBy   || null,
      branchId      || null
    );

    return NextResponse.json({ id: row.id, handoverNo: row.handover_no }, { status: 201 });
  } catch (err) {
    console.error('[handover POST]', err);
    return NextResponse.json({ error: 'Failed to create handover' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    const body = await req.json();
    const { action, signedBy, witnessedBy, damageNotes, notes, status: newStatus } = body;

    const [current] = await prisma.$queryRawUnsafe<HandoverRow[]>(
      `SELECT * FROM leasing_handovers WHERE id = $1`,
      id
    );
    if (!current) {
      return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === 'START') {
      if (current.status !== 'SCHEDULED') {
        return NextResponse.json({ error: 'Only SCHEDULED handovers can be started' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_handovers SET status='IN_PROGRESS', updated_at=$1 WHERE id=$2`,
        now, id
      );
    } else if (action === 'COMPLETE') {
      if (!['SCHEDULED', 'IN_PROGRESS'].includes(current.status)) {
        return NextResponse.json({ error: 'Only SCHEDULED or IN_PROGRESS handovers can be completed' }, { status: 400 });
      }
      if (!signedBy?.trim()) {
        return NextResponse.json({ error: 'signed_by is required to complete handover' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_handovers
           SET status='COMPLETED', signed_by=$1, signed_at=$2, witnessed_by=$3,
               damage_notes=$4, notes=$5, updated_at=$6
         WHERE id=$7`,
        signedBy.trim(), now, witnessedBy || null,
        damageNotes || current.damage_notes,
        notes       || current.notes,
        now, id
      );
    } else if (action === 'DISPUTE') {
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_handovers SET status='DISPUTED', damage_notes=$1, updated_at=$2 WHERE id=$3`,
        damageNotes || current.damage_notes, now, id
      );
    } else if (newStatus) {
      // Generic status update
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_handovers SET status=$1, updated_at=$2 WHERE id=$3`,
        newStatus, now, id
      );
    } else {
      return NextResponse.json({ error: 'action or status required' }, { status: 400 });
    }

    const [updated] = await prisma.$queryRawUnsafe<HandoverRow[]>(
      `SELECT * FROM leasing_handovers WHERE id = $1`,
      id
    );
    return NextResponse.json(mapHandover(updated));
  } catch (err) {
    console.error('[handover PATCH]', err);
    return NextResponse.json({ error: 'Failed to update handover' }, { status: 500 });
  }
}
