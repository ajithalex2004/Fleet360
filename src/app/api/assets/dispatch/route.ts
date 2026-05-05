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
    const status = sp.get('status');
    const technicianId = sp.get('technician_id');
    const domain = sp.get('domain');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['d.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) { params.push(status); conditions.push(`d.status = $${params.length}`); }
    if (technicianId) { params.push(technicianId); conditions.push(`d.technician_id = $${params.length}`); }
    if (domain) { params.push(domain); conditions.push(`d.domain = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(d.dispatch_no ILIKE $${params.length} OR d.technician_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM field_dispatch d WHERE ${where}`, ...countParams),
      query(`
        SELECT d.*,
          (SELECT COUNT(*) FROM field_dispatch_items fdi WHERE fdi.dispatch_id = d.id) as item_count
        FROM field_dispatch d
        WHERE ${where}
        ORDER BY d.created_at DESC
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

    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM field_dispatch WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const dispatchNo = body.dispatch_no ?? `DSP-${String(seq).padStart(4, '0')}`;

    const [dispatch] = await query(`
      INSERT INTO field_dispatch (
        id, tenant_id, dispatch_no, from_warehouse,
        technician_id, technician_name, technician_phone,
        status, dispatched_by, dispatched_at,
        work_order_no, domain, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'DISPATCHED',$8,NOW(),$9,$10,$11,$12,$13)
      RETURNING *
    `,
      id, tenantId, dispatchNo, body.from_warehouse,
      body.technician_id ?? null, body.technician_name,
      body.technician_phone ?? null,
      body.dispatched_by ?? 'system',
      body.work_order_no ?? null,
      body.domain ?? 'GENERAL',
      body.notes ?? null, now, now,
    );

    const items: Row[] = body.items ?? [];
    for (const item of items) {
      const itemId = crypto.randomUUID();
      const qtyDispatched = Number(item.quantity_dispatched ?? 0);

      // Get asset details
      const [asset] = await query(`
        SELECT id, name, asset_no, current_stock, reorder_threshold, unit_cost_aed, domain
        FROM asset_registry WHERE id = $1 AND tenant_id = $2
      `, item.asset_id, tenantId);

      if (!asset) continue;
      const a = asset as Row;
      const qtyBefore = Number(a.current_stock ?? 0);
      const qtyAfter = Math.max(0, qtyBefore - qtyDispatched);

      await exec(`
        INSERT INTO field_dispatch_items (
          id, dispatch_id, tenant_id, asset_id, asset_name, asset_no,
          quantity_dispatched, quantity_accepted, quantity_consumed, quantity_returned,
          unit_cost_aed, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,$8,$9)
      `,
        itemId, id, tenantId, item.asset_id,
        a.name, a.asset_no, qtyDispatched,
        item.unit_cost_aed ?? a.unit_cost_aed ?? 0,
        item.notes ?? null,
      );

      // Stock transaction DISPATCH
      const txId = crypto.randomUUID();
      await exec(`
        INSERT INTO stock_transactions (
          id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
          quantity_before, quantity_change, quantity_after,
          unit_cost_aed, total_value_aed,
          reference_type, reference_id, reference_no,
          from_location, to_location,
          performed_by, performed_at, domain, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,'DISPATCH',$6,$7,$8,$9,$10,'DISPATCH',$11,$12,$13,$14,$15,NOW(),$16,$17,NOW())
      `,
        txId, tenantId, item.asset_id,
        a.name, a.asset_no,
        qtyBefore, qtyDispatched, qtyAfter,
        Number(a.unit_cost_aed ?? 0),
        qtyDispatched * Number(a.unit_cost_aed ?? 0),
        id, dispatchNo,
        body.from_warehouse ?? null,
        body.technician_name,
        body.performed_by ?? 'system',
        a.domain ?? 'GENERAL',
        `Dispatched to ${body.technician_name}`,
      );

      // Update asset stock
      const newStatus = computeStatus(qtyAfter, Number(a.reorder_threshold ?? 0));
      await exec(`
        UPDATE asset_registry SET current_stock = $1, status = $2, updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
      `, qtyAfter, newStatus, item.asset_id, tenantId);

      // Upsert personnel_stock
      await exec(`
        INSERT INTO personnel_stock (
          id, tenant_id, technician_id, technician_name,
          asset_id, asset_name, asset_no,
          quantity_on_hand, unit_cost_aed, last_dispatch_id, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (tenant_id, technician_id, asset_id)
        DO UPDATE SET
          quantity_on_hand = personnel_stock.quantity_on_hand + $8,
          last_dispatch_id = $10,
          last_updated = NOW(),
          technician_name = $4
      `,
        crypto.randomUUID(), tenantId,
        body.technician_id ?? null, body.technician_name,
        item.asset_id, a.name, a.asset_no,
        qtyDispatched,
        item.unit_cost_aed ?? a.unit_cost_aed ?? 0,
        id,
      );

      // Asset movement
      await exec(`
        INSERT INTO asset_movements (
          id, tenant_id, asset_id, asset_type, asset_name, asset_no,
          movement_type, from_location, to_custodian, quantity,
          reference_type, reference_id, reference_no,
          moved_by, moved_at, notes, created_at
        ) VALUES ($1,$2,$3,'REGISTRY',$4,$5,'DISPATCH',$6,$7,$8,'DISPATCH',$9,$10,$11,NOW(),$12,NOW())
      `,
        crypto.randomUUID(), tenantId, item.asset_id,
        a.name, a.asset_no,
        body.from_warehouse ?? null, body.technician_name, qtyDispatched,
        id, dispatchNo,
        body.performed_by ?? 'system',
        `Dispatched to ${body.technician_name}`,
      );
    }

    return NextResponse.json(ser([dispatch as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
