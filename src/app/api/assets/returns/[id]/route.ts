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

    const [ret] = await query(`SELECT * FROM return_requests WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await query(`SELECT * FROM return_request_items WHERE return_id = $1 AND tenant_id = $2`, id, tenantId);

    return NextResponse.json({
      ...ser([ret as Row])[0],
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

    const [ret] = await query(`SELECT * FROM return_requests WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!ret) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'approve') {
      await exec(`
        UPDATE return_requests SET
          status = 'APPROVED',
          reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
      `, body.reviewed_by ?? 'system', id, tenantId);

    } else if (action === 'reject') {
      await exec(`
        UPDATE return_requests SET
          status = 'REJECTED',
          reviewed_by = $1, reviewed_at = NOW(),
          notes = COALESCE($2, notes), updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
      `, body.reviewed_by ?? 'system', body.notes ?? null, id, tenantId);

    } else if (action === 'restore') {
      await exec(`
        UPDATE return_requests SET
          status = 'RESTORED',
          restoration_approved_by = $1, restoration_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
      `, body.restoration_approved_by ?? 'system', id, tenantId);

      // For items where restore_to_stock = true and condition = 'GOOD'
      const items = await query(`
        SELECT * FROM return_request_items
        WHERE return_id = $1 AND tenant_id = $2
          AND restore_to_stock = TRUE AND condition = 'GOOD' AND is_restored = FALSE
      `, id, tenantId);

      for (const item of items) {
        const ri = item as Row;
        const qtyToRestore = Number(ri.quantity_returned ?? 0);

        const [asset] = await query(`
          SELECT current_stock, reorder_threshold, unit_cost_aed, domain, name, asset_no
          FROM asset_registry WHERE id = $1 AND tenant_id = $2
        `, ri.asset_id, tenantId);

        if (!asset) continue;
        const a = asset as Row;
        const qtyBefore = Number(a.current_stock ?? 0);
        const qtyAfter = qtyBefore + qtyToRestore;
        const newStatus = computeStatus(qtyAfter, Number(a.reorder_threshold ?? 0));

        // Add back to stock
        await exec(`
          UPDATE asset_registry SET current_stock = $1, status = $2, updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4
        `, qtyAfter, newStatus, ri.asset_id, tenantId);

        // Stock transaction RETURN
        await exec(`
          INSERT INTO stock_transactions (
            id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
            quantity_before, quantity_change, quantity_after,
            unit_cost_aed, total_value_aed,
            reference_type, reference_id, reference_no,
            performed_by, performed_at, domain, notes, created_at
          ) VALUES ($1,$2,$3,$4,$5,'RETURN',$6,$7,$8,$9,$10,'RETURN',$11,$12,$13,NOW(),$14,$15,NOW())
        `,
          crypto.randomUUID(), tenantId, ri.asset_id,
          a.name, a.asset_no,
          qtyBefore, qtyToRestore, qtyAfter,
          Number(a.unit_cost_aed ?? 0),
          qtyToRestore * Number(a.unit_cost_aed ?? 0),
          id, (ret as Row).return_no,
          body.restoration_approved_by ?? 'system',
          a.domain ?? 'GENERAL',
          `Returned and restored to stock from ${(ret as Row).technician_name}`,
        );

        // Asset movement RETURN
        await exec(`
          INSERT INTO asset_movements (
            id, tenant_id, asset_id, asset_type, asset_name, asset_no,
            movement_type, from_custodian, quantity,
            reference_type, reference_id, reference_no,
            moved_by, moved_at, notes, created_at
          ) VALUES ($1,$2,$3,'REGISTRY',$4,$5,'RETURN',$6,$7,'RETURN',$8,$9,$10,NOW(),$11,NOW())
        `,
          crypto.randomUUID(), tenantId, ri.asset_id,
          a.name, a.asset_no,
          (ret as Row).technician_name, qtyToRestore,
          id, (ret as Row).return_no,
          body.restoration_approved_by ?? 'system',
          `Stock restored from return by ${(ret as Row).technician_name}`,
        );

        // Mark item as restored
        await exec(`
          UPDATE return_request_items SET is_restored = TRUE
          WHERE id = $1
        `, ri.id);
      }

    } else {
      // Generic status update
      if (body.status) {
        await exec(`
          UPDATE return_requests SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4
        `, body.status, body.notes ?? null, id, tenantId);
      }
    }

    const [updated] = await query(`SELECT * FROM return_requests WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    const items = await query(`SELECT * FROM return_request_items WHERE return_id = $1 AND tenant_id = $2`, id, tenantId);

    return NextResponse.json({
      ...ser([updated as Row])[0],
      items: ser(items as Row[]),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
