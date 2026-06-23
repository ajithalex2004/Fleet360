import { NextRequest, NextResponse } from 'next/server';
import { type AdminContext, requireAdminRole } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import {
  loadPlatformRentalMasterData,
  loadResolvedRentalMasterData,
  loadTenantRentalMasterData,
  savePlatformRentalMasterData,
  saveTenantRentalMasterData,
  type RentalMasterCatalog,
} from '@/lib/rental-master-data';

function resolveTenantScope(
  scope: string,
  requestedTenantId: string | null,
  ctx: AdminContext,
) {
  if (scope === 'platform') {
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return null;
  }
  if (requestedTenantId && !ctx.isSuperAdmin && requestedTenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const tenantId = requestedTenantId || ctx.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant scope is required' }, { status: 400 });
  }
  return tenantId;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (ctx instanceof NextResponse) return ctx;

    const scope = req.nextUrl.searchParams.get('scope') ?? 'tenant';
    const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
    const target = resolveTenantScope(scope, requestedTenantId, ctx);
    if (target instanceof NextResponse) return target;

    if (scope === 'platform') {
      const catalog = await loadPlatformRentalMasterData();
      return NextResponse.json({ scope, catalog });
    }
    if (!target) {
      return NextResponse.json({ error: 'Tenant scope is required' }, { status: 400 });
    }

    const tenantOverrides = await loadTenantRentalMasterData(target);
    const catalog = await loadResolvedRentalMasterData(target);
    return NextResponse.json({ scope: 'tenant', tenantId: target, catalog, overrides: tenantOverrides });
  } catch (error) {
    console.error('[admin-rental-master-data] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load rental master data' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
    if (ctx instanceof NextResponse) return ctx;

    const scope = req.nextUrl.searchParams.get('scope') ?? 'tenant';
    const requestedTenantId = req.nextUrl.searchParams.get('tenantId');
    const target = resolveTenantScope(scope, requestedTenantId, ctx);
    if (target instanceof NextResponse) return target;

    const body = await req.json() as Partial<RentalMasterCatalog>;

    if (scope === 'platform') {
      const before = await loadPlatformRentalMasterData();
      const after = await savePlatformRentalMasterData(body);
      await recordAdminChange({
        req,
        ctx,
        tenantId: null,
        entityType: 'RentalMasterData',
        entityId: 'platform',
        action: 'UPDATE',
        before,
        after,
        sourceModule: 'rac',
        summary: 'Updated platform rental master-data defaults.',
      });
      return NextResponse.json({ ok: true, scope, catalog: after });
    }
    if (!target) {
      return NextResponse.json({ error: 'Tenant scope is required' }, { status: 400 });
    }

    const before = await loadTenantRentalMasterData(target);
    const overrides = await saveTenantRentalMasterData(target, body);
    const resolved = await loadResolvedRentalMasterData(target);
    await recordAdminChange({
      req,
      ctx,
      tenantId: target,
      entityType: 'RentalMasterData',
      entityId: target,
      action: 'UPDATE',
      before,
      after: overrides,
      sourceModule: 'rac',
      summary: 'Updated tenant rental master-data overrides.',
    });
    return NextResponse.json({ ok: true, scope: 'tenant', tenantId: target, overrides, catalog: resolved });
  } catch (error) {
    console.error('[admin-rental-master-data] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update rental master data' }, { status: 500 });
  }
}
