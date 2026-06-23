import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { type AdminContext, requireAdminRole } from '@/lib/admin-auth';
import { requireApprovedAdminAction } from '@/lib/admin-approvals';
import { isSessionRevoked } from '@/lib/session-registry';

export const ADMIN_NAV_RESOURCES = {
  overview: '*',
  users: 'users',
  roles: 'roles',
  tenants: 'tenants',
  branches: 'branches',
  billing: 'billing',
  workflows: 'workflows',
  esign: 'integrations',
  whatsapp: 'integrations',
  dispatch: 'dispatch',
  'audit-logs': 'audit',
  'service-config': 'service_config',
  'platform-info': 'platform',
  notifications: 'platform',
  integrations: 'integrations',
  settings: 'platform',
  security: 'security',
} as const;

export type AdminNavKey = keyof typeof ADMIN_NAV_RESOURCES;

const MODULE_ALIASES: Record<string, string> = {
  driver: 'drivers',
  drivers: 'drivers',
  'driver-mgmt': 'drivers',
  bus_ops: 'bus_ops',
  'bus-ops': 'bus_ops',
  staff: 'bus_ops',
  school_bus: 'bus_ops',
  'school-bus': 'bus_ops',
  rental: 'rac',
  rac: 'rac',
  rent_a_car: 'rac',
  incident: 'compliance',
  incidents: 'compliance',
  booking: 'rac',
  logistics: 'bus_ops',
};

export function normalizeModuleKey(key: string): string {
  return MODULE_ALIASES[key] ?? key;
}

export function hasPermission(keys: string[], module: string, action: string, resource = '*'): boolean {
  if (keys.includes('*:*:*')) return true;
  return (
    keys.includes(`${module}:${action}:${resource}`) ||
    keys.includes(`${module}:${action}:*`) ||
    keys.includes(`${module}:*:*`)
  );
}

export async function getAdminPermissionKeys(userId: string, tenantId: string, roleCode?: string): Promise<string[]> {
  if (roleCode === 'SUPER_ADMIN') return ['*:*:*'];
  const tenantAdminDefaults = roleCode === 'TENANT_ADMIN'
    ? [
        'admin:view:*',
        'admin:view:users',
        'admin:create:users',
        'admin:edit:users',
        'admin:delete:users',
        'admin:view:roles',
        'admin:create:roles',
        'admin:edit:roles',
        'admin:delete:roles',
        'admin:view:tenants',
        'admin:edit:tenants',
        'admin:view:branches',
        'admin:create:branches',
        'admin:edit:branches',
        'admin:delete:branches',
        'admin:view:billing',
        'admin:view:workflows',
        'admin:create:workflows',
        'admin:edit:workflows',
        'admin:delete:workflows',
        'admin:view:audit',
        'admin:create:audit',
        'admin:view:security',
        'admin:edit:security',
        'admin:view:service_config',
        'admin:create:service_config',
        'admin:edit:service_config',
        'admin:delete:service_config',
      ]
    : [];

  const membership = await prisma.userTenant.findFirst({
    where: { userId, tenantId, isActive: true },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const rolePerms = membership?.role.permissions.map(rp =>
    `${rp.permission.module}:${rp.permission.action}:${rp.permission.resource ?? '*'}`,
  ) ?? [];
  return Array.from(new Set([...tenantAdminDefaults, ...rolePerms]));
}

export async function getAdminPolicy(ctx: AdminContext) {
  const permissions = await getAdminPermissionKeys(ctx.userId, ctx.tenantId, ctx.role);
  const can = (action: string, resource = '*') =>
    ctx.isSuperAdmin || hasPermission(permissions, 'admin', action, resource);

  const nav: Record<string, boolean> = {};
  for (const [key, resource] of Object.entries(ADMIN_NAV_RESOURCES)) {
    nav[key] = ctx.isSuperAdmin || can('view', resource);
  }

  return { permissions, can, nav };
}

export async function requireAdminPermission(
  req: NextRequest,
  action: string,
  resource = '*',
): Promise<{ ctx: AdminContext; permissions: string[] } | NextResponse> {
  const ctx = requireAdminRole(req, ['SUPER_ADMIN', 'TENANT_ADMIN']);
  if (ctx instanceof NextResponse) return ctx;

  const sessionId = req.headers.get('x-session-id');
  if (sessionId && await isSessionRevoked(sessionId)) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Session has been revoked' }, { status: 401 });
  }

  const policy = await getAdminPolicy(ctx);
  if (!policy.can(action, resource)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { ctx, permissions: policy.permissions };
}

export function resolveTenantBoundary(
  ctx: AdminContext,
  requestedTenantId?: string | null,
): string | NextResponse {
  if (ctx.isSuperAdmin) {
    return requestedTenantId || ctx.tenantId;
  }
  if (requestedTenantId && requestedTenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return ctx.tenantId;
}

export function requireDangerConfirmation(req: NextRequest, action: string): NextResponse | null {
  const confirmed = req.headers.get('x-admin-confirm-action') ?? '';
  if (confirmed !== action) {
    return NextResponse.json(
      {
        error: 'Approval required',
        action,
        message: `Repeat the request with x-admin-confirm-action: ${action}.`,
      },
      { status: 428 },
    );
  }
  return null;
}

export async function requireDangerApproval(
  req: NextRequest,
  ctx: AdminContext,
  action: string,
  details?: {
    tenantId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    summary?: string | null;
    payload?: unknown;
    requiredApprovals?: number;
  },
): Promise<NextResponse | null> {
  return requireApprovedAdminAction(req, ctx, action, details);
}
