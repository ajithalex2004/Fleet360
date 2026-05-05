import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureHosSchema } from '@/lib/fleet/hos-schema';

type Row = Record<string, unknown>;

const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_, val) =>
      typeof val === 'bigint'
        ? Number(val)
        : val instanceof Date
          ? val.toISOString()
          : val,
    ),
  );
}

export async function GET(req: NextRequest) {
  await ensureHosSchema();
  try {
    const sp = req.nextUrl.searchParams;
    const driverId = sp.get('driver_id');
    const severity = sp.get('severity');
    const status = sp.get('status');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10), 200);
    const offset = parseInt(sp.get('offset') ?? '0', 10);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (driverId) {
      params.push(driverId);
      conditions.push(`driver_id = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      conditions.push(`severity = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      conditions.push(`occurred_at >= $${params.length}::TIMESTAMPTZ`);
    }
    if (dateTo) {
      params.push(dateTo);
      conditions.push(`occurred_at <= $${params.length}::TIMESTAMPTZ`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    params.push(limit, offset);

    const [countRows, rows] = await Promise.all([
      query<{ count: bigint }>(
        `SELECT COUNT(*) AS count FROM hos_violations ${where}`,
        ...countParams,
      ),
      query<Row>(
        `SELECT *
         FROM hos_violations
         ${where}
         ORDER BY occurred_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        ...params,
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    return NextResponse.json(
      ser({
        data: rows,
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      }),
    );
  } catch (error) {
    console.error('Error fetching HoS violations:', error);
    return NextResponse.json({ error: 'Failed to fetch HoS violations' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  await ensureHosSchema();
  try {
    const body = await req.json() as { ids?: string[]; status?: string };

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    const allowedStatuses = ['ACKNOWLEDGED', 'RESOLVED'];
    if (!body.status || !allowedStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${allowedStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const ids = body.ids;

    // Build $1, $2, ... placeholders for the IN clause
    const idPlaceholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    let timestampField = '';
    let extraParam: unknown[] = [];

    if (body.status === 'ACKNOWLEDGED') {
      timestampField = `, acknowledged_at = $${ids.length + 1}`;
      extraParam = [now];
    } else if (body.status === 'RESOLVED') {
      timestampField = `, resolved_at = $${ids.length + 1}, acknowledged_at = COALESCE(acknowledged_at, $${ids.length + 1})`;
      extraParam = [now];
    }

    const statusParam = `$${ids.length + 1 + extraParam.length}`;
    const allParams: unknown[] = [...ids, ...extraParam, body.status];

    const updated = await query<Row>(
      `UPDATE hos_violations
       SET status = ${statusParam}${timestampField}
       WHERE id IN (${idPlaceholders})
       RETURNING *`,
      ...allParams,
    );

    return NextResponse.json(
      ser({ updated: updated.length, records: updated }),
    );
  } catch (error) {
    console.error('Error updating HoS violations:', error);
    return NextResponse.json({ error: 'Failed to update HoS violations' }, { status: 500 });
  }
}
