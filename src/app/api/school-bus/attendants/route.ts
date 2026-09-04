export const dynamic = 'force-dynamic';

/**
 * GET  /api/school-bus/attendants   — list bus attendants (nannies)
 * POST /api/school-bus/attendants   — register new attendant
 *
 * UAE regulatory requirement: every school bus must have a female attendant (nanny).
 * This registry manages their personal details, certifications and route assignments.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
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

        const rows = await tx.$queryRawUnsafe<Row[]>(`
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
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
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
        const [countRow] = await tx.$queryRawUnsafe<{ cnt: bigint }[]>(
          `SELECT COUNT(*) AS cnt FROM school_bus_attendants WHERE tenant_id = $1`, tenantId,
        );
        const employeeId = `ATT-${String(Number(countRow?.cnt ?? 0) + 1).padStart(4, '0')}`;

        const [row] = await tx.$queryRawUnsafe<Row[]>(`
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
  });
}

