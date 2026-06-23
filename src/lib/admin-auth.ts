import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type AdminRole = 'SUPER_ADMIN' | 'TENANT_ADMIN';

export interface AdminContext {
  userId: string;
  tenantId: string;
  role: string;
  isSuperAdmin: boolean;
  isTenantAdmin: boolean;
}

export function getAdminContext(req: NextRequest): AdminContext | NextResponse {
  const userId = req.headers.get('x-user-id') ?? '';
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';

  if (!userId || !tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return {
    userId,
    tenantId,
    role,
    isSuperAdmin: role === 'SUPER_ADMIN',
    isTenantAdmin: role === 'TENANT_ADMIN',
  };
}

export function requireAdminRole(req: NextRequest, roles: AdminRole[]): AdminContext | NextResponse {
  const ctx = getAdminContext(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!roles.includes(ctx.role as AdminRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return ctx;
}

export async function assertUserInTenant(userId: string, tenantId: string): Promise<boolean> {
  const count = await prisma.userTenant.count({
    where: { userId, tenantId, isActive: true },
  });
  return count > 0;
}
