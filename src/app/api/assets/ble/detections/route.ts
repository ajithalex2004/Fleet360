import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';
import { ensureBleHwSchema } from '@/lib/assets/ble-hw-schema';

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
    await ensureBleHwSchema();

    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const gatewayId = sp.get('gateway_id');
    const tagMac = sp.get('tag_mac');
    const from = sp.get('from');
    const to = sp.get('to');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50')));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['d.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (gatewayId) {
      params.push(gatewayId);
      conditions.push(`d.gateway_id = $${params.length}`);
    }
    if (tagMac) {
      params.push(tagMac.toUpperCase());
      conditions.push(`UPPER(d.tag_mac) = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`d.detected_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`d.detected_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(
        `SELECT COUNT(*) as count FROM ble_detections d WHERE ${where}`,
        ...countParams,
      ),
      query(
        `SELECT d.*, g.name as gateway_name, g.location_name
         FROM ble_detections d
         LEFT JOIN ble_gateways g ON d.gateway_id = g.id::text
         WHERE ${where}
         ORDER BY d.detected_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        ...dataParams,
      ),
    ]);

    return NextResponse.json({
      detections: ser(rows as Row[]),
      total: Number(countRes[0]?.count ?? 0),
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
