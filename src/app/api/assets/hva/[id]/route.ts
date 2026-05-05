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
      SELECT h.*,
        (h.calibration_due_date < NOW()) as calibration_overdue,
        (h.insurance_expiry BETWEEN NOW() AND NOW() + INTERVAL '30 days') as insurance_expiring
      FROM hva_assets h
      WHERE h.id = $1 AND h.tenant_id = $2
    `, id, tenantId);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const movements = await query(`
      SELECT * FROM asset_movements
      WHERE asset_id = $1 AND asset_type = 'HVA' AND tenant_id = $2
      ORDER BY moved_at DESC
      LIMIT 10
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

    const [current] = await query(`SELECT * FROM hva_assets WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sets: string[] = ['updated_at = $2'];
    const values: unknown[] = [id, now];

    const fields = [
      'name','description','category','serial_number','oem_part_number','manufacturer','model','year','domain',
      'purchase_date','purchase_cost_aed','current_value_aed','depreciation_method',
      'assigned_vehicle_id','assigned_entity_id','assigned_entity_type',
      'custodian_name','custodian_id','custodian_department','custody_start_date',
      'insurance_policy_no','insurance_provider','insurance_expiry','insurance_premium_aed',
      'last_calibration_date','calibration_due_date','calibration_interval_days',
      'calibration_provider','calibration_cert_no','warranty_expiry',
      'condition','ble_tag_id','location_zone','last_lat','last_lng','last_seen_at','status','notes',
    ];

    for (const f of fields) {
      if (body[f] !== undefined) {
        values.push(body[f]);
        sets.push(`${f} = $${values.length}`);
      }
    }

    values.push(id, tenantId);
    const [updated] = await query(
      `UPDATE hva_assets SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
      ...values,
    );

    const cur = current as Row;

    // Custody change movement
    const custodianChanged =
      body.custodian_id !== undefined && body.custodian_id !== cur.custodian_id;
    if (custodianChanged) {
      await exec(`
        INSERT INTO asset_movements (
          id, tenant_id, asset_id, asset_type, asset_name, asset_no,
          movement_type, from_custodian, to_custodian,
          from_location, to_location, reference_type,
          moved_by, moved_at, notes, created_at
        ) VALUES ($1,$2,$3,'HVA',$4,$5,'CUSTODY_CHANGE',$6,$7,$8,$9,'MANUAL',$10,NOW(),$11,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        cur.name, cur.asset_no,
        cur.custodian_name ?? null,
        body.custodian_name ?? null,
        cur.location_zone ?? null,
        body.location_zone ?? cur.location_zone ?? null,
        body.performed_by ?? 'system',
        `Custody transferred to ${body.custodian_name ?? 'new custodian'}`,
      );
    }

    // Calibration update movement
    const calibrationUpdated =
      body.last_calibration_date !== undefined && body.last_calibration_date !== cur.last_calibration_date;
    if (calibrationUpdated) {
      await exec(`
        INSERT INTO asset_movements (
          id, tenant_id, asset_id, asset_type, asset_name, asset_no,
          movement_type, reference_type, moved_by, moved_at, notes, created_at
        ) VALUES ($1,$2,$3,'HVA',$4,$5,'CALIBRATION_IN','MANUAL',$6,NOW(),$7,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        cur.name, cur.asset_no,
        body.performed_by ?? 'system',
        `Calibration completed. Cert: ${body.calibration_cert_no ?? 'N/A'}`,
      );
    }

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
