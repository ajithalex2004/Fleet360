import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';
import { ensureBleHwSchema } from '@/lib/assets/ble-hw-schema';

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
    await ensureBleHwSchema();

    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const status = sp.get('status');
    const severity = sp.get('severity');
    const from = sp.get('from');
    const to = sp.get('to');
    const tagMac = sp.get('tag_mac');

    const conditions: string[] = ['a.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      conditions.push(`a.severity = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`a.detected_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`a.detected_at <= $${params.length}`);
    }
    if (tagMac) {
      params.push(tagMac.toUpperCase());
      conditions.push(`UPPER(a.tag_mac) = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const rows = await query(
      `SELECT a.*,
         g1.name as from_gateway_name,
         g2.name as to_gateway_name
       FROM ble_movement_alerts a
       LEFT JOIN ble_gateways g1 ON a.from_gateway_id = g1.id::text
       LEFT JOIN ble_gateways g2 ON a.to_gateway_id = g2.id::text
       WHERE ${where}
       ORDER BY a.detected_at DESC
       LIMIT 100`,
      ...params,
    );

    return NextResponse.json({ alerts: ser(rows as Row[]) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    await ensureBleHwSchema();

    const body = await req.json();
    const tenantId = body.tenant_id ?? 'default';
    const { id, status, acknowledged_by, resolution_notes } = body as {
      id: string;
      status: string;
      acknowledged_by?: string;
      resolution_notes?: string;
    };

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const [existing] = await query(
      `SELECT id FROM ble_movement_alerts WHERE id::text = $1 AND tenant_id = $2`,
      id,
      tenantId,
    );
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];

    if (status) {
      vals.push(status);
      sets.push(`status = $${vals.length}`);

      if (status === 'ACKNOWLEDGED') {
        sets.push(`acknowledged_at = NOW()`);
        if (acknowledged_by) {
          vals.push(acknowledged_by);
          sets.push(`acknowledged_by = $${vals.length}`);
        }
      }
    }

    if (resolution_notes !== undefined) {
      vals.push(resolution_notes);
      sets.push(`resolution_notes = $${vals.length}`);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    vals.push(id, tenantId);
    await exec(
      `UPDATE ble_movement_alerts SET ${sets.join(', ')}
       WHERE id::text = $${vals.length - 1} AND tenant_id = $${vals.length}`,
      ...vals,
    );

    const [updated] = await query(
      `SELECT a.*,
         g1.name as from_gateway_name,
         g2.name as to_gateway_name
       FROM ble_movement_alerts a
       LEFT JOIN ble_gateways g1 ON a.from_gateway_id = g1.id::text
       LEFT JOIN ble_gateways g2 ON a.to_gateway_id = g2.id::text
       WHERE a.id::text = $1 AND a.tenant_id = $2`,
      id,
      tenantId,
    );

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
