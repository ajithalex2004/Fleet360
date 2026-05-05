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
    const status = sp.get('status');
    const technicianId = sp.get('technician_id');
    const domain = sp.get('domain');
    const search = sp.get('search');
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(200, parseInt(sp.get('limit') ?? '50'));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    if (technicianId) { params.push(technicianId); conditions.push(`r.technician_id = $${params.length}`); }
    if (domain) { params.push(domain); conditions.push(`r.domain = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(r.return_no ILIKE $${params.length} OR r.technician_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    const countParams = [...params];
    const dataParams = [...params, limit, offset];

    const [countRes, rows] = await Promise.all([
      query<{ count: bigint }>(`SELECT COUNT(*) as count FROM return_requests r WHERE ${where}`, ...countParams),
      query(`
        SELECT r.*,
          (SELECT COUNT(*) FROM return_request_items ri WHERE ri.return_id = r.id) as item_count
        FROM return_requests r
        WHERE ${where}
        ORDER BY r.created_at DESC
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

    const seqRes = await query<{ count: bigint }>(`SELECT COUNT(*) as count FROM return_requests WHERE tenant_id = $1`, tenantId);
    const seq = Number(seqRes[0]?.count ?? 0) + 1;
    const returnNo = body.return_no ?? `RET-${String(seq).padStart(4, '0')}`;

    const [ret] = await query(`
      INSERT INTO return_requests (
        id, tenant_id, return_no, technician_id, technician_name, technician_phone,
        from_dispatch_id, status, requested_at, domain, reason, notes,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',NOW(),$8,$9,$10,$11,$12)
      RETURNING *
    `,
      id, tenantId, returnNo,
      body.technician_id ?? null, body.technician_name,
      body.technician_phone ?? null,
      body.from_dispatch_id ?? null,
      body.domain ?? 'GENERAL',
      body.reason ?? null, body.notes ?? null,
      now, now,
    );

    const items: Row[] = body.items ?? [];
    for (const item of items) {
      const qtyReturned = Number(item.quantity_returned ?? 0);

      await exec(`
        INSERT INTO return_request_items (
          id, return_id, tenant_id, asset_id, asset_name, asset_no,
          quantity_returned, condition, is_restored, restore_to_stock,
          unit_cost_aed, reason, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12)
      `,
        crypto.randomUUID(), id, tenantId,
        item.asset_id, item.asset_name ?? null, item.asset_no ?? null,
        qtyReturned,
        item.condition ?? 'GOOD',
        item.restore_to_stock ?? true,
        item.unit_cost_aed ?? 0,
        item.reason ?? null, item.notes ?? null,
      );

      // Reduce personnel stock immediately on return request
      await exec(`
        UPDATE personnel_stock
        SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1), last_updated = NOW()
        WHERE tenant_id = $2 AND technician_id = $3 AND asset_id = $4
      `, qtyReturned, tenantId, body.technician_id ?? null, item.asset_id);
    }

    return NextResponse.json(ser([ret as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
