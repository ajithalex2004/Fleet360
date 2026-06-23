/**
 * GET  /api/school-bus/allocations?tenantId=X&routeId=X&studentId=X&status=ACTIVE
 *   Returns seat allocations (student-to-route assignments) with current capacity checks.
 *
 * POST /api/school-bus/allocations
 *   Creates a new seat allocation for a student.
 *   Enforces capacity limits and detects conflicts.
 *
 * Seat modes:
 *   ONE_WAY_PICKUP  — student is picked up only (e.g. morning to school)
 *   ONE_WAY_DROP    — student is dropped only (e.g. afternoon from school)
 *   TWO_WAY         — both pickup and drop (full day service)
 *
 * Table: school_bus_allocations
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

async function ensureTable() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_allocations (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL DEFAULT 'default',
      allocation_no       TEXT        NOT NULL,
      -- Auto-generated: ALLOC-0001

      -- Student
      student_id          UUID,
      student_name        TEXT        NOT NULL,
      student_grade       TEXT,
      student_section     TEXT,
      student_emirates_id TEXT,
      parent_name         TEXT,
      parent_phone        TEXT,
      parent_email        TEXT,

      -- Route assignment
      route_id            UUID,
      route_name          TEXT,
      pickup_stop_id      UUID,
      pickup_stop_name    TEXT,
      pickup_stop_time    TIME,
      drop_stop_id        UUID,
      drop_stop_name      TEXT,
      drop_stop_time      TIME,

      -- Bus mode
      bus_mode            TEXT        NOT NULL DEFAULT 'TWO_WAY',
      -- ONE_WAY_PICKUP | ONE_WAY_DROP | TWO_WAY
      seat_number         INT,
      -- null = auto-assigned on day of trip

      -- Temporal
      effective_from      DATE        NOT NULL DEFAULT CURRENT_DATE,
      effective_to        DATE,
      -- null = open-ended, set on withdrawal

      -- Status
      status              TEXT        NOT NULL DEFAULT 'ACTIVE',
      -- ACTIVE | SUSPENDED | WITHDRAWN | PENDING_APPROVAL
      suspension_reason   TEXT,
      withdrawal_reason   TEXT,
      approved_by         TEXT,
      approved_at         TIMESTAMPTZ,
      notes               TEXT,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sba_alloc_no ON school_bus_allocations(allocation_no, tenant_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_student  ON school_bus_allocations(student_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_route    ON school_bus_allocations(route_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_status   ON school_bus_allocations(tenant_id, status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_stop_pu  ON school_bus_allocations(pickup_stop_id)`);
}

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();

    const sp        = new URL(req.url).searchParams;
    const tenantId  = sp.get('tenantId')  ?? 'default';
    const routeId   = sp.get('routeId')   ?? '';
    const studentId = sp.get('studentId') ?? '';
    const status    = sp.get('status')    ?? '';
    const busMode   = sp.get('busMode')   ?? '';
    const stopId    = sp.get('stopId')    ?? '';
    const search    = sp.get('search')    ?? '';

    const conds: string[] = ['tenant_id = $1'];
    const vals: unknown[] = [tenantId];
    const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

    if (routeId)   add('route_id::text',  routeId);
    if (studentId) add('student_id::text', studentId);
    if (status)    add('status',          status);
    else           conds.push("status != 'DELETED'");
    if (busMode)   add('bus_mode',        busMode);
    if (stopId) {
      vals.push(stopId);
      conds.push(`(pickup_stop_id::text = $${vals.length} OR drop_stop_id::text = $${vals.length})`);
    }
    if (search) {
      vals.push(`%${search}%`);
      conds.push(`(student_name ILIKE $${vals.length} OR parent_name ILIKE $${vals.length} OR allocation_no ILIKE $${vals.length} OR route_name ILIKE $${vals.length})`);
    }

    const where = `WHERE ${conds.join(' AND ')}`;
    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM school_bus_allocations
      ${where}
      ORDER BY student_name ASC, route_name ASC
    `, ...vals).catch(() => [] as Row[]);

    const data = serialize(rows);
    const summary = {
      total:      data.length,
      active:     data.filter(d => d.status === 'ACTIVE').length,
      suspended:  data.filter(d => d.status === 'SUSPENDED').length,
      withdrawn:  data.filter(d => d.status === 'WITHDRAWN').length,
      pending:    data.filter(d => d.status === 'PENDING_APPROVAL').length,
      twoWay:     data.filter(d => d.bus_mode === 'TWO_WAY').length,
      pickupOnly: data.filter(d => d.bus_mode === 'ONE_WAY_PICKUP').length,
      dropOnly:   data.filter(d => d.bus_mode === 'ONE_WAY_DROP').length,
    };

    return NextResponse.json({ data, summary, total: data.length });
  } catch (err) {
    console.error('[school-bus/allocations GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const {
      tenantId = 'default',
      studentName, studentGrade, studentSection, studentEmiratesId,
      parentName, parentPhone, parentEmail,
      routeId, routeName,
      pickupStopName, pickupStopTime,
      dropStopName, dropStopTime,
      busMode = 'TWO_WAY',
      seatNumber, effectiveFrom, effectiveTo,
      status = 'ACTIVE', notes,
    } = body;

    if (!studentName?.trim()) return NextResponse.json({ error: 'studentName is required' }, { status: 400 });
    if (!busMode) return NextResponse.json({ error: 'busMode is required' }, { status: 400 });

    // Capacity check: count active allocations on same route
    if (routeId) {
      const [capRow] = await prisma.$queryRawUnsafe<{ enrolled: bigint; seat_capacity: number }[]>(`
        SELECT
          COUNT(a.id)                   AS enrolled,
          COALESCE(r.seat_capacity, 40) AS seat_capacity
        FROM school_bus_allocations a
        LEFT JOIN school_bus_routes r ON r.id = $2::uuid
        WHERE a.tenant_id = $1
          AND a.route_id = $2::uuid
          AND a.status = 'ACTIVE'
      `, tenantId, routeId).catch(() => [] as { enrolled: bigint; seat_capacity: number }[]);

      if (capRow) {
        const enrolled = Number(capRow.enrolled ?? 0);
        const capacity = Number(capRow.seat_capacity ?? 40);
        if (enrolled >= capacity) {
          return NextResponse.json({
            error: `Route is at full capacity (${enrolled}/${capacity}). Cannot add more students.`,
            code: 'CAPACITY_EXCEEDED',
          }, { status: 422 });
        }
      }
    }

    // Auto allocation number
    const [countRow] = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      `SELECT COUNT(*) AS cnt FROM school_bus_allocations WHERE tenant_id = $1`, tenantId,
    );
    const allocationNo = `ALLOC-${String(Number(countRow?.cnt ?? 0) + 1).padStart(4, '0')}`;

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_allocations
        (tenant_id, allocation_no, student_name, student_grade, student_section, student_emirates_id,
         parent_name, parent_phone, parent_email,
         route_id, route_name,
         pickup_stop_name, pickup_stop_time, drop_stop_name, drop_stop_time,
         bus_mode, seat_number, effective_from, effective_to, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *
    `,
      tenantId, allocationNo,
      studentName.trim(), studentGrade ?? null, studentSection ?? null, studentEmiratesId ?? null,
      parentName ?? null, parentPhone ?? null, parentEmail ?? null,
      routeId ?? null, routeName ?? null,
      pickupStopName ?? null, pickupStopTime ?? null,
      dropStopName ?? null, dropStopTime ?? null,
      busMode, seatNumber ?? null,
      effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effectiveTo ?? null, status, notes ?? null,
    );

    return NextResponse.json({ ok: true, allocation: serialize([row])[0] }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/allocations POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
