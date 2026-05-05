import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
function ser(rows: Row[]): Row[] {
  return rows.map(r => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v;
    }
    return o;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const status = sp.get('status');
    const locationType = sp.get('location_type');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['g.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) { params.push(status); conditions.push(`g.status = $${params.length}`); }
    if (locationType) { params.push(locationType); conditions.push(`g.location_type = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(g.name ILIKE $${params.length} OR g.gateway_code ILIKE $${params.length} OR g.location_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_gateways g WHERE ${where}`, ...countParams),
      query(`
        SELECT g.*,
          CASE
            WHEN g.last_heartbeat IS NOT NULL
            THEN EXTRACT(EPOCH FROM (NOW() - g.last_heartbeat)) / 60
            ELSE NULL
          END::NUMERIC(10,1) as minutes_since_heartbeat
        FROM ble_gateways g
        WHERE ${where}
        ORDER BY g.last_heartbeat DESC NULLS LAST, g.created_at DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `, ...dataParams),
    ]);

    return NextResponse.json({
      data: ser(rows as Row[]),
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    const body = await req.json();
    const tenantId = body.tenantId ?? body.tenant_id ?? 'default';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_gateways WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const gatewayCode = body.gateway_code ?? `GW-${String(seq).padStart(4, '0')}`;

    const [row] = await query(`
      INSERT INTO ble_gateways (
        id, tenant_id, gateway_code, name, description,
        location_type, vehicle_id, location_name, location_zone,
        lat, lng, ip_address, firmware_version,
        tags_visible, last_heartbeat, status,
        alert_on_offline, offline_threshold_min,
        notes, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      ) RETURNING *
    `,
      id, tenantId, gatewayCode,
      body.name, body.description ?? null,
      body.location_type ?? 'DEPOT', body.vehicle_id ?? null,
      body.location_name, body.location_zone ?? null,
      body.lat ?? null, body.lng ?? null,
      body.ip_address ?? null, body.firmware_version ?? null,
      body.tags_visible ?? 0, body.last_heartbeat ?? null,
      body.status ?? 'ONLINE',
      body.alert_on_offline ?? true, body.offline_threshold_min ?? 15,
      body.notes ?? null, now, now,
    );

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
