export const dynamic = 'force-dynamic';

/**
 * GET  /api/school-bus/stops          — list stops (filterable by emirate/city/area/active)
 * POST /api/school-bus/stops          — create stop (auto-generates stop_code)
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
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
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
        const sp         = new URL(req.url).searchParams;
        const tenantId   = sp.get('tenantId')  ?? '';
        const emirate    = sp.get('emirate')   ?? '';
        const city       = sp.get('city')      ?? '';
        const area       = sp.get('area')      ?? '';
        const activeOnly = sp.get('active')    !== 'false';
        const search     = sp.get('search')    ?? '';

        const conds: string[] = [];
        const vals:  unknown[] = [];
        const add = (c: string, v: unknown) => { vals.push(v); conds.push(`${c} = $${vals.length}`); };

        if (tenantId) add('tenant_id', tenantId);
        if (emirate)  add('emirate',   emirate);
        if (city)     add('city',      city);
        if (area)     add('area',      area);
        if (activeOnly) conds.push('is_active = true');
        if (search) {
          vals.push(`%${search}%`);
          conds.push(`(stop_name ILIKE $${vals.length} OR stop_code ILIKE $${vals.length} OR landmark ILIKE $${vals.length})`);
        }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        const rows = await tx.$queryRawUnsafe<Row[]>(`
          SELECT * FROM school_bus_stops
          ${where}
          ORDER BY emirate, city, area, stop_name
          LIMIT 500
        `, ...vals);

        return NextResponse.json({ data: serialize(rows), total: rows.length });
        } catch (err) {
        console.error('[school-bus/stops GET]', err);
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
          tenantId = 'default', stopName, emirate = 'Dubai', city, area, neighbourhood,
          landmark, lat, lng, geofenceRadiusM = 100, notes,
        } = body;

        if (!stopName?.trim()) {
          return NextResponse.json({ error: 'stopName is required' }, { status: 400 });
        }

        // Auto-generate stop code: e.g. DXB-MARINA-001
        const prefix = [
          emirate === 'Dubai' ? 'DXB' : emirate === 'Abu Dhabi' ? 'AUH' : emirate === 'Sharjah' ? 'SHJ' : emirate.slice(0,3).toUpperCase(),
          (area ?? city ?? 'AREA').replace(/\s+/g, '').toUpperCase().slice(0, 6),
        ].join('-');

        // Find next sequence for this prefix
        const [countRow] = await tx.$queryRawUnsafe<{ cnt: bigint }[]>(
          `SELECT COUNT(*) AS cnt FROM school_bus_stops WHERE stop_code LIKE $1`,
          `${prefix}%`,
        );
        const seq = String(Number(countRow?.cnt ?? 0) + 1).padStart(3, '0');
        const stopCode = `${prefix}-${seq}`;

        const [row] = await tx.$queryRawUnsafe<Row[]>(`
          INSERT INTO school_bus_stops
            (tenant_id, stop_code, stop_name, emirate, city, area, neighbourhood, landmark, lat, lng, geofence_radius_m, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          RETURNING *
        `,
          tenantId, stopCode, stopName.trim(), emirate,
          city ?? null, area ?? null, neighbourhood ?? null, landmark ?? null,
          lat != null ? Number(lat) : null, lng != null ? Number(lng) : null,
          Number(geofenceRadiusM), notes ?? null,
        );

        return NextResponse.json({ ok: true, stop: serialize([row])[0] }, { status: 201 });
        } catch (err) {
        console.error('[school-bus/stops POST]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}

