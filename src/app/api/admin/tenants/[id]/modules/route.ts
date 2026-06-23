import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, requireDangerApproval, normalizeModuleKey, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import { MODULES } from '@/lib/permissions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'view', 'tenants');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const tenantId = resolveTenantBoundary(auth.ctx, id);
  if (tenantId instanceof NextResponse) return tenantId;

  const modules = await prisma.tenantModule.findMany({ where: { tenantId } });
  return NextResponse.json(modules);
}

// PUT: replace all module assignments
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminPermission(req, 'edit', 'tenants');
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const tenantId = resolveTenantBoundary(auth.ctx, id);
  if (tenantId instanceof NextResponse) return tenantId;
  const approval = await requireDangerApproval(req, auth.ctx, 'tenant.modules.update', {
    tenantId,
    targetType: 'TenantModules',
    targetId: tenantId,
    summary: `Update enabled modules for tenant ${tenantId}.`,
  });
  if (approval) return approval;

  try {
    const { enabledModules }: { enabledModules: string[] } = await req.json();
    const before = await prisma.tenantModule.findMany({ where: { tenantId } });
    const modules = Array.from(new Set((enabledModules ?? []).map(normalizeModuleKey)));
    const invalidModules = modules.filter(m => !(MODULES as readonly string[]).includes(m));
    if (invalidModules.length) {
      return NextResponse.json(
        { error: `Invalid module keys: ${invalidModules.join(', ')}. Valid modules: ${MODULES.join(', ')}` },
        { status: 400 },
      );
    }
    await prisma.$transaction([
      prisma.tenantModule.deleteMany({ where: { tenantId } }),
      prisma.tenantModule.createMany({
        data: modules.map(m => ({ tenantId, module: m, isEnabled: true })),
      }),
    ]);
    const after = await prisma.tenantModule.findMany({ where: { tenantId } });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'TenantModules',
      entityId: tenantId,
      action: 'UPDATE',
      before,
      after,
      summary: `Updated enabled modules for tenant ${tenantId}.`,
    });
    return NextResponse.json(after);
  } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
