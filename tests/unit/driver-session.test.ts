/**
 * tests/unit/driver-session.test.ts
 *
 * Unit tests for src/lib/driver-session.ts — the helper that the
 * driver-app API routes use to authenticate requests.
 *
 * What is tested:
 *  - getDriverTenantContext() with no cookies → null
 *  - getDriverTenantContext() with a valid xl-driver-session → context
 *  - getDriverTenantContext() with a valid xl-session → context
 *  - getDriverTenantContext() with BOTH cookies, driver valid → uses driver
 *  - getDriverTenantContext() with BOTH cookies, driver invalid + admin valid
 *    → falls back to admin (this is the bug-fix case — the user had a
 *    stale xl-driver-session that was 401-ing even though a fresh
 *    xl-session was right there in the cookie jar)
 *  - getDriverTenantContext() with both invalid → null
 *  - getDriverTenantContext() with empty-string cookies → null
 *
 * Prerequisites:
 *  - SESSION_SECRET env var (set by tests/setup.ts from .env.test)
 *  - Web Crypto available (polyfilled in setup.ts for Node < 20)
 */
import { describe, it, expect } from 'vitest';
import { signSession } from '@/lib/tenant-session';
import { getDriverTenantContext, requireDriverSession } from '@/lib/driver-session';

// Mock a minimal NextRequest — we only need the cookies API.
// Return type is intentionally omitted so it resolves to the same
// HasCookies interface the helper now accepts, avoiding a stale annotation.
function mockReq(cookies: Record<string, string | undefined>) {
  return {
    cookies: {
      get: (name: string) => {
        const v = cookies[name];
        return v === undefined ? undefined : { value: v };
      },
    },
  } as unknown as Parameters<typeof getDriverTenantContext>[0];
}

const PAYLOAD = {
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  plan: 'DRIVER',
  role: 'DRIVER',
};

describe('getDriverTenantContext()', () => {
  it('returns null when no cookies are present', async () => {
    const ctx = await getDriverTenantContext(mockReq({}));
    expect(ctx).toBeNull();
  });

  it('returns null when both cookies are empty strings', async () => {
    const ctx = await getDriverTenantContext(mockReq({
      'xl-driver-session': '',
      'xl-session': '',
    }));
    expect(ctx).toBeNull();
  });

  it('returns the context for a valid xl-driver-session', async () => {
    const token = await signSession(PAYLOAD);
    const ctx = await getDriverTenantContext(mockReq({ 'xl-driver-session': token }));
    expect(ctx).toEqual({
      userId: PAYLOAD.userId,
      tenantId: PAYLOAD.tenantId,
      plan: PAYLOAD.plan,
      role: PAYLOAD.role,
    });
  });

  it('returns the context for a valid xl-session', async () => {
    const token = await signSession(PAYLOAD);
    const ctx = await getDriverTenantContext(mockReq({ 'xl-session': token }));
    expect(ctx).toEqual({
      userId: PAYLOAD.userId,
      tenantId: PAYLOAD.tenantId,
      plan: PAYLOAD.plan,
      role: PAYLOAD.role,
    });
  });

  it('prefers xl-driver-session when BOTH are valid (driver cookie wins)', async () => {
    const driverToken = await signSession({ ...PAYLOAD, role: 'DRIVER' });
    const adminToken = await signSession({ ...PAYLOAD, role: 'SUPER_ADMIN' });
    const ctx = await getDriverTenantContext(mockReq({
      'xl-driver-session': driverToken,
      'xl-session': adminToken,
    }));
    expect(ctx?.role).toBe('DRIVER');
  });

  it('falls back to xl-session when xl-driver-session is invalid (stale/expired/malformed)', async () => {
    // This is the bug fix — previously the helper did
    // `driverToken || adminToken` and short-circuited on a stale
    // driver cookie. Now it tries both and uses whichever is valid.
    const validAdminToken = await signSession(PAYLOAD);
    const ctx = await getDriverTenantContext(mockReq({
      'xl-driver-session': 'garbage-not-a-real-token',
      'xl-session': validAdminToken,
    }));
    expect(ctx).toEqual({
      userId: PAYLOAD.userId,
      tenantId: PAYLOAD.tenantId,
      plan: PAYLOAD.plan,
      role: PAYLOAD.role,
    });
  });

  it('returns null when both cookies are invalid', async () => {
    const ctx = await getDriverTenantContext(mockReq({
      'xl-driver-session': 'garbage-driver',
      'xl-session': 'garbage-admin',
    }));
    expect(ctx).toBeNull();
  });

  it('falls back to xl-driver-session when xl-session is invalid', async () => {
    const validDriverToken = await signSession(PAYLOAD);
    const ctx = await getDriverTenantContext(mockReq({
      'xl-driver-session': validDriverToken,
      'xl-session': 'garbage-admin',
    }));
    expect(ctx).toEqual({
      userId: PAYLOAD.userId,
      tenantId: PAYLOAD.tenantId,
      plan: PAYLOAD.plan,
      role: PAYLOAD.role,
    });
  });
});

describe('requireDriverSession()', () => {
  it('returns a NextResponse with 401 when no session is present', async () => {
    const res = await requireDriverSession(mockReq({}));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    const body = await (res as Response).json();
    expect(body.error).toBe('session required');
  });

  it('returns the DriverTenantContext (not a Response) when a valid session is present', async () => {
    const token = await signSession(PAYLOAD);
    const ctx = await requireDriverSession(mockReq({ 'xl-session': token }));
    expect(ctx).not.toBeInstanceOf(Response);
    expect((ctx as { userId: string }).userId).toBe(PAYLOAD.userId);
  });
});
