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
    const domain = sp.get('domain');
    const status = sp.get('status');
    const condition = sp.get('condition');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['h.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (domain) { params.push(domain); conditions.push(`h.domain = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`h.status = $${params.length}`); }
    if (condition) { params.push(condition); conditions.push(`h.condition = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(h.name ILIKE $${params.length} OR h.asset_no ILIKE $${params.length} OR h.serial_number ILIKE $${params.length} OR h.manufacturer ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM hva_assets h WHERE ${where}`, ...countParams),
      query(`
        SELECT h.*,
          (h.calibration_due_date < NOW()) as calibration_overdue,
          (h.insurance_expiry BETWEEN NOW() AND NOW() + INTERVAL '30 days') as insurance_expiring
        FROM hva_assets h
        WHERE ${where}
        ORDER BY h.created_at DESC
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

    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM hva_assets WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const assetNo = body.asset_no ?? `HVA-${String(seq).padStart(4, '0')}`;

    const [row] = await query(`
      INSERT INTO hva_assets (
        id, tenant_id, asset_no, registry_id, name, description, category,
        serial_number, oem_part_number, manufacturer, model, year, domain,
        purchase_date, purchase_cost_aed, current_value_aed, depreciation_method,
        assigned_vehicle_id, assigned_entity_id, assigned_entity_type,
        custodian_name, custodian_id, custodian_department, custody_start_date,
        insurance_policy_no, insurance_provider, insurance_expiry, insurance_premium_aed,
        last_calibration_date, calibration_due_date, calibration_interval_days,
        calibration_provider, calibration_cert_no, warranty_expiry,
        condition, ble_tag_id, location_zone, last_lat, last_lng,
        status, notes, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
        $35,$36,$37,$38,$39,$40,$41,$42,$43
      ) RETURNING *
    `,
      id, tenantId, assetNo,
      body.registry_id ?? null, body.name, body.description ?? null, body.category ?? null,
      body.serial_number ?? null, body.oem_part_number ?? null, body.manufacturer ?? null,
      body.model ?? null, body.year ?? null, body.domain ?? 'GENERAL',
      body.purchase_date ?? null, body.purchase_cost_aed ?? 0, body.current_value_aed ?? 0,
      body.depreciation_method ?? 'STRAIGHT_LINE',
      body.assigned_vehicle_id ?? null, body.assigned_entity_id ?? null, body.assigned_entity_type ?? null,
      body.custodian_name ?? null, body.custodian_id ?? null, body.custodian_department ?? null,
      body.custody_start_date ?? null,
      body.insurance_policy_no ?? null, body.insurance_provider ?? null,
      body.insurance_expiry ?? null, body.insurance_premium_aed ?? null,
      body.last_calibration_date ?? null, body.calibration_due_date ?? null,
      body.calibration_interval_days ?? 365,
      body.calibration_provider ?? null, body.calibration_cert_no ?? null,
      body.warranty_expiry ?? null,
      body.condition ?? 'GOOD', body.ble_tag_id ?? null, body.location_zone ?? null,
      body.last_lat ?? null, body.last_lng ?? null,
      body.status ?? 'ACTIVE', body.notes ?? null, now, now,
    );

    // Log INBOUND movement
    await exec(`
      INSERT INTO asset_movements (
        id, tenant_id, asset_id, asset_type, asset_name, asset_no,
        movement_type, to_location, to_custodian, reference_type,
        moved_by, moved_at, notes, created_at
      ) VALUES ($1,$2,$3,'HVA',$4,$5,'INBOUND',$6,$7,'MANUAL',$8,NOW(),'HVA registered',NOW())
    `,
      crypto.randomUUID(), tenantId, id,
      body.name, assetNo,
      body.location_zone ?? null, body.custodian_name ?? null,
      body.performed_by ?? 'system',
    );

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
