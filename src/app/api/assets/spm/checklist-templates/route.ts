import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest) {
  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const cycleId = sp.get('cycle_id');

    if (!cycleId) {
      return NextResponse.json({ error: 'cycle_id query param is required' }, { status: 400 });
    }

    const rows = await query(`
      SELECT * FROM spm_checklist_templates
      WHERE cycle_id = $1 AND tenant_id = 'default'
      ORDER BY item_order ASC, created_at ASC
    `, cycleId);

    return NextResponse.json(ser(rows));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
        'default', $1, $2, $3, $4, NOW()
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
  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const id = sp.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
    }

    await exec(`DELETE FROM spm_checklist_templates WHERE id = $1 AND tenant_id = 'default'`, id);

    return NextResponse.json({ success: true, deleted_id: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
