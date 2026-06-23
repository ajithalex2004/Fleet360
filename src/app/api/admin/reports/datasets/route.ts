import { NextRequest, NextResponse } from 'next/server';
import { type AdminContext, requireAdminRole } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';
import { MODULE_ACCESS_PRESETS } from '@/lib/module-access-presets';
import { SYSTEM_ROLES } from '@/lib/permissions';
import {
  defaultDynamicReportDatasetCatalog,
  listRegistryDynamicReportDatasets,
  loadPlatformDynamicReportDatasetCatalog,
  loadResolvedDynamicReportDatasetCatalog,
  loadTenantDynamicReportDatasetCatalog,
  savePlatformDynamicReportDatasetCatalog,
  saveTenantDynamicReportDatasetCatalog,
} from '@/lib/reports/dynamic-reports';

export const runtime = 'nodejs';

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
  return requestedTenantId || ctx.tenantId;
}

function metadata() {
  return {
    registry: listRegistryDynamicReportDatasets(),
    defaults: defaultDynamicReportDatasetCatalog(),
    roleOptions: SYSTEM_ROLES.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description,
    })),
    modulePresetOptions: MODULE_ACCESS_PRESETS.map((preset) => ({
      key: preset.key,
      label: preset.label,
      description: preset.description,
    })),
  };
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
      const catalog = await loadPlatformDynamicReportDatasetCatalog();
      return NextResponse.json({ scope, catalog, ...metadata() });
    }
    if (!target) {
      return NextResponse.json({ error: 'Tenant scope is required' }, { status: 400 });
    }

    const [catalog, overrides] = await Promise.all([
      loadResolvedDynamicReportDatasetCatalog(target),
      loadTenantDynamicReportDatasetCatalog(target),
    ]);
    return NextResponse.json({
      scope: 'tenant',
      tenantId: target,
      catalog,
      overrides,
      ...metadata(),
    });
  } catch (error) {
    console.error('[admin-reports-datasets.GET]', error);
    return NextResponse.json({ error: 'Failed to load dataset catalog' }, { status: 500 });
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

    const body = await req.json().catch(() => ({}));
    const input = body.catalog ?? body;

    if (scope === 'platform') {
      const before = await loadPlatformDynamicReportDatasetCatalog();
      const after = await savePlatformDynamicReportDatasetCatalog(input);
      await recordAdminChange({
        req,
        ctx,
        tenantId: null,
        entityType: 'DynamicReportDatasetCatalog',
        entityId: 'platform',
        action: 'UPDATE',
        before,
        after,
        sourceModule: 'reports',
        riskSeverity: 'medium',
        summary: 'Updated platform Dynamic Reports dataset catalog.',
      });
      return NextResponse.json({ ok: true, scope, catalog: after, ...metadata() });
    }
    if (!target) {
      return NextResponse.json({ error: 'Tenant scope is required' }, { status: 400 });
    }

    const before = await loadTenantDynamicReportDatasetCatalog(target);
    const overrides = await saveTenantDynamicReportDatasetCatalog(target, input);
    const catalog = await loadResolvedDynamicReportDatasetCatalog(target);
    await recordAdminChange({
      req,
      ctx,
      tenantId: target,
      entityType: 'DynamicReportDatasetCatalog',
      entityId: target,
      action: 'UPDATE',
      before,
      after: overrides,
      sourceModule: 'reports',
      riskSeverity: 'medium',
      summary: 'Updated tenant Dynamic Reports dataset catalog.',
    });
    return NextResponse.json({ ok: true, scope: 'tenant', tenantId: target, catalog, overrides, ...metadata() });
  } catch (error) {
    console.error('[admin-reports-datasets.PATCH]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update dataset catalog' },
      { status: 500 },
    );
  }
}
