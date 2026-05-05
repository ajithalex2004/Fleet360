import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Leasing Inter-Branch Vehicle Transfers API
 * Auto-creates `leasing_vehicle_transfers` table on every request.
 *
 * Status workflow: REQUESTED → APPROVED → IN_TRANSIT → COMPLETED | CANCELLED
 * Reasons: REBALANCING / CONTRACT_REQUIREMENT / MAINTENANCE / CUSTOMER_REQUEST / OTHER
 *
 * GET   /api/leasing/transfers?status=&from_branch=&to_branch=&search=&page=&limit=
 * POST  /api/leasing/transfers      — create transfer request (auto-generates LVT-YYYYMM-XXXX)
 * PATCH /api/leasing/transfers?id=  — workflow transitions
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS leasing_vehicle_transfers (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      transfer_no      TEXT        UNIQUE NOT NULL,
      vehicle_id       TEXT,
      vehicle_no       TEXT        NOT NULL,
      vehicle_name     TEXT,
      vehicle_make     TEXT,
      vehicle_model    TEXT,
      from_branch_id   TEXT,
      from_branch_name TEXT        NOT NULL,
      from_emirate     TEXT,
      to_branch_id     TEXT,
      to_branch_name   TEXT        NOT NULL,
      to_emirate       TEXT,
      transfer_date    DATE        NOT NULL,
      reason           TEXT        NOT NULL,
      fuel_level       INT         CHECK (fuel_level BETWEEN 0 AND 8),
      odometer_reading INT,
      condition_notes  TEXT,
      driver_name      TEXT,
      driver_phone     TEXT,
      status           TEXT        NOT NULL DEFAULT 'REQUESTED',
      requested_by     TEXT,
      approved_by      TEXT,
      approved_at      TIMESTAMPTZ,
      departed_at      TIMESTAMPTZ,
      arrived_at       TIMESTAMPTZ,
      cancelled_reason TEXT,
      notes            TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_lvt_status ON leasing_vehicle_transfers(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_lvt_from_branch ON leasing_vehicle_transfers(from_branch_name)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_lvt_to_branch ON leasing_vehicle_transfers(to_branch_name)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_lvt_transfer_date ON leasing_vehicle_transfers(transfer_date)
  `);
}

type TransferRow = {
  id: string;
  created_at: string;
  updated_at: string;
  transfer_no: string;
  vehicle_id: string | null;
  vehicle_no: string;
  vehicle_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  from_branch_id: string | null;
  from_branch_name: string;
  from_emirate: string | null;
  to_branch_id: string | null;
  to_branch_name: string;
  to_emirate: string | null;
  transfer_date: string;
  reason: string;
  fuel_level: number | null;
  odometer_reading: number | null;
  condition_notes: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  status: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  cancelled_reason: string | null;
  notes: string | null;
};

type CountRow = { status: string; cnt: bigint };
type SeqRow = { seq: bigint };

function mapTransfer(r: TransferRow) {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    transferNo: r.transfer_no,
    vehicleId: r.vehicle_id,
    vehicleNo: r.vehicle_no,
    vehicleName: r.vehicle_name,
    vehicleMake: r.vehicle_make,
    vehicleModel: r.vehicle_model,
    fromBranchId: r.from_branch_id,
    fromBranchName: r.from_branch_name,
    fromEmirate: r.from_emirate,
    toBranchId: r.to_branch_id,
    toBranchName: r.to_branch_name,
    toEmirate: r.to_emirate,
    transferDate: r.transfer_date,
    reason: r.reason,
    fuelLevel: r.fuel_level,
    odometerReading: r.odometer_reading,
    conditionNotes: r.condition_notes,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    status: r.status,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    departedAt: r.departed_at,
    arrivedAt: r.arrived_at,
    cancelledReason: r.cancelled_reason,
    notes: r.notes,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const sp         = req.nextUrl.searchParams;
    const status     = sp.get('status')      ?? '';
    const fromBranch = sp.get('from_branch') ?? '';
    const toBranch   = sp.get('to_branch')   ?? '';
    const search     = sp.get('search')      ?? '';
    const page       = Math.max(1, Number(sp.get('page')  ?? 1));
    const limit      = Math.min(100, Number(sp.get('limit') ?? 20));
    const offset     = (page - 1) * limit;

    const conds: string[] = [];
    const params: unknown[] = [];
    let pi = 1;

    if (status)     { conds.push(`t.status = $${pi++}`);                   params.push(status); }
    if (fromBranch) { conds.push(`t.from_branch_name ILIKE $${pi++}`);     params.push(`%${fromBranch}%`); }
    if (toBranch)   { conds.push(`t.to_branch_name ILIKE $${pi++}`);       params.push(`%${toBranch}%`); }
    if (search) {
      conds.push(`(t.vehicle_no ILIKE $${pi} OR t.transfer_no ILIKE $${pi} OR t.vehicle_name ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows, countRows, statusCounts] = await Promise.all([
      prisma.$queryRawUnsafe<TransferRow[]>(
        `SELECT t.* FROM leasing_vehicle_transfers t ${where} ORDER BY t.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
        ...params, limit, offset
      ).catch(() => [] as TransferRow[]),

      prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
        `SELECT COUNT(*) AS cnt FROM leasing_vehicle_transfers t ${where}`,
        ...params
      ).catch(() => [{ cnt: BigInt(0) }]),

      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT status, COUNT(*) AS cnt FROM leasing_vehicle_transfers GROUP BY status`
      ).catch(() => [] as CountRow[]),
    ]);

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const [completedThisMonth] = await prisma.$queryRawUnsafe<[{ cnt: bigint }]>(
      `SELECT COUNT(*) AS cnt FROM leasing_vehicle_transfers WHERE status = 'COMPLETED' AND arrived_at >= $1`,
      firstOfMonth
    ).catch(() => [{ cnt: BigInt(0) }]);

    const total = Number(countRows[0]?.cnt ?? 0);
    const statusMap = Object.fromEntries(statusCounts.map(s => [s.status, Number(s.cnt)]));

    return NextResponse.json({
      data: rows.map(mapTransfer),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: {
        byStatus: statusMap,
        requested:           statusMap['REQUESTED']  ?? 0,
        approved:            statusMap['APPROVED']   ?? 0,
        inTransit:           statusMap['IN_TRANSIT'] ?? 0,
        completed:           statusMap['COMPLETED']  ?? 0,
        cancelled:           statusMap['CANCELLED']  ?? 0,
        completedThisMonth:  Number(completedThisMonth?.cnt ?? 0),
      },
    });
  } catch (err) {
    console.error('[leasing/transfers GET]', err);
    return NextResponse.json({ error: 'Failed to load transfers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();

    const {
      vehicleId, vehicleNo, vehicleName, vehicleMake, vehicleModel,
      fromBranchId, fromBranchName, fromEmirate,
      toBranchId, toBranchName, toEmirate,
      transferDate, reason,
      fuelLevel, odometerReading, conditionNotes,
      driverName, driverPhone,
      requestedBy, notes,
    } = body;

    if (!vehicleNo?.trim())      return NextResponse.json({ error: 'vehicle_no is required' },       { status: 400 });
    if (!fromBranchName?.trim()) return NextResponse.json({ error: 'from_branch_name is required' }, { status: 400 });
    if (!toBranchName?.trim())   return NextResponse.json({ error: 'to_branch_name is required' },   { status: 400 });
    if (!transferDate)           return NextResponse.json({ error: 'transfer_date is required' },     { status: 400 });
    if (!reason)                 return NextResponse.json({ error: 'reason is required' },            { status: 400 });

    const validReasons = ['REBALANCING', 'CONTRACT_REQUIREMENT', 'MAINTENANCE', 'CUSTOMER_REQUEST', 'OTHER'];
    if (!validReasons.includes(reason)) {
      return NextResponse.json({ error: `reason must be one of: ${validReasons.join(', ')}` }, { status: 400 });
    }

    // Generate transfer_no: LVT-YYYYMM-XXXX
    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    const [seqRow] = await prisma.$queryRawUnsafe<SeqRow[]>(
      `SELECT COUNT(*) + 1 AS seq FROM leasing_vehicle_transfers WHERE transfer_no LIKE $1`,
      `LVT-${yyyymm}-%`
    );
    const seq = String(Number(seqRow?.seq ?? 1)).padStart(4, '0');
    const transferNo = `LVT-${yyyymm}-${seq}`;

    type NewRow = { id: string; transfer_no: string };
    const [row] = await prisma.$queryRawUnsafe<NewRow[]>(
      `INSERT INTO leasing_vehicle_transfers
         (transfer_no, vehicle_id, vehicle_no, vehicle_name, vehicle_make, vehicle_model,
          from_branch_id, from_branch_name, from_emirate,
          to_branch_id, to_branch_name, to_emirate,
          transfer_date, reason, fuel_level, odometer_reading, condition_notes,
          driver_name, driver_phone, requested_by, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'REQUESTED')
       RETURNING id, transfer_no`,
      transferNo,
      vehicleId      || null,
      vehicleNo.trim(),
      vehicleName    || null,
      vehicleMake    || null,
      vehicleModel   || null,
      fromBranchId   || null,
      fromBranchName.trim(),
      fromEmirate    || null,
      toBranchId     || null,
      toBranchName.trim(),
      toEmirate      || null,
      transferDate,
      reason,
      fuelLevel       !== undefined && fuelLevel !== '' ? Number(fuelLevel)       : null,
      odometerReading !== undefined && odometerReading !== '' ? Number(odometerReading) : null,
      conditionNotes || null,
      driverName     || null,
      driverPhone    || null,
      requestedBy    || null,
      notes          || null
    );

    return NextResponse.json({ id: row.id, transferNo: row.transfer_no }, { status: 201 });
  } catch (err) {
    console.error('[leasing/transfers POST]', err);
    return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

    const body = await req.json();
    const { action, approvedBy, cancelledReason } = body;

    const [current] = await prisma.$queryRawUnsafe<TransferRow[]>(
      `SELECT * FROM leasing_vehicle_transfers WHERE id = $1`, id
    );
    if (!current) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });

    const now = new Date().toISOString();

    if (action === 'APPROVE') {
      if (current.status !== 'REQUESTED') {
        return NextResponse.json({ error: 'Only REQUESTED transfers can be approved' }, { status: 400 });
      }
      if (!approvedBy?.trim()) {
        return NextResponse.json({ error: 'approved_by is required' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_vehicle_transfers SET status='APPROVED', approved_by=$1, approved_at=$2, updated_at=$3 WHERE id=$4`,
        approvedBy.trim(), now, now, id
      );
    } else if (action === 'DEPART') {
      if (current.status !== 'APPROVED') {
        return NextResponse.json({ error: 'Only APPROVED transfers can be departed' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_vehicle_transfers SET status='IN_TRANSIT', departed_at=$1, updated_at=$2 WHERE id=$3`,
        now, now, id
      );
    } else if (action === 'ARRIVE') {
      if (current.status !== 'IN_TRANSIT') {
        return NextResponse.json({ error: 'Only IN_TRANSIT transfers can be completed' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_vehicle_transfers SET status='COMPLETED', arrived_at=$1, updated_at=$2 WHERE id=$3`,
        now, now, id
      );
    } else if (action === 'CANCEL') {
      if (current.status === 'COMPLETED') {
        return NextResponse.json({ error: 'Completed transfers cannot be cancelled' }, { status: 400 });
      }
      if (!cancelledReason?.trim()) {
        return NextResponse.json({ error: 'cancelled_reason is required' }, { status: 400 });
      }
      await prisma.$executeRawUnsafe(
        `UPDATE leasing_vehicle_transfers SET status='CANCELLED', cancelled_reason=$1, updated_at=$2 WHERE id=$3`,
        cancelledReason.trim(), now, id
      );
    } else {
      return NextResponse.json({ error: 'action must be one of: APPROVE, DEPART, ARRIVE, CANCEL' }, { status: 400 });
    }

    const [updated] = await prisma.$queryRawUnsafe<TransferRow[]>(
      `SELECT * FROM leasing_vehicle_transfers WHERE id = $1`, id
    );
    return NextResponse.json(mapTransfer(updated));
  } catch (err) {
    console.error('[leasing/transfers PATCH]', err);
    return NextResponse.json({ error: 'Failed to update transfer' }, { status: 500 });
  }
}
