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
    const categoryId = sp.get('category_id');
    const status = sp.get('status');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['ar.tenant_id = $1', 'ar.is_active = TRUE'];
    const params: unknown[] = [tenantId];

    if (domain) { params.push(domain); conditions.push(`ar.domain = $${params.length}`); }
    if (categoryId) { params.push(categoryId); conditions.push(`ar.category_id = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`ar.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(ar.name ILIKE $${params.length} OR ar.asset_no ILIKE $${params.length} OR ar.manufacturer ILIKE $${params.length})`); }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_registry ar WHERE ${where}`, ...countParams),
      query(`
        SELECT ar.*,
               ac.name as category_name,
               ac.icon as category_icon,
               ac.color as category_color
        FROM asset_registry ar
        LEFT JOIN asset_categories ac ON ac.id = ar.category_id
        WHERE ${where}
        ORDER BY ar.created_at DESC
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

    // Auto-generate asset_no
    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM asset_registry WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const assetNo = body.asset_no ?? `AST-${String(seq).padStart(6, '0')}`;

    const [row] = await query(`
      INSERT INTO asset_registry (
        id, tenant_id, asset_no, name, description, category_id, subcategory,
        domain, asset_type, oem_part_number, manufacturer, model, unit_of_measure,
        current_stock, allocated_stock, reorder_threshold, reorder_quantity,
        unit_cost_aed, warehouse_location, bin_location,
        is_serialized, is_restricted, requires_calibration, is_ble_tracked, ble_tag_id,
        notes, status, is_active, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
        $26,$27,$28,$29,$30
      ) RETURNING *
    `,
      id, tenantId, assetNo,
      body.name, body.description ?? null,
      body.category_id ?? null, body.subcategory ?? null,
      body.domain ?? 'GENERAL', body.asset_type ?? 'CONSUMABLE',
      body.oem_part_number ?? null, body.manufacturer ?? null, body.model ?? null,
      body.unit_of_measure ?? 'UNIT',
      body.current_stock ?? 0, body.allocated_stock ?? 0,
      body.reorder_threshold ?? 0, body.reorder_quantity ?? 0,
      body.unit_cost_aed ?? 0,
      body.warehouse_location ?? null, body.bin_location ?? null,
      body.is_serialized ?? false, body.is_restricted ?? false,
      body.requires_calibration ?? false, body.is_ble_tracked ?? false,
      body.ble_tag_id ?? null, body.notes ?? null,
      body.status ?? 'IN_STOCK', true, now, now,
    );

    const initialStock = Number(body.current_stock ?? 0);

    if (initialStock > 0) {
      const txId = crypto.randomUUID();
      await exec(`
        INSERT INTO stock_transactions (
          id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
          quantity_before, quantity_change, quantity_after,
          unit_cost_aed, total_value_aed, reference_type,
          performed_by, performed_at, domain, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,'INBOUND',0,$6,$7,$8,$9,'MANUAL',$10,NOW(),$11,'Initial stock',NOW())
      `,
        txId, tenantId, id, body.name, assetNo,
        initialStock, initialStock,
        body.unit_cost_aed ?? 0,
        initialStock * Number(body.unit_cost_aed ?? 0),
        body.performed_by ?? 'system',
        body.domain ?? 'GENERAL',
      );

      await exec(`
        INSERT INTO asset_movements (
          id, tenant_id, asset_id, asset_type, asset_name, asset_no,
          movement_type, to_location, quantity, reference_type,
          moved_by, moved_at, notes, created_at
        ) VALUES ($1,$2,$3,'REGISTRY',$4,$5,'INBOUND',$6,$7,'MANUAL',$8,NOW(),'Initial stock inbound',NOW())
      `,
        crypto.randomUUID(), tenantId, id, body.name, assetNo,
        body.warehouse_location ?? null,
        initialStock,
        body.performed_by ?? 'system',
      );
    }

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
