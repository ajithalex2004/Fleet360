import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { listTenantReadiness } from '@/lib/tenant-readiness';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'tenants');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const requestedTenantId = searchParams.get('tenantId');
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 50), 1), 200);
    const statusFilter = searchParams.get('status')?.toUpperCase();

    const scopedTenantId = requestedTenantId
      ? resolveTenantBoundary(auth.ctx, requestedTenantId)
      : auth.ctx.isSuperAdmin ? null : auth.ctx.tenantId;
    if (scopedTenantId instanceof NextResponse) return scopedTenantId;

    const tenants = await prisma.tenant.findMany({
      where: scopedTenantId ? { id: scopedTenantId } : {},
      select: { id: true, name: true, code: true, plan: true, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const readiness = await listTenantReadiness(tenants.map(tenant => tenant.id));
    const tenantById = new Map(tenants.map(tenant => [tenant.id, tenant]));
    const rows = readiness
      .filter(row => !statusFilter || row.status === statusFilter)
      .map(row => ({
        tenant: tenantById.get(row.tenantId),
        readiness: row,
      }));

    return NextResponse.json({
      summary: {
        total: readiness.length,
        ready: readiness.filter(row => row.status === 'READY').length,
        attention: readiness.filter(row => row.status === 'ATTENTION').length,
        blocked: readiness.filter(row => row.status === 'BLOCKED').length,
        averageScore: readiness.length
          ? Math.round(readiness.reduce((sum, row) => sum + row.score, 0) / readiness.length)
          : 0,
      },
      tenants: rows,
      generatedAt: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (err) {
    console.error('[admin/tenants/readiness] GET error:', err);
    return NextResponse.json({ error: 'Failed to load tenant readiness' }, { status: 500 });
  }
}
