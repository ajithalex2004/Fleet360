import { NextRequest, NextResponse } from 'next/server';

export function logisticsRequestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

export function resolveLogisticsTenant(req: NextRequest) {
  const ctx = logisticsRequestContext(req);
  if (!ctx) {
    return { error: NextResponse.json({ error: 'Tenant context is required' }, { status: 401 }) };
  }
  const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 }) };
  }
  return {
    ctx,
    tenantId: requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId,
  };
}

export function logisticsErrorResponse(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'LogisticsValidationError') {
    const validation = error as { message?: string; issues?: string[]; warnings?: string[]; statusCode?: number };
    return NextResponse.json({
      error: validation.message ?? fallback,
      issues: validation.issues ?? [],
      warnings: validation.warnings ?? [],
    }, { status: validation.statusCode ?? 422 });
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'LOGISTICS_COMPLIANCE_BLOCKED') {
    const coded = error as { message?: string; code?: string; blockers?: unknown };
    return NextResponse.json({
      error: coded.message ?? fallback,
      code: coded.code,
      blockers: coded.blockers ?? [],
    }, { status: 409 });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
