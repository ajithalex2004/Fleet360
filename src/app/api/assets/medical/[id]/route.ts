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
      SELECT m.*,
        CASE
          WHEN m.expiry_date IS NOT NULL
          THEN EXTRACT(DAY FROM (m.expiry_date::TIMESTAMPTZ - NOW()))::INT
          ELSE NULL
        END as days_until_expiry
      FROM medical_assets m
      WHERE m.id = $1 AND m.tenant_id = $2
    `, id, tenantId);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const sealLogs = await query(`
      SELECT * FROM medical_seal_logs
      WHERE medical_asset_id = $1 AND tenant_id = $2
      ORDER BY action_at DESC
      LIMIT 20
    `, id, tenantId);

    return NextResponse.json({
      ...ser([row as Row])[0],
      sealLogs: ser(sealLogs as Row[]),
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
    const action = body.action as string | undefined;

    const [current] = await query(`SELECT * FROM medical_assets WHERE id = $1 AND tenant_id = $2`, id, tenantId);
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const cur = current as Row;

    if (action === 'seal') {
      await exec(`
        UPDATE medical_assets SET
          current_seal_no = $1, last_sealed_at = NOW(), last_sealed_by = $2,
          status = 'SEALED', updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
      `, body.seal_number ?? null, body.action_by ?? 'system', id, tenantId);

      await exec(`
        INSERT INTO medical_seal_logs (
          id, tenant_id, medical_asset_id, action, seal_number, action_by, action_at,
          quantity_at_action, quantity_expected, witness_name, reason, notes, created_at
        ) VALUES ($1,$2,$3,'SEALED',$4,$5,NOW(),$6,$7,$8,$9,$10,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        body.seal_number ?? null, body.action_by ?? 'system',
        cur.quantity ?? 0, body.quantity_expected ?? cur.quantity ?? 0,
        body.witness_name ?? null, body.reason ?? null, body.notes ?? null,
      );

    } else if (action === 'unseal') {
      await exec(`
        UPDATE medical_assets SET status = 'ACTIVE', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `, id, tenantId);

      await exec(`
        INSERT INTO medical_seal_logs (
          id, tenant_id, medical_asset_id, action, seal_number, action_by, action_at,
          quantity_at_action, witness_name, reason, notes, created_at
        ) VALUES ($1,$2,$3,'UNSEALED',$4,$5,NOW(),$6,$7,$8,$9,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        cur.current_seal_no ?? null, body.action_by ?? 'system',
        cur.quantity ?? 0, body.witness_name ?? null,
        body.reason ?? null, body.notes ?? null,
      );

    } else if (action === 'verify') {
      await exec(`
        INSERT INTO medical_seal_logs (
          id, tenant_id, medical_asset_id, action, seal_number, action_by, action_at,
          quantity_at_action, quantity_expected, witness_name, reason, notes, created_at
        ) VALUES ($1,$2,$3,'VERIFIED',$4,$5,NOW(),$6,$7,$8,$9,$10,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        cur.current_seal_no ?? null, body.action_by ?? 'system',
        cur.quantity ?? 0, body.quantity_expected ?? cur.quantity ?? 0,
        body.witness_name ?? null, body.reason ?? null, body.notes ?? null,
      );

    } else if (action === 'count') {
      const countQty = Number(body.count_qty ?? 0);
      const expectedQty = Number(cur.quantity ?? 0);
      const variance = countQty - expectedQty;
      const logAction = variance !== 0 ? 'VARIANCE_NOTED' : 'AUDITED';

      await exec(`
        UPDATE medical_assets SET
          last_count_date = CURRENT_DATE, last_count_qty = $1,
          variance_qty = $2, variance_reason = $3, updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
      `, countQty, variance, body.variance_reason ?? null, id, tenantId);

      await exec(`
        INSERT INTO medical_seal_logs (
          id, tenant_id, medical_asset_id, action, seal_number, action_by, action_at,
          quantity_at_action, quantity_expected, variance_qty, witness_name, reason, notes, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11,$12,NOW())
      `,
        crypto.randomUUID(), tenantId, id,
        logAction, cur.current_seal_no ?? null, body.action_by ?? 'system',
        countQty, expectedQty, variance,
        body.witness_name ?? null, body.variance_reason ?? null, body.notes ?? null,
      );

    } else {
      // General field update
      const sets: string[] = ['updated_at = $2'];
      const values: unknown[] = [id, now];

      const fields = [
        'name','category','asset_type','is_restricted','controlled_substance_level',
        'batch_number','lot_number','manufacture_date','expiry_date',
        'quantity','unit','unit_cost_aed','storage_requirement','storage_location',
        'domain','assigned_vehicle_id','status','notes',
      ];

      for (const f of fields) {
        if (body[f] !== undefined) {
          values.push(body[f]);
          sets.push(`${f} = $${values.length}`);
        }
      }

      values.push(id, tenantId);
      await exec(
        `UPDATE medical_assets SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        ...values,
      );
    }

    const [updated] = await query(`
      SELECT m.*,
        CASE WHEN m.expiry_date IS NOT NULL THEN EXTRACT(DAY FROM (m.expiry_date::TIMESTAMPTZ - NOW()))::INT ELSE NULL END as days_until_expiry
      FROM medical_assets m WHERE m.id = $1 AND m.tenant_id = $2
    `, id, tenantId);

    return NextResponse.json(ser([updated as Row])[0]);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
