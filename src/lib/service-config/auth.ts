/**
 * Shared authorization helper for /api/admin/service-config/* routes.
 * Same shape as /api/admin/tenants/[id]/ticket-types — SUPER_ADMIN, or that
 * tenant's TENANT_ADMIN. Throws by returning a NextResponse on failure.
 */

import { NextRequest, NextResponse } from 'next/server';

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
