import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);
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
    const assetType = sp.get('assigned_asset_type');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['t.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
    if (assetType) { params.push(assetType); conditions.push(`t.assigned_asset_type = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.tag_mac ILIKE $${params.length} OR t.tag_name ILIKE $${params.length} OR t.assigned_asset_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ble_tags t WHERE ${where}`, ...countParams),
      query(`
        SELECT t.*,
          CASE
            WHEN t.last_seen_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (NOW() - t.last_seen_at)) / 60
            ELSE NULL
          END::NUMERIC(10,1) as time_since_last_seen_min
        FROM ble_tags t
        WHERE ${where}
        ORDER BY t.last_seen_at DESC NULLS LAST, t.created_at DESC
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

    const [row] = await query(`
      INSERT INTO ble_tags (
        id, tenant_id, tag_mac, tag_name,
        assigned_asset_id, assigned_asset_type, assigned_asset_name,
        battery_pct, signal_rssi, last_seen_at, last_gateway_id,
        last_location_zone, last_lat, last_lng,
        firmware_version, status, notes, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      ) RETURNING *
    `,
      id, tenantId,
      body.tag_mac, body.tag_name ?? null,
      body.assigned_asset_id ?? null, body.assigned_asset_type ?? null, body.assigned_asset_name ?? null,
      body.battery_pct ?? 100, body.signal_rssi ?? null,
      body.last_seen_at ?? null, body.last_gateway_id ?? null,
      body.last_location_zone ?? null, body.last_lat ?? null, body.last_lng ?? null,
      body.firmware_version ?? null,
      body.status ?? 'ACTIVE', body.notes ?? null, now, now,
    );

    // Update assigned asset's ble_tag_id if provided
    if (body.assigned_asset_id && body.assigned_asset_type) {
      const assetType = (body.assigned_asset_type as string).toUpperCase();
      let table = '';
      if (assetType === 'REGISTRY') table = 'asset_registry';
      else if (assetType === 'HVA') table = 'hva_assets';
      else if (assetType === 'MEDICAL') table = 'medical_assets';

      if (table) {
        await exec(
          `UPDATE ${table} SET ble_tag_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          id, body.assigned_asset_id, tenantId,
        );
      }
    }

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
