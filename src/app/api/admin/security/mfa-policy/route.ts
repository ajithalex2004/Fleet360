import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission, requireDangerApproval, resolveTenantBoundary } from '@/lib/admin-policy';
import { getMfaPolicies, upsertMfaPolicy, type MfaPolicyScope } from '@/lib/mfa-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

function roleCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(v))));
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'security');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  if (tenantId) {
    const scoped = resolveTenantBoundary(auth.ctx, tenantId);
    if (scoped instanceof NextResponse) return scoped;
  }
  const policies = await getMfaPolicies(tenantId || auth.ctx.tenantId);
  return NextResponse.json(policies);
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'edit', 'security');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const scope = String(body.scope ?? 'TENANT').toUpperCase() as MfaPolicyScope;
  if (scope !== 'PLATFORM' && scope !== 'TENANT') {
    return NextResponse.json({ error: 'scope must be PLATFORM or TENANT' }, { status: 400 });
  }
  if (scope === 'PLATFORM' && !auth.ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Platform MFA policy requires super admin access' }, { status: 403 });
  }
  const tenantId = scope === 'TENANT'
    ? resolveTenantBoundary(auth.ctx, body.tenantId ? String(body.tenantId) : auth.ctx.tenantId)
    : null;
  if (tenantId instanceof NextResponse) return tenantId;

  const before = await getMfaPolicies(scope === 'TENANT' ? tenantId : auth.ctx.tenantId);
  const approval = await requireDangerApproval(req, auth.ctx, 'mfa-policy.update', {
    tenantId: scope === 'TENANT' ? tenantId : null,
    targetType: 'MfaPolicy',
    targetId: scope === 'TENANT' ? tenantId : 'platform',
    summary: `Update ${scope.toLowerCase()} MFA policy.`,
  });
  if (approval) return approval;

  const policy = await upsertMfaPolicy({
    scope,
    tenantId,
    requireAllUsers: !!body.requireAllUsers,
    requireAdminRoles: body.requireAdminRoles !== false,
    requiredRoleCodes: roleCodes(body.requiredRoleCodes),
    gracePeriodHours: Math.max(0, Number(body.gracePeriodHours ?? 0)),
    isEnabled: !!body.isEnabled,
    updatedBy: auth.ctx.userId,
  });

  await recordAdminChange({
    req,
    ctx: auth.ctx,
    tenantId: scope === 'TENANT' ? tenantId : null,
    entityType: 'MfaPolicy',
    entityId: policy.id ?? (scope === 'TENANT' ? tenantId : 'platform'),
    action: 'UPDATE',
    before,
    after: policy,
    summary: `Updated ${scope.toLowerCase()} MFA policy.`,
  });

  return NextResponse.json({ policy });
}
