/**
 * GET  /api/dispatch/jobs — list dispatch jobs
 * POST /api/dispatch/jobs — manual admin override
 *
 * Query params: tenantId, status, serviceType, priority, dateFrom, dateTo, page, limit
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { manualOverride } from '@/lib/dispatch/engine';

type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const sp          = new URL(req.url).searchParams;
    const tenantId    = sp.get('tenantId')    ?? '';
    const status      = sp.get('status')      ?? '';
    const serviceType = sp.get('serviceType') ?? '';
    const priority    = sp.get('priority')    ?? '';
    const dateFrom    = sp.get('dateFrom')    ?? '';
    const dateTo      = sp.get('dateTo')      ?? '';
    const page        = Math.max(1, parseInt(sp.get('page')  ?? '1'));
    const limit       = Math.min(100, parseInt(sp.get('limit') ?? '50'));
    const offset      = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[]    = [];

    const add = (cond: string, val: unknown) => { values.push(val); conditions.push(`${cond} = $${values.length}`); };
    const addRaw = (cond: string, val: unknown) => { values.push(val); conditions.push(cond.replace('?', `$${values.length}`)); };

    if (tenantId)    add('dj.tenant_id',    tenantId);
    if (status)      add('dj.status',       status);
    if (serviceType) add('dj.service_type', serviceType);
    if (priority)    add('dj.priority',     priority);
    if (dateFrom)    addRaw('dj.created_at >= ?::date', dateFrom);
    if (dateTo)      addRaw(`dj.created_at < (?::date + interval '1 day')`, dateTo);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Row[]>(`
        SELECT
          dj.*,
          (SELECT COUNT(*) FROM dispatch_attempts da WHERE da.dispatch_job_id = dj.id)::int AS attempt_count
        FROM dispatch_jobs dj
        ${where}
        ORDER BY dj.created_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, ...values, limit, offset),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM dispatch_jobs dj ${where}`,
        ...values
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    return NextResponse.json({
      data:  serialize(rows),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[dispatch/jobs GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** POST — manual admin override assignment */
export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();
    const { jobId, driverId, vehicleId, adminId } = await req.json();
    if (!jobId || !driverId || !vehicleId) {
      return NextResponse.json({ error: 'jobId, driverId, vehicleId are required' }, { status: 400 });
    }
    await manualOverride(jobId, driverId, vehicleId, adminId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dispatch/jobs POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
