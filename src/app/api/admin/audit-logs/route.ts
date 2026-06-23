import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAuditTable, logAudit, AuditPayload } from '@/lib/audit';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';

// ---------------------------------------------------------------------------
// GET /api/admin/audit-logs
// Query params:
//   tenantId, entityType, userId, action, search
//   dateFrom, dateTo   (ISO date strings)
//   page (1-based), limit
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'audit');
    if (auth instanceof NextResponse) return auth;

    await ensureAuditTable();

    const sp        = new URL(req.url).searchParams;
    const scopedTenant = resolveTenantBoundary(auth.ctx, sp.get('tenantId'));
    if (scopedTenant instanceof NextResponse) return scopedTenant;
    const tenantId  = scopedTenant;
    const branchId  = sp.get('branchId')  ?? '';
    const entityType= sp.get('entityType')?? '';
    const userId    = sp.get('userId')    ?? '';
    const action    = sp.get('action')    ?? '';
    const search    = sp.get('search')    ?? '';
    const dateFrom  = sp.get('dateFrom')  ?? '';
    const dateTo    = sp.get('dateTo')    ?? '';
    const page      = Math.max(1, parseInt(sp.get('page')  ?? '1'));
    const limit     = Math.min(100, parseInt(sp.get('limit') ?? '50'));
    const offset    = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[]    = [];

    if (tenantId)   { values.push(tenantId);   conditions.push(`tenant_id   = $${values.length}`); }
    if (branchId)   { values.push(branchId);   conditions.push(`branch_id   = $${values.length}`); }
    if (entityType) { values.push(entityType); conditions.push(`entity_type = $${values.length}`); }
    if (userId)     { values.push(userId);     conditions.push(`user_id     = $${values.length}`); }
    if (action)     { values.push(action);     conditions.push(`action      = $${values.length}`); }
    if (dateFrom)   { values.push(dateFrom);   conditions.push(`created_at >= $${values.length}::date`); }
    if (dateTo)     { values.push(dateTo);     conditions.push(`created_at <  ($${values.length}::date + interval '1 day')`); }
    if (search) {
      values.push(`%${search}%`);
      const n = values.length;
      conditions.push(
        `(tenant_name ILIKE $${n} OR user_name ILIKE $${n} OR user_email ILIKE $${n}` +
        ` OR entity_name ILIKE $${n} OR details ILIKE $${n} OR action ILIKE $${n})`
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    type Row = Record<string, unknown>;

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Row[]>(
        `SELECT * FROM audit_logs ${where}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        ...values, limit, offset
      ),
      prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count FROM audit_logs ${where}`,
        ...values
      ),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    const data = rows.map(r => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
        if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
        out[k] = v;
      }
      return out;
    });

    return NextResponse.json({ data, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[audit-logs GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/audit-logs  — manually log an event
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'create', 'audit');
    if (auth instanceof NextResponse) return auth;

    const body: AuditPayload = await req.json();
    if (!body.entityType || !body.action) {
      return NextResponse.json({ error: 'entityType and action are required' }, { status: 400 });
    }
    // Capture IP from headers
    body.ipAddress = body.ipAddress
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? undefined;
    body.userAgent = body.userAgent ?? req.headers.get('user-agent') ?? undefined;
    if (!auth.ctx.isSuperAdmin) {
      body.tenantId = auth.ctx.tenantId;
    }
    body.userId = body.userId ?? auth.ctx.userId;
    body.userRole = body.userRole ?? auth.ctx.role;

    await logAudit(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[audit-logs POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
