import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
// prisma client also used directly for User lookup (Prisma model)

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest) {
  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const priority = sp.get('priority');
    const search = sp.get('search');

    const conditions: string[] = [`tenant_id = 'default'`];
    const params: unknown[] = [];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (priority) { params.push(priority); conditions.push(`priority = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`name ILIKE $${params.length}`); }

    const where = conditions.join(' AND ');

    const rows = await query(`
      SELECT *,
        ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
      FROM spm_cycles
      WHERE ${where}
      ORDER BY next_run_at ASC NULLS LAST
    `, ...params);

    return NextResponse.json(ser(rows));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSpmSchema();
    const body = await req.json();

    // Auto-generate cycle_code
    const countRes = await query<{ count: bigint }>(`SELECT COUNT(*) AS count FROM spm_cycles WHERE tenant_id = 'default'`);
    const seq = Number(countRes[0]?.count ?? 0) + 1;
    const cycleCode = `SPM-${String(seq).padStart(4, '0')}`;

    // Fetch asset metadata if asset_id provided
    let assetName: string | null = body.asset_name ?? null;
    let assetNo: string | null = body.asset_no ?? null;
    let assetCategory: string | null = body.asset_category ?? null;
    let assetLocation: string | null = body.asset_location ?? null;
    let assetDomain: string | null = body.asset_domain ?? null;

    if (body.asset_id) {
      const assetRows = await query<Row>(`
        SELECT name, asset_no, domain, warehouse_location,
               (SELECT name FROM asset_categories ac WHERE ac.id = ar.category_id) AS category_name
        FROM asset_registry ar
        WHERE id = $1 AND tenant_id = 'default'
        LIMIT 1
      `, body.asset_id);
      if (assetRows.length > 0) {
        const a = assetRows[0];
        assetName = (a.name as string) ?? assetName;
        assetNo = (a.asset_no as string) ?? assetNo;
        assetCategory = (a.category_name as string) ?? assetCategory;
        assetLocation = (a.warehouse_location as string) ?? assetLocation;
        assetDomain = (a.domain as string) ?? assetDomain;
      }
    }

    // Calculate next_run_at
    const intervalDays = body.interval_days ?? 30;
    let nextRunAt: string;
    if (body.first_run_at) {
      nextRunAt = body.first_run_at;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + intervalDays);
      nextRunAt = d.toISOString();
    }

    // Resolve user if assigned_to_user_id provided
    let assignedToName: string | null = body.assigned_to ?? null;
    let assignedToEmail: string | null = body.assigned_to_email ?? null;
    const assignedToUserId: string | null = body.assigned_to_user_id ?? null;

    if (assignedToUserId) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: assignedToUserId },
          select: { firstName: true, lastName: true, username: true, email: true },
        });
        if (user) {
          assignedToName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
          assignedToEmail = user.email ?? null;
        }
      } catch { /* ignore */ }
    }

    const [row] = await query(`
      INSERT INTO spm_cycles (
        tenant_id, cycle_code, name, description,
        asset_id, asset_name, asset_no, asset_category, asset_location, asset_domain,
        maintenance_type, interval_days, first_run_at, next_run_at,
        priority, status, assigned_to, assigned_to_user_id, assigned_to_email,
        estimated_duration_mins, notes,
        created_at, updated_at
      ) VALUES (
        'default', $1, $2, $3,
        $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20,
        NOW(), NOW()
      ) RETURNING *,
        ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
    `,
      cycleCode,
      body.name,
      body.description ?? null,
      body.asset_id ?? null,
      assetName,
      assetNo,
      assetCategory,
      assetLocation,
      assetDomain,
      body.maintenance_type ?? 'PREVENTIVE',
      intervalDays,
      body.first_run_at ?? null,
      nextRunAt,
      body.priority ?? 'MEDIUM',
      body.status ?? 'ACTIVE',
      assignedToName,
      assignedToUserId,
      assignedToEmail,
      body.estimated_duration_mins ?? 60,
      body.notes ?? null,
    );

    return NextResponse.json(ser(row), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
