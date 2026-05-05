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
    const assetId = sp.get('asset_id');
    const assetType = sp.get('asset_type');
    const movementType = sp.get('movement_type');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const timeline = sp.get('timeline') === 'true';
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(500, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['m.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (assetId) { params.push(assetId); conditions.push(`m.asset_id = $${params.length}`); }
    if (assetType) { params.push(assetType); conditions.push(`m.asset_type = $${params.length}`); }
    if (movementType) { params.push(movementType); conditions.push(`m.movement_type = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`m.moved_at >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); conditions.push(`m.moved_at <= $${params.length}`); }

    const where = conditions.join(' AND ');

    if (timeline) {
      // Group by date for timeline view
      const rows = await query(`
        SELECT
          DATE(m.moved_at) as date,
          COUNT(*) as movement_count,
          json_agg(
            json_build_object(
              'id', m.id,
              'asset_id', m.asset_id,
              'asset_type', m.asset_type,
              'asset_name', m.asset_name,
              'asset_no', m.asset_no,
              'movement_type', m.movement_type,
              'from_location', m.from_location,
              'to_location', m.to_location,
              'quantity', m.quantity,
              'moved_by', m.moved_by,
              'moved_at', m.moved_at,
              'notes', m.notes
            ) ORDER BY m.moved_at DESC
          ) as movements
        FROM asset_movements m
        WHERE ${where}
        GROUP BY DATE(m.moved_at)
        ORDER BY date DESC
        LIMIT 90
      `, ...params);

      return NextResponse.json({ timeline: ser(rows as Row[]) });
    }

    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_movements m WHERE ${where}`, ...countParams),
      query(`
        SELECT m.*
        FROM asset_movements m
        WHERE ${where}
        ORDER BY m.moved_at DESC
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
