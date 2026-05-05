/**
 * GET  /api/school-bus/stops          — list stops (filterable by emirate/city/area/active)
 * POST /api/school-bus/stops          — create stop (auto-generates stop_code)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

async function ensureTable() {
  const exec = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});

  await exec(`
    CREATE TABLE IF NOT EXISTS school_bus_stops (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        TEXT        NOT NULL DEFAULT 'default',
      stop_code        TEXT        NOT NULL,
      stop_name        TEXT        NOT NULL,
      emirate          TEXT        NOT NULL DEFAULT 'Dubai',
      city             TEXT,
      area             TEXT,
      neighbourhood    TEXT,
      landmark         TEXT,
      lat              DECIMAL(10,8),
      lng              DECIMAL(11,8),
      geofence_radius_m INT        NOT NULL DEFAULT 100,
      route_ids        JSONB       NOT NULL DEFAULT '[]',
      is_active        BOOLEAN     NOT NULL DEFAULT true,
      notes            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sbs_code ON school_bus_stops(stop_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbs_tenant ON school_bus_stops(tenant_id, is_active)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sbs_emirate ON school_bus_stops(emirate, city, area)`);
}

export async function GET(req: NextRequest) {
  try {
    await ensureTable();

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

    const rows = await prisma.$queryRawUnsafe<Row[]>(`
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
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();

    const body = await req.json();
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
    const [countRow] = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
      `SELECT COUNT(*) AS cnt FROM school_bus_stops WHERE stop_code LIKE $1`,
      `${prefix}%`,
    );
    const seq = String(Number(countRow?.cnt ?? 0) + 1).padStart(3, '0');
    const stopCode = `${prefix}-${seq}`;

    const [row] = await prisma.$queryRawUnsafe<Row[]>(`
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
}
