import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { getTenantReadiness } from '@/lib/tenant-readiness';

type Params = { params: Promise<{ id: string }> };

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'tenants');
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const scoped = resolveTenantBoundary(auth.ctx, id);
    if (scoped instanceof NextResponse) return scoped;

    const started = Date.now();
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        plan: true,
        industry: true,
        isActive: true,
        contactEmail: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const [
      moduleRows,
      roleCount,
      userCount,
      branchCountRows,
      pendingApprovalRows,
      openInviteRows,
      activeSessionRows,
      failedLoginRows,
      recentChangeRows,
      serviceConfigRows,
      readinessDashboard,
    ] = await Promise.all([
      prisma.tenantModule.findMany({
        where: { tenantId: id },
        orderBy: { module: 'asc' },
        select: { module: true, isEnabled: true },
      }),
      prisma.role.count({ where: { tenantId: id } }),
      prisma.userTenant.count({ where: { tenantId: id, isActive: true } }),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM tenant_branches WHERE tenant_id = $1 AND COALESCE(is_active, true) = true`,
        id,
      ).catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM admin_approval_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
        id,
      ).catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM tenant_invitations WHERE tenant_id = $1 AND status IN ('PENDING', 'SENT')`,
        id,
      ).catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM auth_sessions WHERE tenant_id = $1 AND revoked_at IS NULL`,
        id,
      ).catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count
           FROM auth_login_attempts
          WHERE tenant_id = $1
            AND success = false
            AND occurred_at >= NOW() - INTERVAL '24 hours'`,
        id,
      ).catch(() => [{ count: BigInt(0) }]),
      prisma.$queryRawUnsafe<Array<{
        id: string;
        entity_type: string;
        action: string;
        summary: string | null;
        actor_role: string | null;
        created_at: string;
      }>>(
        `SELECT id::text, entity_type, action, summary, actor_role, created_at::text
           FROM admin_change_history
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 5`,
        id,
      ).catch(() => []),
      prisma.$queryRawUnsafe<Array<{ service_types: bigint; active_rules: bigint }>>(
        `SELECT
           (SELECT COUNT(*)::bigint FROM service_types WHERE (tenant_id = $1 OR tenant_id IS NULL) AND deleted_at IS NULL) AS service_types,
           (SELECT COUNT(*)::bigint
              FROM service_rules r
              JOIN service_types t ON t.id = r.service_type_id
             WHERE t.tenant_id = $1
               AND r.effective_to IS NULL) AS active_rules`,
        id,
      ).catch(() => [{ service_types: BigInt(0), active_rules: BigInt(0) }]),
      getTenantReadiness(id).catch(() => null),
    ]);

    const activeModules = moduleRows.filter(row => row.isEnabled).map(row => row.module);
    const serviceConfig = serviceConfigRows[0] ?? { service_types: BigInt(0), active_rules: BigInt(0) };
    const riskMessages = readinessDashboard
      ? [...readinessDashboard.blockers, ...readinessDashboard.warnings].map(item => item.message)
      : [];

    return NextResponse.json({
      tenant,
      metrics: {
        enabledModules: activeModules.length,
        totalModules: moduleRows.length,
        activeUsers: userCount,
        roles: roleCount,
        branches: toNumber(branchCountRows[0]?.count),
        pendingApprovals: toNumber(pendingApprovalRows[0]?.count),
        openInvitations: toNumber(openInviteRows[0]?.count),
        activeSessions: toNumber(activeSessionRows[0]?.count),
        failedLogins24h: toNumber(failedLoginRows[0]?.count),
        serviceTypes: toNumber(serviceConfig.service_types),
        activeServiceRules: toNumber(serviceConfig.active_rules),
      },
      modules: moduleRows,
      billing: readinessDashboard?.billing ?? null,
      recentChanges: recentChangeRows,
      readiness: {
        status: readinessDashboard && readinessDashboard.status !== 'READY' ? 'attention' : 'healthy',
        risks: riskMessages,
      },
      readinessDashboard,
      operational: {
        generatedAt: new Date().toISOString(),
        queryMs: Date.now() - started,
      },
    }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    console.error('[admin/tenants/:id/overview] GET error:', err);
    return NextResponse.json({ error: 'Failed to load tenant overview' }, { status: 500 });
  }
}
