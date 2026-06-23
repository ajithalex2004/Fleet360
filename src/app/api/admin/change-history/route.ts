import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureAdminChangeHistoryTable, maskAdminChangeValue } from '@/lib/admin-change-history';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'audit');
    if (auth instanceof NextResponse) return auth;

    await ensureAdminChangeHistoryTable();
    const sp = req.nextUrl.searchParams;
    const tenantId = resolveTenantBoundary(auth.ctx, sp.get('tenantId'));
    if (tenantId instanceof NextResponse) return tenantId;

    const entityType = sp.get('entityType') ?? '';
    const entityId = sp.get('entityId') ?? '';
    const action = sp.get('action') ?? '';
    const actorUserId = sp.get('actorUserId') ?? '';
    const sourceModule = sp.get('sourceModule') ?? '';
    const sourceEntityType = sp.get('sourceEntityType') ?? '';
    const sourceEntityId = sp.get('sourceEntityId') ?? '';
    const search = sp.get('search') ?? '';
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10));
    const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '100', 10), 1), 500);
    const offset = (page - 1) * limit;

    const where = ['(tenant_id = $1 OR $1 = \'\')'];
    const args: unknown[] = [auth.ctx.isSuperAdmin && !sp.get('tenantId') ? '' : tenantId];
    if (entityType) { args.push(entityType); where.push(`entity_type = $${args.length}`); }
    if (entityId) { args.push(entityId); where.push(`entity_id = $${args.length}`); }
    if (action) { args.push(action); where.push(`action = $${args.length}`); }
    if (actorUserId) { args.push(actorUserId); where.push(`actor_user_id = $${args.length}`); }
    if (sourceModule) { args.push(sourceModule); where.push(`source_module = $${args.length}`); }
    if (sourceEntityType) { args.push(sourceEntityType); where.push(`source_entity_type = $${args.length}`); }
    if (sourceEntityId) { args.push(sourceEntityId); where.push(`source_entity_id = $${args.length}`); }
    if (search) {
      args.push(`%${search}%`);
      const n = args.length;
      where.push(`(entity_type ILIKE $${n} OR entity_id ILIKE $${n} OR action ILIKE $${n} OR summary ILIKE $${n} OR actor_role ILIKE $${n})`);
    }
    const limitParam = args.length + 1;
    const offsetParam = args.length + 2;

    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id::text, tenant_id, entity_type, entity_id, action,
                actor_user_id, actor_role, impersonated_by,
                source_module, source_entity_type, source_entity_id,
                related_entity_type, related_entity_id, risk_severity,
                before_json, after_json, summary, ip_address, user_agent,
                created_at::text
           FROM admin_change_history
          WHERE ${where.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${limitParam} OFFSET $${offsetParam}`,
        ...args, limit, offset,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM admin_change_history
          WHERE ${where.join(' AND ')}`,
        ...args,
      ),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    const changes = rows.map(row => ({
      ...row,
      before_json: maskAdminChangeValue(row.before_json),
      after_json: maskAdminChangeValue(row.after_json),
    }));
    return NextResponse.json({ ok: true, changes, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (e) {
    console.error('[admin/change-history] GET error:', e);
    return NextResponse.json({ error: 'Failed to load change history' }, { status: 500 });
  }
}
