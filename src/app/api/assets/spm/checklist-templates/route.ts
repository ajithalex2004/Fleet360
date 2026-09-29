export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { spmSql } from '@/lib/assets/spm-sql';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

import { requireAuthorizedTenant } from '@/lib/tenant-context';

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query } = spmSql(tenantId);

  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const cycleId = sp.get('cycle_id');

    if (!cycleId) {
      return NextResponse.json({ error: 'cycle_id query param is required' }, { status: 400 });
    }

    const rows = await query(`
      SELECT * FROM spm_checklist_templates
      WHERE cycle_id::text = $1 AND tenant_id = $tenant
      ORDER BY item_order ASC, created_at ASC
    `, cycleId);

    return NextResponse.json(ser(rows));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query } = spmSql(tenantId);

  try {
    await ensureSpmSchema();
    const body = await req.json();

    if (!body.cycle_id || !body.description) {
      return NextResponse.json({ error: 'cycle_id and description are required' }, { status: 400 });
    }

    const [row] = await query(`
      INSERT INTO spm_checklist_templates (
        tenant_id, cycle_id, item_order, description, is_mandatory, created_at
      ) VALUES (
        $tenant, $1::uuid, $2::int, $3, $4::boolean, NOW()
      ) RETURNING *
    `,
      body.cycle_id,
      body.item_order ?? 0,
      body.description,
      body.is_mandatory ?? true,
    );

    return NextResponse.json(ser(row), { status: 201 });
    } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { exec } = spmSql(tenantId);

  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const id = sp.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    await exec(`DELETE FROM spm_checklist_templates WHERE id::text = $1 AND tenant_id = $tenant`, id);

    return NextResponse.json({ success: true, deleted_id: id });
    } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
