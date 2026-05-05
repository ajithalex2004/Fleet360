import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Ensure table exists (idempotent DDL)
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS branch_staff_assignments (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
      deleted_at   TIMESTAMPTZ,
      staff_no     TEXT        UNIQUE NOT NULL,
      full_name    TEXT        NOT NULL,
      email        TEXT,
      phone        TEXT        NOT NULL,
      role         TEXT        NOT NULL,
      module       TEXT        NOT NULL,
      branch_id    TEXT,
      branch_name  TEXT        NOT NULL,
      emirate      TEXT,
      start_date   DATE        NOT NULL,
      end_date     DATE,
      status       TEXT        NOT NULL DEFAULT 'ACTIVE',
      employee_id  TEXT,
      nationality  TEXT,
      notes        TEXT
    )
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-generate staff number: STF-YYYYMM-XXXX
// ─────────────────────────────────────────────────────────────────────────────
async function generateStaffNo(): Promise<string> {
  const now   = new Date();
  const ym    = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows  = await prisma.$queryRawUnsafe<{ cnt: string }[]>(
    `SELECT COUNT(*)::text AS cnt FROM branch_staff_assignments WHERE staff_no LIKE $1`,
    `STF-${ym}-%`
  );
  const seq = (parseInt(rows[0]?.cnt || '0') + 1).toString().padStart(4, '0');
  return `STF-${ym}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/branch-staff
// Query params: module, branch_name, role, status, search, page, limit
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    await ensureTable();

    const sp          = new URL(req.url).searchParams;
    const module      = sp.get('module');
    const branch_name = sp.get('branch_name');
    const role        = sp.get('role');
    const status      = sp.get('status');
    const search      = sp.get('search');
    const page        = Math.max(1, parseInt(sp.get('page') || '1'));
    const limit       = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50')));
    const offset      = (page - 1) * limit;

    // Build WHERE clauses dynamically
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: unknown[]    = [];

    if (module) {
      params.push(module);
      conditions.push(`(module = $${params.length} OR module = 'BOTH')`);
    }
    if (branch_name) {
      params.push(branch_name);
      conditions.push(`branch_name = $${params.length}`);
    }
    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(full_name ILIKE $${params.length} OR staff_no ILIKE $${params.length} OR employee_id ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countRows = await prisma.$queryRawUnsafe<{ cnt: string }[]>(
      `SELECT COUNT(*)::text AS cnt FROM branch_staff_assignments ${where}`,
      ...params
    );
    const total = parseInt(countRows[0]?.cnt || '0');

    // Data
    params.push(limit, offset);
    const staff = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM branch_staff_assignments ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      ...params
    );

    // Summary counts by role
    const roleSummary = await prisma.$queryRawUnsafe<{ role: string; cnt: string }[]>(
      `SELECT role, COUNT(*)::text AS cnt FROM branch_staff_assignments WHERE deleted_at IS NULL AND status = 'ACTIVE' GROUP BY role`
    );

    // KPI totals
    const kpiRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         COUNT(*)::int                                                              AS total,
         COUNT(*) FILTER (WHERE status = 'ACTIVE')::int                           AS active,
         COUNT(*) FILTER (WHERE status = 'ON_LEAVE')::int                         AS on_leave,
         COUNT(*) FILTER (WHERE role = 'BRANCH_MANAGER' AND status = 'ACTIVE')::int AS branch_managers
       FROM branch_staff_assignments
       WHERE deleted_at IS NULL`
    );

    return NextResponse.json({
      data:        staff,
      total,
      page,
      limit,
      pages:       Math.ceil(total / limit),
      kpi:         kpiRows[0] || { total: 0, active: 0, on_leave: 0, branch_managers: 0 },
      roleSummary: roleSummary.reduce((acc: Record<string, number>, r) => {
        acc[r.role] = parseInt(r.cnt);
        return acc;
      }, {}),
    });
  } catch (err: any) {
    console.error('[branch-staff GET]', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/branch-staff — create new assignment
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();

    const {
      full_name, email, phone, role, module, branch_id, branch_name,
      emirate, start_date, end_date, status = 'ACTIVE',
      employee_id, nationality, notes,
    } = body;

    if (!full_name || !phone || !role || !module || !branch_name || !start_date) {
      return NextResponse.json({ error: 'Missing required fields: full_name, phone, role, module, branch_name, start_date' }, { status: 400 });
    }

    const staff_no = await generateStaffNo();

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO branch_staff_assignments
         (staff_no, full_name, email, phone, role, module, branch_id, branch_name, emirate, start_date, end_date, status, employee_id, nationality, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      staff_no, full_name, email || null, phone, role, module,
      branch_id || null, branch_name, emirate || null,
      start_date, end_date || null, status,
      employee_id || null, nationality || null, notes || null
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: any) {
    console.error('[branch-staff POST]', err);
    return NextResponse.json({ error: err.message || 'Failed to create staff assignment' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/branch-staff — update one record (id in body)
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Build SET clause dynamically
    const allowed = ['full_name','email','phone','role','module','branch_id','branch_name',
                     'emirate','start_date','end_date','status','employee_id','nationality','notes'];
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[]    = [];

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        params.push(val);
        setClauses.push(`${key} = $${params.length}`);
      }
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    params.push(id);
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE branch_staff_assignments SET ${setClauses.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      ...params
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err: any) {
    console.error('[branch-staff PATCH]', err);
    return NextResponse.json({ error: err.message || 'Failed to update' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/branch-staff — soft-delete (id in query)
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    await ensureTable();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await prisma.$executeRawUnsafe(
      `UPDATE branch_staff_assignments SET deleted_at = NOW(), status = 'INACTIVE', updated_at = NOW() WHERE id = $1`,
      id
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[branch-staff DELETE]', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
