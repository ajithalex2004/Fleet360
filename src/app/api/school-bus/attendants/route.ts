/**
 * GET  /api/school-bus/attendants   — list bus attendants (nannies)
 * POST /api/school-bus/attendants   — register new attendant
 *
 * UAE regulatory requirement: every school bus must have a female attendant (nanny).
 * This registry manages their personal details, certifications and route assignments.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return out;
  });
}

async function ensureTable() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_attendants (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT        NOT NULL DEFAULT 'default',
      employee_id         TEXT        NOT NULL,
      first_name          TEXT        NOT NULL,
      last_name           TEXT        NOT NULL,
      gender              TEXT        NOT NULL DEFAULT 'Female',
      nationality         TEXT,
      phone               TEXT,
      email               TEXT,
      emirates_id         TEXT,
      emirates_id_expiry  DATE,
      certification_no    TEXT,
      certification_expiry DATE,
      photo_url           TEXT,
      route_id            UUID,
      route_name          TEXT,
      assigned_vehicle_id TEXT,
      status              TEXT        NOT NULL DEFAULT 'ACTIVE',
      joining_date        DATE,
      notes               TEXT,
      is_active           BOOLEAN     NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sba_emp_id ON school_bus_attendants(employee_id, tenant_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_tenant ON school_bus_attendants(tenant_id, is_active)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sba_route ON school_bus_attendants(route_id)`);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();

    const sp       = new URL(req.url).searchParams;
    const tenantId = sp.get('tenantId') ?? '';
    const status   = sp.get('status')   ?? '';
    const search   = sp.get('search')   ?? '';
    const routeId  = sp.get('routeId')  ?? '';

    const conds: string[] = [];
    const vals:  unknown[] = [];
    const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

    if (tenantId) add('tenant_id', tenantId);
    if (status)   add('status',    status);
    if (routeId)  add('route_id',  routeId);
    conds.push('is_active = true');
    if (search) {
      vals.push(`%${search}%`);
      conds.push(`(first_name ILIKE $${vals.length} OR last_name ILIKE $${vals.length} OR employee_id ILIKE $${vals.length} OR phone ILIKE $${vals.length})`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
      SELECT * FROM school_bus_attendants
      ${where}
      ORDER BY first_name, last_name
    `, ...vals);

    // Flag attendants with expiring certifications (within 30 days)
    const data = serialize(rows).map(r => ({
      ...r,
      cert_expiring_soon: r.certification_expiry
        ? new Date(r.certification_expiry as string) < new Date(Date.now() + 30 * 86400 * 1000)
        : false,
      eid_expiring_soon: r.emirates_id_expiry
        ? new Date(r.emirates_id_expiry as string) < new Date(Date.now() + 30 * 86400 * 1000)
        : false,
    }));

    return NextResponse.json({ data, total: data.length });
  } catch (err) {
    console.error('[school-bus/attendants GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
    const {
      tenantId = 'default', firstName, lastName, gender = 'Female',
      nationality, phone, email, emiratesId, emiratesIdExpiry,
      certificationNo, certificationExpiry, routeId, routeName,
      assignedVehicleId, joiningDate, notes,
    } = body;

    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json({ error: 'firstName and lastName are required' }, { status: 400 });
    }

    // Auto-generate employee ID
    const [countRow] = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      `SELECT COUNT(*) AS cnt FROM school_bus_attendants WHERE tenant_id = $1`, tenantId,
    );
    const employeeId = `ATT-${String(Number(countRow?.cnt ?? 0) + 1).padStart(4, '0')}`;

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
      INSERT INTO school_bus_attendants
        (tenant_id, employee_id, first_name, last_name, gender, nationality, phone, email,
         emirates_id, emirates_id_expiry, certification_no, certification_expiry,
         route_id, route_name, assigned_vehicle_id, joining_date, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *
    `,
      tenantId, employeeId, firstName.trim(), lastName.trim(), gender,
      nationality ?? null, phone ?? null, email ?? null,
      emiratesId ?? null, emiratesIdExpiry ?? null,
      certificationNo ?? null, certificationExpiry ?? null,
      routeId ?? null, routeName ?? null, assignedVehicleId ?? null,
      joiningDate ?? null, notes ?? null,
    );

    return NextResponse.json({ ok: true, attendant: serialize([row])[0] }, { status: 201 });
  } catch (err) {
    console.error('[school-bus/attendants POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
