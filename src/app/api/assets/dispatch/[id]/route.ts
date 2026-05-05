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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureAssetsSchema();
    const { id } = params;
    const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'default';

    const [dispatch] = await query(`
      SELECT * FROM field_dispatch WHERE id = $1 AND tenant_id = $2
    `, id, tenantId);

    if (!dispatch) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await query(`
      SELECT * FROM field_dispatch_items WHERE dispatch_id = $1 AND tenant_id = $2
    `, id, tenantId);

    return NextResponse.json({
      ...ser([dispatch as Row])[0],
      items: ser(items as Row[]),
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
    const action = body.action as string | undefined;

    const [dispatch] = await query(`SELECT * FROM field_dispatch WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!dispatch) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const d = dispatch as Row;

    if (action === 'accept') {
      await exec(`
        UPDATE field_dispatch SET status = 'ACCEPTED', accepted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, id, tenantId);

      // Update accepted quantities for items
      const itemUpdates: Row[] = body.items ?? [];
      for (const item of itemUpdates) {
        if (item.id && item.quantity_accepted !== undefined) {
          await exec(`
            UPDATE field_dispatch_items SET quantity_accepted = $1
            WHERE id = $2 AND dispatch_id = $3
          `, Number(item.quantity_accepted), item.id, id);
        }
      }

    } else if (action === 'consume') {
      const itemUpdates: Row[] = body.items ?? [];
      for (const item of itemUpdates) {
        if (!item.id) continue;
        const [dispItem] = await query(`
          SELECT fdi.*, ar.current_stock, ar.reorder_threshold, ar.unit_cost_aed, ar.domain
          FROM field_dispatch_items fdi
          JOIN asset_registry ar ON ar.id = fdi.asset_id
          WHERE fdi.id = $1 AND fdi.dispatch_id = $2
        `, item.id, id);

        if (!dispItem) continue;
        const di = dispItem as Row;
        const qtyConsumed = Number(item.quantity_consumed ?? 0);

        await exec(`
          UPDATE field_dispatch_items
          SET quantity_consumed = quantity_consumed + $1
          WHERE id = $2 AND dispatch_id = $3
        `, qtyConsumed, item.id, id);

        // Stock transaction CONSUMED — already removed at dispatch, just log it
        await exec(`
          INSERT INTO stock_transactions (
            id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
            quantity_before, quantity_change, quantity_after,
            unit_cost_aed, total_value_aed,
            reference_type, reference_id, reference_no,
            performed_by, performed_at, domain, notes, created_at
          ) VALUES ($1,$2,$3,$4,$5,'CONSUMED',$6,$7,$6,$8,$9,'DISPATCH',$10,$11,$12,NOW(),$13,$14,NOW())
        `,
          crypto.randomUUID(), tenantId, di.asset_id,
          di.asset_name, di.asset_no,
          Number(di.current_stock ?? 0), qtyConsumed,
          Number(di.unit_cost_aed ?? 0),
          qtyConsumed * Number(di.unit_cost_aed ?? 0),
          id, d.dispatch_no,
          body.performed_by ?? 'system',
          di.domain ?? 'GENERAL',
          `Consumed by ${d.technician_name}`,
        );

        // Reduce personnel stock
        await exec(`
          UPDATE personnel_stock
          SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1), last_updated = NOW()
          WHERE tenant_id = $2 AND technician_id = $3 AND asset_id = $4
        `, qtyConsumed, tenantId, d.technician_id ?? null, di.asset_id);
      }

    } else if (action === 'cancel') {
      await exec(`
        UPDATE field_dispatch SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, id, tenantId);

      // Reverse stock transactions — add stock back
      const items = await query(`SELECT * FROM field_dispatch_items WHERE dispatch_id = $1 AND tenant_id = $2`, id, tenantId);
      for (const item of items) {
        const di = item as Row;
        const qtyToRestore = Number(di.quantity_dispatched ?? 0);
        const [asset] = await query(`
          SELECT current_stock, reorder_threshold, unit_cost_aed, domain FROM asset_registry WHERE id = $1 AND tenant_id = $2
        `, di.asset_id, tenantId);

        if (!asset) continue;
        const a = asset as Row;
        const newStock = Number(a.current_stock ?? 0) + qtyToRestore;
        const newStatus = computeStatus(newStock, Number(a.reorder_threshold ?? 0));

        await exec(`
          UPDATE asset_registry SET current_stock = $1, status = $2, updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4
        `, newStock, newStatus, di.asset_id, tenantId);

        await exec(`
          INSERT INTO stock_transactions (
            id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
            quantity_before, quantity_change, quantity_after,
            unit_cost_aed, total_value_aed,
            reference_type, reference_id, reference_no,
            performed_by, performed_at, domain, notes, created_at
          ) VALUES ($1,$2,$3,$4,$5,'RETURN',$6,$7,$8,$9,$10,'DISPATCH',$11,$12,$13,NOW(),$14,'Dispatch cancelled — stock reversed',NOW())
        `,
          crypto.randomUUID(), tenantId, di.asset_id,
          di.asset_name, di.asset_no,
          Number(a.current_stock ?? 0), qtyToRestore, newStock,
          Number(a.unit_cost_aed ?? 0),
          qtyToRestore * Number(a.unit_cost_aed ?? 0),
          id, d.dispatch_no,
          body.performed_by ?? 'system',
          a.domain ?? 'GENERAL',
        );

        // Reduce personnel stock
        await exec(`
          UPDATE personnel_stock
          SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1), last_updated = NOW()
          WHERE tenant_id = $2 AND technician_id = $3 AND asset_id = $4
        `, qtyToRestore, tenantId, d.technician_id ?? null, di.asset_id);
      }

    } else {
      // Generic update
      const sets: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];

      const fields = ['status','notes','work_order_no','domain'];
      for (const f of fields) {
        if (body[f] !== undefined) {
          values.push(body[f]);
          sets.push(`${f} = $${values.length}`);
        }
      }
      values.push(id, tenantId);
      await exec(
        `UPDATE field_dispatch SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        ...values,
      );
    }

    const [updated] = await query(`SELECT * FROM field_dispatch WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    const items = await query(`SELECT * FROM field_dispatch_items WHERE dispatch_id = $1 AND tenant_id = $2`, id, tenantId);

    return NextResponse.json({
      ...ser([updated as Row])[0],
      items: ser(items as Row[]),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
