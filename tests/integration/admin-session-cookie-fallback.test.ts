/**
 * Regression test for the "clicking Logistics logs me out" bug.
 *
 * Root cause: /api/admin/session is in the middleware's PUBLIC route list,
 * so the middleware passes it through WITHOUT injecting x-user-id /
 * x-tenant-id headers. The handler required those headers and returned 401.
 * PermissionContext then treated that 401 as "session invalid" and deleted
 * the stored session — logging the user out the moment they opened a
 * ModuleGuard-protected module like Logistics.
 *
 * Fix: the handler now falls back to verifying the xl-session cookie
 * directly when the injected headers are absent. This test proves a request
 * carrying a valid cookie but NO injected headers authenticates (200)
 * instead of 401.
 *
 * Calls the route handler directly with direct Prisma — does not depend on
 * the (sometimes slow) dev server. Uses a real existing account looked up at
 * runtime, so it doesn't need to create fixtures in the complex users table.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { signSession } from '@/lib/tenant-session';
import { GET as adminSessionGET } from '@/app/api/admin/session/route';

const prisma = new PrismaClient();

let account: { userId: string; tenantId: string; role: string; plan: string } | null = null;

beforeAll(async () => {
  // Two simple queries instead of a fragile multi-join — find any active
  // assignment, then resolve its role code. The signed cookie's `plan` value
  // is not validated against the tenant by the handler (it reads tenant.plan
  // from the DB), so any string is fine for signing.
  const ut = await prisma.$queryRawUnsafe<Array<{ user_id: string; tenant_id: string; role_id: string }>>(
    `SELECT user_id, tenant_id, role_id FROM user_tenants WHERE is_active = TRUE LIMIT 1`,
  ).catch(() => []);
  if (ut[0]) {
    const role = await prisma.$queryRawUnsafe<Array<{ code: string }>>(
      `SELECT code FROM roles WHERE id = $1 LIMIT 1`, ut[0].role_id,
    ).catch(() => []);
    account = {
      userId: ut[0].user_id,
      tenantId: ut[0].tenant_id,
      role: role[0]?.code ?? 'TENANT_ADMIN',
      plan: 'ENTERPRISE',
    };
  }
}, 60_000);

afterAll(async () => { await prisma.$disconnect(); });

function reqFor(a: { userId: string; tenantId: string }, opts: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(
    `http://localhost/api/admin/session?userId=${a.userId}&tenantId=${a.tenantId}`,
    { headers },
  );
}

describe('/api/admin/session cookie fallback (logout regression)', () => {
  it('authenticates via the xl-session cookie when middleware injected no headers', async () => {
    if (!account) { console.warn('no active account in DB — skipping'); return; }
    const token = await signSession({
      userId: account.userId, tenantId: account.tenantId,
      plan: account.plan, role: account.role,
    });
    const res = await adminSessionGET(reqFor(account, { cookie: `xl-session=${token}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(account.userId);
    expect(body.tenant.id).toBe(account.tenantId);
  }, 60_000);

  it('still returns 401 with neither headers nor a cookie (unchanged behaviour)', async () => {
    if (!account) return;
    const res = await adminSessionGET(reqFor(account));
    expect(res.status).toBe(401);
  }, 30_000);

  it('still works on the normal path when middleware DID inject headers', async () => {
    if (!account) return;
    const res = await adminSessionGET(reqFor(account, {
      headers: { 'x-user-id': account.userId, 'x-tenant-id': account.tenantId, 'x-user-role': account.role },
    }));
    expect(res.status).toBe(200);
  }, 60_000);

  it('rejects a tampered/garbage cookie with 401 (no false auth)', async () => {
    if (!account) return;
    const res = await adminSessionGET(reqFor(account, { cookie: 'xl-session=not.a.valid.token' }));
    expect(res.status).toBe(401);
  }, 30_000);
});
