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

const INBOUND_TYPES = new Set(['INBOUND', 'ADJUSTMENT_UP', 'RETURN']);
const OUTBOUND_TYPES = new Set(['OUTBOUND', 'ADJUSTMENT_DOWN', 'DISPATCH', 'CONSUMED', 'WRITE_OFF']);

function computeStatus(stock: number, threshold: number): string {
  if (stock <= 0) return 'OUT_OF_STOCK';
  if (threshold > 0 && stock <= threshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

export async function GET(req: NextRequest) {
  try {
    await ensureAssetsSchema();
    const sp = req.nextUrl.searchParams;
    const tenantId = sp.get('tenantId') ?? 'default';
    const assetId = sp.get('asset_id');
    const transactionType = sp.get('transaction_type');
    const domain = sp.get('domain');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const referenceNo = sp.get('reference_no');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['st.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (assetId) { params.push(assetId); conditions.push(`st.asset_id = $${params.length}`); }
    if (transactionType) { params.push(transactionType); conditions.push(`st.transaction_type = $${params.length}`); }
    if (domain) { params.push(domain); conditions.push(`st.domain = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`st.performed_at >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); conditions.push(`st.performed_at <= $${params.length}`); }
    if (referenceNo) { params.push(`%${referenceNo}%`); conditions.push(`st.reference_no ILIKE $${params.length}`); }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM stock_transactions st WHERE ${where}`, ...countParams),
      query(`
        SELECT st.*
        FROM stock_transactions st
        WHERE ${where}
        ORDER BY st.performed_at DESC
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

    // Get current asset
    const [asset] = await query(`
      SELECT id, name, asset_no, current_stock, reorder_threshold, unit_cost_aed, domain, warehouse_location
      FROM asset_registry
      WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
    `, body.asset_id, tenantId);

    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    const a = asset as Row;

    const qtyBefore = Number(a.current_stock ?? 0);
    const qtyChange = Number(body.quantity_change ?? 0);
    const txType = (body.transaction_type as string) ?? 'INBOUND';
    const unitCost = Number(body.unit_cost_aed ?? a.unit_cost_aed ?? 0);

    let qtyAfter: number;
    if (INBOUND_TYPES.has(txType)) {
      qtyAfter = qtyBefore + qtyChange;
    } else if (OUTBOUND_TYPES.has(txType)) {
      qtyAfter = Math.max(0, qtyBefore - qtyChange);
    } else {
      qtyAfter = qtyBefore + qtyChange;
    }

    const totalValue = qtyChange * unitCost;

    // Insert transaction
    await exec(`
      INSERT INTO stock_transactions (
        id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
        quantity_before, quantity_change, quantity_after,
        unit_cost_aed, total_value_aed,
        reference_type, reference_id, reference_no,
        from_location, to_location,
        performed_by, performed_at, domain, notes, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18,$19,NOW())
    `,
      id, tenantId, body.asset_id,
      a.name, a.asset_no, txType,
      qtyBefore, qtyChange, qtyAfter,
      unitCost, totalValue,
      body.reference_type ?? null, body.reference_id ?? null, body.reference_no ?? null,
      body.from_location ?? null, body.to_location ?? null,
      body.performed_by ?? 'system',
      body.domain ?? a.domain ?? 'GENERAL',
      body.notes ?? null,
    );

    // Update asset stock and status
    const newStatus = computeStatus(qtyAfter, Number(a.reorder_threshold ?? 0));
    await exec(`
      UPDATE asset_registry
      SET current_stock = $1, status = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
    `, qtyAfter, newStatus, body.asset_id, tenantId);

    // Log asset movement
    const mvType = INBOUND_TYPES.has(txType) ? 'INBOUND' : 'OUTBOUND';
    await exec(`
      INSERT INTO asset_movements (
        id, tenant_id, asset_id, asset_type, asset_name, asset_no,
        movement_type, from_location, to_location, quantity,
        reference_type, reference_id, reference_no,
        moved_by, moved_at, notes, created_at
      ) VALUES ($1,$2,$3,'REGISTRY',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,NOW())
    `,
      crypto.randomUUID(), tenantId, body.asset_id,
      a.name, a.asset_no, mvType,
      body.from_location ?? null, body.to_location ?? null, qtyChange,
      body.reference_type ?? null, body.reference_id ?? null, body.reference_no ?? null,
      body.performed_by ?? 'system',
      body.notes ?? null,
    );

    const [tx] = await query(`SELECT * FROM stock_transactions WHERE id = $1`, id);
    return NextResponse.json(ser([tx as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
