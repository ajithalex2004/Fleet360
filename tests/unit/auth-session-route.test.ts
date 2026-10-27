/**
 * POST /api/auth/session re-issues the caller's OWN session only.
 *
 * The path is public in the middleware, so the handler is the whole
 * authentication. It used to sign an xl-session for whatever
 * { userId, tenantId } the body named, with no credential: anyone who knew
 * a user's id (every colleague does) became that user, SUPER_ADMIN included.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; tenantId: string; role: string; impersonatedBy?: string },
  signed: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/tenant-session', () => ({
  verifySession: vi.fn(async (token: string) => (token === 'valid' ? state.session : null)),
  signSession: vi.fn(async (payload: Record<string, unknown>) => {
    state.signed.push(payload);
    return 'new-token';
  }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => unknown) => fn({
    userTenant: {
      findUnique: async ({ where }: { where: { userId_tenantId: { userId: string; tenantId: string } } }) => ({
        isActive: true,
        tenant: { id: where.userId_tenantId.tenantId, name: 'T', code: 'T', plan: 'PRO', domain: null, isActive: true, modules: [] },
        user: { id: where.userId_tenantId.userId, username: 'u', email: 'u@x', firstName: null, lastName: null, isActive: true },
        role: { id: 'r', name: 'Role', code: 'TENANT_ADMIN' },
      }),
    },
  }),
}));
vi.mock('@/lib/authz/session-permissions', () => ({ sessionPermissionsFor: async () => [] }));
vi.mock('@/lib/db-router', () => ({ residencyClaimForTenant: async () => ({}) }));
vi.mock('@/lib/module-policies', () => ({ tenantModulesFor: async () => [] }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/session/route';

function post(body: Record<string, unknown>, cookie?: string) {
  return POST(new NextRequest('http://localhost/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `xl-session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/auth/session', () => {
  beforeEach(() => {
    state.session = { userId: 'me', tenantId: 'tenant-a', role: 'MEMBER' };
    state.signed.length = 0;
  });

  it('refuses a caller with no session (the old account-takeover path)', async () => {
    const res = await post({ userId: 'admin', tenantId: 'tenant-a' });
    expect(res.status).toBe(401);
    expect(state.signed).toHaveLength(0);
  });

  it('refuses a forged, expired or revoked session', async () => {
    const res = await post({ userId: 'me', tenantId: 'tenant-a' }, 'forged');
    expect(res.status).toBe(401);
    expect(state.signed).toHaveLength(0);
  });

  it('refuses to issue a session for another user', async () => {
    const res = await post({ userId: 'admin', tenantId: 'tenant-a' }, 'valid');
    expect(res.status).toBe(403);
    expect(state.signed).toHaveLength(0);
  });

  it('re-issues the caller’s own session for a tenant they belong to', async () => {
    const res = await post({ userId: 'me', tenantId: 'tenant-b' }, 'valid');
    expect(res.status).toBe(200);
    expect(state.signed).toEqual([expect.objectContaining({ userId: 'me', tenantId: 'tenant-b' })]);
    expect(res.headers.get('set-cookie')).toContain('xl-session=new-token');
  });

  it('leaves an impersonation session as it is instead of re-signing it', async () => {
    state.session = { userId: 'me', tenantId: 'tenant-a', role: 'MEMBER', impersonatedBy: 'root' };
    const res = await post({ userId: 'me', tenantId: 'tenant-a' }, 'valid');
    expect(res.status).toBe(200);
    expect(state.signed).toHaveLength(0);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('does not let an impersonation session switch tenant', async () => {
    state.session = { userId: 'me', tenantId: 'tenant-a', role: 'MEMBER', impersonatedBy: 'root' };
    const res = await post({ userId: 'me', tenantId: 'tenant-b' }, 'valid');
    expect(res.status).toBe(403);
    expect(state.signed).toHaveLength(0);
  });
});
