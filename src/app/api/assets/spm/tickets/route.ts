import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

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
    const cycleId = sp.get('cycle_id');
    const priority = sp.get('priority');
    const search = sp.get('search');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');

    const conditions: string[] = [`t.tenant_id = 'default'`];
    const params: unknown[] = [];

    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
    if (cycleId) { params.push(cycleId); conditions.push(`t.cycle_id = $${params.length}`); }
    if (priority) { params.push(priority); conditions.push(`t.priority = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(t.asset_name ILIKE $${params.length} OR t.ticket_code ILIKE $${params.length})`);
    }
    if (dateFrom) { params.push(dateFrom); conditions.push(`t.scheduled_date >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); conditions.push(`t.scheduled_date <= $${params.length}`); }

    const where = conditions.join(' AND ');

    const rows = await query(`
      SELECT t.*, c.interval_days, c.cycle_code
      FROM spm_tickets t
      LEFT JOIN spm_cycles c ON t.cycle_id = c.id
      WHERE ${where}
      ORDER BY t.scheduled_date DESC
      LIMIT 100
    `, ...params);

    return NextResponse.json(ser(rows));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
