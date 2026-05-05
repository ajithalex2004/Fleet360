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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureAssetsSchema();
    const { id } = params;
    const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'default';

    const [row] = await query(`
      SELECT g.*,
        CASE
          WHEN g.last_heartbeat IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - g.last_heartbeat)) / 60
          ELSE NULL
        END::NUMERIC(10,1) as minutes_since_heartbeat
      FROM ble_gateways g
      WHERE g.id = $1 AND g.tenant_id = $2
    `, id, tenantId);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(ser([row as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureAssetsSchema();
    const { id } = params;
    const body = await req.json();
    const tenantId = body.tenantId ?? body.tenant_id ?? 'default';
    const now = new Date().toISOString();
    const action = body.action as string | undefined;

    const [current] = await query(`SELECT * FROM ble_gateways WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'heartbeat') {
      await exec(`
        UPDATE ble_gateways SET
          last_heartbeat = NOW(),
          tags_visible = $1,
          status = 'ONLINE',
          updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
      `, body.tags_visible ?? (current as Row).tags_visible ?? 0, id, tenantId);

    } else if (action === 'offline') {
      await exec(`
        UPDATE ble_gateways SET status = 'OFFLINE', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, id, tenantId);

    } else {
      // General field update
      const sets: string[] = ['updated_at = $2'];
      const values: unknown[] = [id, now];

      const fields = [
        'name','description','location_type','vehicle_id','location_name',
        'location_zone','lat','lng','ip_address','firmware_version',
        'tags_visible','last_heartbeat','status',
        'alert_on_offline','offline_threshold_min','notes',
      ];

      for (const f of fields) {
        if (body[f] !== undefined) {
          values.push(body[f]);
          sets.push(`${f} = $${values.length}`);
        }
      }

      values.push(id, tenantId);
      await exec(
        `UPDATE ble_gateways SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        ...values,
      );
    }

    const [updated] = await query(`
      SELECT g.*,
        CASE WHEN g.last_heartbeat IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - g.last_heartbeat)) / 60 ELSE NULL END::NUMERIC(10,1) as minutes_since_heartbeat
      FROM ble_gateways g WHERE g.id = $1 AND g.tenant_id = $2
    `, id, tenantId);

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
