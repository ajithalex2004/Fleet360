import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ next: vi.fn(), verify: vi.fn(), proxy: vi.fn() }));
vi.mock('next/server', () => ({ NextResponse: {
  next: mocks.next,
  json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init),
  redirect: (url: URL) => new Response(null, { status: 307, headers: { location: url.toString() } }),
} }));
vi.mock('@/lib/tenant-session', () => ({ verifySession: mocks.verify }));
vi.mock('@/lib/api-shim', () => ({ proxyToGoBackend: mocks.proxy }));
vi.mock('@/lib/rate-limit-scope', () => ({
  getRateLimiter: () => ({ cleanup() {}, check: async () => ({ allowed: true, remaining: 9, resetMs: Date.now() + 1000 }) }),
  computeRateLimit: () => ({ key: 'test', limit: 10, scope: 'tenant-path' }),
}));
import { middleware } from '@/middleware';
import { CRON_SESSION_BYPASS_PATHS } from '@/lib/auth-route-policies';

const forged = {
  'x-tenant-id': 'tenant-b', 'x-user-id': 'admin-b', 'x-user-role': 'SUPER_ADMIN',
  'x-role': 'SUPER_ADMIN', 'x-user-email': 'forged@example.com',
  'x-tenant-plan': 'ENTERPRISE', 'x-impersonated-by': 'root', 'x-data-residency': 'UAE',
};
function request(path: string, headers: Record<string, string> = {}, method = 'POST') {
  const url = new URL(`https://fleet.example${path}`);
  return { headers: new Headers(headers), method, nextUrl: Object.assign(url, { clone: () => new URL(url) }),
    cookies: { get: () => headers.cookie ? { value: headers.cookie } : undefined },
  } as unknown as NextRequest;
}
function forwarded(): Headers { return mocks.next.mock.calls.at(-1)![0].request.headers; }
beforeEach(() => {
  // These sessions carry no permission claim; this file tests identity
  // headers, not the authorization policy (which defaults to enforce).
  vi.stubEnv('AUTHZ_MODE', 'report');
  vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'scheduler-secret');
  mocks.verify.mockResolvedValue(null);
  mocks.proxy.mockResolvedValue({ proxied: false });
  mocks.next.mockImplementation(() => new Response(null));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('middleware identity header trust boundary', () => {
  it.each([
    '/api/push/subscribe', '/api/push/run-scheduler', '/api/cron/outbox-publish',
    '/api/jobs/run', '/api/driver-app/heartbeat', '/api/leasing-portal/me',
    '/api/shipper-portal/me', '/api/carrier-portal/me', '/api/webhooks/twilio',
    '/api/bus-ops/gateway/ingest', '/api/setup/super-admin', '/api/stripe/webhook',
  ])('strips identity headers before forwarding public domain %s', async path => {
    await middleware(request(path, { ...forged, authorization: 'Bearer device-credential', 'x-gateway-signature': 'signature' }));
    for (const key of Object.keys(forged)) expect(forwarded().has(key)).toBe(false);
    expect(forwarded().get('authorization')).toBe('Bearer device-credential');
    expect(forwarded().get('x-gateway-signature')).toBe('signature');
  });
  it('does not populate operator identity on public paths even with operator cookies', async () => {
    await middleware(request('/api/push/subscribe', { ...forged, cookie: 'session' }));
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(forwarded().has('x-user-id')).toBe(false);
    expect(forwarded().get('cookie')).toBe('session');
  });
  it('injects only verified identity into protected requests and the Go proxy', async () => {
    mocks.verify.mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-a', role: 'VIEWER', plan: 'STANDARD' });
    await middleware(request('/api/finance/invoices', { ...forged, cookie: 'session' }));
    expect(forwarded().get('x-tenant-id')).toBe('tenant-a');
    expect(forwarded().get('x-user-role')).toBe('VIEWER');
    for (const key of ['x-role', 'x-user-email', 'x-impersonated-by', 'x-data-residency']) expect(forwarded().has(key)).toBe(false);
    expect(mocks.proxy.mock.calls[0][1]).toBe(forwarded());
  });
  it('preserves verified impersonation/residency claims', async () => {
    vi.stubEnv('DATA_RESIDENCY_SERVED_REGIONS', 'EU');
    mocks.verify.mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-a', role: 'VIEWER', plan: 'STANDARD', impersonatedBy: 'real-admin', dataResidency: 'EU' });
    await middleware(request('/api/finance/invoices', { ...forged, cookie: 'session' }));
    expect(forwarded().get('x-impersonated-by')).toBe('real-admin');
    expect(forwarded().get('x-data-residency')).toBe('EU');
  });
  it('cron credentials do not grant a session on arbitrary APIs', async () => {
    const res = await middleware(request('/api/admin/tenants', { ...forged, authorization: 'Bearer scheduler-secret' }));
    expect(res.status).toBe(401); expect(mocks.next).not.toHaveBeenCalled();
  });
  it.each(CRON_SESSION_BYPASS_PATHS)('allows only authenticated scheduler POSTs to %s', async path => {
    expect((await middleware(request(path, { authorization: 'Bearer scheduler-secret' }))).status).toBe(200);
    expect(forwarded().has('x-tenant-id')).toBe(false);
    mocks.next.mockClear();
    expect((await middleware(request(path, { authorization: 'Bearer wrong' }))).status).toBe(401);
    expect(mocks.next).not.toHaveBeenCalled();
    expect((await middleware(request(path, { authorization: 'Bearer scheduler-secret' }, 'DELETE'))).status).toBe(401);
  });
  it('scoped scheduler calls retain target but cannot impersonate a user', async () => {
    await middleware(request('/api/leasing/fuel/sweep-bill', { ...forged, authorization: 'Bearer scheduler-secret' }));
    expect(forwarded().get('x-tenant-id')).toBe('tenant-b');
    expect(forwarded().get('x-user-id')).toBe('system:cron');
    expect(forwarded().get('x-user-role')).toBe('SYSTEM_JOB');
    expect(forwarded().has('x-role')).toBe(false);
  });
  it('public scheduler paths retain legacy targets only as untrusted selectors', async () => {
    await middleware(request('/api/push/run-scheduler', forged));
    expect(forwarded().has('x-tenant-id')).toBe(false);
    expect(forwarded().get('x-requested-tenant-id')).toBe('tenant-b');
  });
  it('strips headers on unknown/static fallthrough too', async () => {
    await middleware(request('/unknown.bin', forged, 'GET'));
    for (const key of Object.keys(forged)) expect(forwarded().has(key)).toBe(false);
  });
});
