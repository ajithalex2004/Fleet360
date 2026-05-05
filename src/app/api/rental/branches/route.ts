import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * RAC Branch Management API
 * Table: rental_branches
 *
 * GET   /api/rental/branches?status=
 * POST  /api/rental/branches  — create branch (auto-generates branch_code)
 * PATCH /api/rental/branches  — update branch fields / status
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rental_branches (
      id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ,
      branch_code      TEXT          UNIQUE NOT NULL,
      branch_name      TEXT          NOT NULL,
      emirate          TEXT          NOT NULL,
      address          TEXT,
      phone            TEXT,
      email            TEXT,
      manager_name     TEXT,
      operating_hours  TEXT          NOT NULL DEFAULT '8:00 AM - 8:00 PM',
      vehicle_capacity INT           NOT NULL DEFAULT 0,
      status           TEXT          NOT NULL DEFAULT 'ACTIVE',
      latitude         NUMERIC(10,7),
      longitude        NUMERIC(10,7),
      notes            TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rb_status ON rental_branches(status)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_rb_emirate ON rental_branches(emirate)
  `);
}

const EMIRATE_PREFIX: Record<string, string> = {
  DUBAI:          'DXB',
  ABU_DHABI:      'AUH',
  SHARJAH:        'SHJ',
  AJMAN:          'AJM',
  RAS_AL_KHAIMAH: 'RAK',
  FUJAIRAH:       'FUJ',
  UMM_AL_QUWAIN:  'UAQ',
};

export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status')  ?? '';
    const emirate = searchParams.get('emirate') ?? '';
    const search  = searchParams.get('search')  ?? '';
    const limit   = Math.min(200, Number(searchParams.get('limit') ?? 100));

    const conds: string[] = ['b.deleted_at IS NULL'];
    const params: unknown[] = [];
    let pi = 1;

    if (status && status !== 'ALL') {
      conds.push(`b.status = $${pi++}`);
      params.push(status);
    }

    if (emirate && emirate !== 'ALL') {
      conds.push(`b.emirate = $${pi++}`);
      params.push(emirate);
    }

    if (search) {
      conds.push(`(b.branch_name ILIKE $${pi} OR b.branch_code ILIKE $${pi} OR b.manager_name ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = `WHERE ${conds.join(' AND ')}`;

    type BranchRow = {
      id: string;
      branch_code: string;
      branch_name: string;
      emirate: string;
      address: string | null;
      phone: string | null;
      email: string | null;
      manager_name: string | null;
      operating_hours: string;
      vehicle_capacity: number;
      status: string;
      latitude: string | null;
      longitude: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    };

    const branches = await prisma.$queryRawUnsafe<BranchRow[]>(
      `SELECT b.*
         FROM rental_branches b
         ${where}
         ORDER BY b.emirate ASC, b.branch_name ASC
         LIMIT $${pi}`,
      ...params, limit
    ).catch(() => [] as BranchRow[]);

    // KPI Stats
    type StatRow = {
      total: bigint;
      active: bigint;
      emirates_covered: bigint;
      total_capacity: bigint;
    };
    const [stats] = await prisma.$queryRawUnsafe<StatRow[]>(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE') AS active,
        COUNT(DISTINCT emirate) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE') AS emirates_covered,
        COALESCE(SUM(vehicle_capacity) FILTER (WHERE deleted_at IS NULL AND status = 'ACTIVE'), 0) AS total_capacity
      FROM rental_branches
    `).catch(() => [{ total: 0n, active: 0n, emirates_covered: 0n, total_capacity: 0n }]);

    return NextResponse.json({
      branches: branches.map(b => ({
        id: b.id,
        branchCode: b.branch_code,
        branchName: b.branch_name,
        emirate: b.emirate,
        address: b.address,
        phone: b.phone,
        email: b.email,
        managerName: b.manager_name,
        operatingHours: b.operating_hours,
        vehicleCapacity: b.vehicle_capacity,
        status: b.status,
        latitude: b.latitude ? Number(b.latitude) : null,
        longitude: b.longitude ? Number(b.longitude) : null,
        notes: b.notes,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
      })),
      stats: {
        total: Number(stats.total),
        active: Number(stats.active),
        emiratesCovered: Number(stats.emirates_covered),
        totalCapacity: Number(stats.total_capacity),
      },
    });
  } catch (err) {
    console.error('[branches GET]', err);
    return NextResponse.json({ error: 'Failed to load branches' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const {
      branchName, emirate, address, phone, email,
      managerName, operatingHours = '8:00 AM - 8:00 PM',
      vehicleCapacity = 0, latitude, longitude, notes,
    } = body;

    if (!branchName?.trim()) return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
    if (!emirate?.trim())    return NextResponse.json({ error: 'Emirate is required' }, { status: 400 });

    const prefix = EMIRATE_PREFIX[emirate] ?? 'RAC';

    // Find next sequential number for this prefix
    type CountRow = { cnt: bigint };
    const [countRow] = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS cnt FROM rental_branches WHERE branch_code LIKE $1`,
      `${prefix}-%`
    );
    const seq = String(Number(countRow.cnt) + 1).padStart(3, '0');
    const branchCode = `${prefix}-${seq}`;

    type NewBranch = { id: string; branch_code: string };
    const [branch] = await prisma.$queryRawUnsafe<NewBranch[]>(
      `INSERT INTO rental_branches
         (branch_code, branch_name, emirate, address, phone, email,
          manager_name, operating_hours, vehicle_capacity, latitude, longitude, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, branch_code`,
      branchCode,
      branchName.trim(),
      emirate.trim(),
      address || null,
      phone || null,
      email || null,
      managerName || null,
      operatingHours,
      Number(vehicleCapacity),
      latitude ? Number(latitude) : null,
      longitude ? Number(longitude) : null,
      notes || null
    );

    return NextResponse.json({ id: branch.id, branchCode: branch.branch_code }, { status: 201 });
  } catch (err) {
    console.error('[branches POST]', err);
    return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const colMap: Record<string, string> = {
      branchName:      'branch_name',
      emirate:         'emirate',
      address:         'address',
      phone:           'phone',
      email:           'email',
      managerName:     'manager_name',
      operatingHours:  'operating_hours',
      vehicleCapacity: 'vehicle_capacity',
      status:          'status',
      latitude:        'latitude',
      longitude:       'longitude',
      notes:           'notes',
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let pi = 1;

    for (const [key, col] of Object.entries(colMap)) {
      if (key in fields) {
        setClauses.push(`${col} = $${pi++}`);
        params.push(fields[key] === '' ? null : fields[key]);
      }
    }

    params.push(id);
    await prisma.$executeRawUnsafe(
      `UPDATE rental_branches SET ${setClauses.join(', ')} WHERE id = $${pi}`,
      ...params
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[branches PATCH]', err);
    return NextResponse.json({ error: 'Failed to update branch' }, { status: 500 });
  }
}
