import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAssetsSchema } from '@/lib/assets/schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
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
    const isActive = sp.get('is_active');

    const conditions: string[] = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (domain) { params.push(domain); conditions.push(`(c.domain = $${params.length} OR c.domain = 'ALL')`); }
    if (isActive !== null && isActive !== undefined) {
      params.push(isActive === 'true');
      conditions.push(`c.is_active = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const rows = await query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM asset_registry ar WHERE ar.category_id = c.id AND ar.is_active = TRUE) as asset_count
      FROM asset_categories c
      WHERE ${where}
      ORDER BY c.sort_order ASC, c.name ASC
    `, ...params);

    return NextResponse.json({ data: ser(rows as Row[]) });
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

    const [row] = await query(`
      INSERT INTO asset_categories (
        id, tenant_id, name, parent_id, domain, icon, color,
        description, is_active, sort_order, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `,
      id, tenantId,
      body.name, body.parent_id ?? null,
      body.domain ?? 'GENERAL',
      body.icon ?? '📦', body.color ?? '#6366f1',
      body.description ?? null,
      body.is_active ?? true,
      body.sort_order ?? 0,
      now, now,
    );

    return NextResponse.json(ser([row as Row])[0], { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
