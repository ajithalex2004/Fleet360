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
    const domain = sp.get('domain');
    const isRestricted = sp.get('is_restricted');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['m.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) { params.push(status); conditions.push(`m.status = $${params.length}`); }
    if (domain) { params.push(domain); conditions.push(`m.domain = $${params.length}`); }
    if (isRestricted !== null && isRestricted !== undefined) {
      params.push(isRestricted === 'true');
      conditions.push(`m.is_restricted = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(m.name ILIKE $${params.length} OR m.asset_no ILIKE $${params.length} OR m.batch_number ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM medical_assets m WHERE ${where}`, ...countParams),
      query(`
        SELECT m.*,
          CASE
            WHEN m.expiry_date IS NOT NULL
            THEN EXTRACT(DAY FROM (m.expiry_date::TIMESTAMPTZ - NOW()))::INT
            ELSE NULL
          END as days_until_expiry
        FROM medical_assets m
        WHERE ${where}
        ORDER BY m.expiry_date ASC NULLS LAST, m.created_at DESC
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

    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM medical_assets WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const assetNo = body.asset_no ?? `MED-${String(seq).padStart(4, '0')}`;

    const [row] = await query(`
      INSERT INTO medical_assets (
        id, tenant_id, asset_no, registry_id, name, category, asset_type,
        is_restricted, controlled_substance_level,
        batch_number, lot_number, manufacture_date, expiry_date,
        quantity, unit, unit_cost_aed, storage_requirement, storage_location,
        current_seal_no, domain, assigned_vehicle_id,
        status, notes, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      ) RETURNING *
    `,
      id, tenantId, assetNo,
      body.registry_id ?? null, body.name, body.category ?? null,
      body.asset_type ?? 'SUPPLY',
      body.is_restricted ?? false, body.controlled_substance_level ?? null,
      body.batch_number ?? null, body.lot_number ?? null,
      body.manufacture_date ?? null, body.expiry_date ?? null,
      body.quantity ?? 0, body.unit ?? 'UNIT', body.unit_cost_aed ?? 0,
      body.storage_requirement ?? null, body.storage_location ?? null,
      body.current_seal_no ?? null,
      body.domain ?? 'AMBULANCE', body.assigned_vehicle_id ?? null,
      body.status ?? 'ACTIVE', body.notes ?? null, now, now,
    );

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
