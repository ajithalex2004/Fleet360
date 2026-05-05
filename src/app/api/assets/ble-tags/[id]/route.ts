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
      SELECT t.*,
        CASE
          WHEN t.last_seen_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - t.last_seen_at)) / 60
          ELSE NULL
        END::NUMERIC(10,1) as time_since_last_seen_min
      FROM ble_tags t
      WHERE t.id = $1 AND t.tenant_id = $2
    `, id, tenantId);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const movements = await query(`
      SELECT * FROM asset_movements
      WHERE asset_id = $1 AND asset_type = 'BLE_TAG' AND tenant_id = $2
      ORDER BY moved_at DESC
      LIMIT 20
    `, id, tenantId);

    return NextResponse.json({
      ...ser([row as Row])[0],
      recentMovements: ser(movements as Row[]),
    });
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

    const [current] = await query(`SELECT * FROM ble_tags WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cur = current as Row;

    if (action === 'replace') {
      // Mark this tag as replaced
      await exec(`
        UPDATE ble_tags SET
          status = 'REPLACED', replaced_at = NOW(),
          replacement_tag_id = $1, replacement_reason = $2,
          updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
      `, body.replacement_tag_id ?? null, body.replacement_reason ?? null, id, tenantId);

      // Update the assigned asset to point to the new tag
      if (cur.assigned_asset_id && cur.assigned_asset_type && body.replacement_tag_id) {
        const assetType = (cur.assigned_asset_type as string).toUpperCase();
        let table = '';
        if (assetType === 'REGISTRY') table = 'asset_registry';
        else if (assetType === 'HVA') table = 'hva_assets';
        else if (assetType === 'MEDICAL') table = 'medical_assets';

        if (table) {
          await exec(
            `UPDATE ${table} SET ble_tag_id = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            body.replacement_tag_id, cur.assigned_asset_id, tenantId,
          );
        }
      }

      // Log movement for old tag
      await exec(`
        INSERT INTO asset_movements (
          id, tenant_id, asset_id, asset_type, asset_name, asset_no,
          movement_type, reference_type, moved_by, moved_at, notes, created_at
        ) VALUES ($1,$2,$3,'BLE_TAG',$4,$5,'FOUND','MANUAL',$6,NOW(),$7,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        cur.tag_name ?? cur.tag_mac, cur.tag_mac,
        body.performed_by ?? 'system',
        `Tag replaced. Reason: ${body.replacement_reason ?? 'N/A'}`,
      );

    } else {
      // General field update
      const sets: string[] = ['updated_at = $2'];
      const values: unknown[] = [id, now];

      const fields = [
        'tag_name','assigned_asset_id','assigned_asset_type','assigned_asset_name',
        'battery_pct','signal_rssi','last_seen_at','last_gateway_id',
        'last_location_zone','last_lat','last_lng','firmware_version','status','notes',
      ];

      for (const f of fields) {
        if (body[f] !== undefined) {
          values.push(body[f]);
          sets.push(`${f} = $${values.length}`);
        }
      }

      values.push(id, tenantId);
      await exec(
        `UPDATE ble_tags SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        ...values,
      );
    }

    const [updated] = await query(`
      SELECT t.*,
        CASE WHEN t.last_seen_at IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - t.last_seen_at)) / 60 ELSE NULL END::NUMERIC(10,1) as time_since_last_seen_min
      FROM ble_tags t WHERE t.id = $1 AND t.tenant_id = $2
    `, id, tenantId);

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
