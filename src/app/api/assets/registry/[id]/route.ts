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
      SELECT ar.*,
             ac.name as category_name,
             ac.icon as category_icon,
             ac.color as category_color,
             ac.domain as category_domain
      FROM asset_registry ar
      LEFT JOIN asset_categories ac ON ac.id = ar.category_id
      WHERE ar.id = $1 AND ar.tenant_id = $2
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

    // Get current asset
    const [current] = await query(`SELECT * FROM asset_registry WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sets: string[] = ['updated_at = $2'];
    const values: unknown[] = [id, now];

    const fields = [
      'name','description','category_id','subcategory','domain','asset_type',
      'oem_part_number','manufacturer','model','unit_of_measure',
      'current_stock','allocated_stock','reorder_threshold','reorder_quantity',
      'unit_cost_aed','warehouse_location','bin_location',
      'is_serialized','is_restricted','requires_calibration',
      'is_ble_tracked','ble_tag_id','notes','status','is_active',
    ];

    for (const f of fields) {
      if (body[f] !== undefined) {
        values.push(body[f]);
        sets.push(`${f} = $${values.length}`);
      }
    }

    values.push(id, tenantId);
    const [updated] = await query(
      `UPDATE asset_registry SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
      ...values,
    );

    // Log stock adjustment if stock changed
    const oldStock = Number((current as Row).current_stock ?? 0);
    const newStock = body.current_stock !== undefined ? Number(body.current_stock) : oldStock;
    if (body.current_stock !== undefined && newStock !== oldStock) {
      const diff = newStock - oldStock;
      const txType = diff > 0 ? 'ADJUSTMENT_UP' : 'ADJUSTMENT_DOWN';
      await exec(`
        INSERT INTO stock_transactions (
          id, tenant_id, asset_id, asset_name, asset_no, transaction_type,
          quantity_before, quantity_change, quantity_after,
          unit_cost_aed, total_value_aed, reference_type,
          performed_by, performed_at, domain, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ADJUSTMENT',$12,NOW(),$13,$14,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        (current as Row).name, (current as Row).asset_no, txType,
        oldStock, Math.abs(diff), newStock,
        body.unit_cost_aed ?? (current as Row).unit_cost_aed ?? 0,
        newStock * Number(body.unit_cost_aed ?? (current as Row).unit_cost_aed ?? 0),
        body.performed_by ?? 'system',
        (updated as Row).domain ?? 'GENERAL',
        body.notes ?? 'Stock adjustment via update',
      );
    }

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await ensureAssetsSchema();
    const { id } = params;
    const tenantId = req.nextUrl.searchParams.get('tenantId') ?? 'default';

    await exec(
      `UPDATE asset_registry SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      id, tenantId,
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
