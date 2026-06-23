/**
 * Shared authorization helper for /api/admin/service-config/* routes.
 * Same shape as /api/admin/tenants/[id]/ticket-types — SUPER_ADMIN, or that
 * tenant's TENANT_ADMIN. Throws by returning a NextResponse on failure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import type { AdminContext } from '@/lib/admin-auth';
import { recordAdminChange } from '@/lib/admin-change-history';

export type AuthOk     = { ok: true; tenantId: string; userId: string; role: string };
export type AuthFail   = { ok: false; res: NextResponse };
export type AuthResult = AuthOk | AuthFail;

export function authorizeServiceConfig(req: NextRequest): AuthResult {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId   = req.headers.get('x-user-id')   ?? '';
  const role     = req.headers.get('x-user-role') ?? '';
  if (!tenantId || !userId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  }
  // For now: any authenticated tenant user can read; only TENANT_ADMIN /
  // SUPER_ADMIN can write. Routes enforce the write check separately.
  return { ok: true, tenantId, userId, role };
}

export function requireAdmin(auth: AuthOk): { ok: true } | { ok: false; res: NextResponse } {
  if (auth.role === 'SUPER_ADMIN' || auth.role === 'TENANT_ADMIN') return { ok: true };
  return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
}

export async function requireServiceConfigPermission(
  req: NextRequest,
  action: 'view' | 'create' | 'edit' | 'delete',
): Promise<AuthOk | AuthFail> {
  const policy = await requireAdminPermission(req, action, 'service_config');
  if (policy instanceof NextResponse) return { ok: false, res: policy };
  return {
    ok: true,
    tenantId: policy.ctx.tenantId,
    userId: policy.ctx.userId,
    role: policy.ctx.role,
  };
}

export function toAdminContext(auth: AuthOk): AdminContext {
  return {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: auth.role,
    isSuperAdmin: auth.role === 'SUPER_ADMIN',
    isTenantAdmin: auth.role === 'TENANT_ADMIN',
  };
}

export async function requireServiceConfigApproval(
  req: NextRequest,
  auth: AuthOk,
  action: string,
  details: {
    targetType?: string | null;
    targetId?: string | null;
    summary?: string | null;
    payload?: unknown;
    requiredApprovals?: number;
  },
): Promise<NextResponse | null> {
  return requireDangerApproval(req, toAdminContext(auth), action, {
    tenantId: auth.tenantId,
    ...details,
  });
}

export async function recordServiceConfigChange(args: {
  req: NextRequest;
  auth: AuthOk;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  summary?: string;
}) {
  await recordAdminChange({
    req: args.req,
    ctx: toAdminContext(args.auth),
    tenantId: args.auth.tenantId,
    entityType: args.entityType,
    entityId: args.entityId,
    entityName: args.entityName,
    action: args.action,
    before: args.before,
    after: args.after,
    summary: args.summary,
  });
}
