import { NextRequest, NextResponse } from 'next/server';
import { getLogisticsFinanceReconciliation } from '@/lib/logistics/domain';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, role, isSuperAdmin };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
    if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const tenantId = requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
    const reconciliation = await getLogisticsFinanceReconciliation({
      tenantId,
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json(reconciliation);
  } catch (error) {
    console.error('[logistics/finance-reconciliation GET]', error);
    return NextResponse.json({ error: 'Failed to fetch logistics finance reconciliation' }, { status: 500 });
  }
}
