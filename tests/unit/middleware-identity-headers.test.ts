/**
 * tests/unit/middleware-identity-headers.test.ts
 *
 * Regression tests for the cross-tenant header-forging hole: public routes
 * (PUBLIC_PREFIXES in src/lib/auth-route-policies.ts) used to receive the
 * client's own x-tenant-id / x-user-id / x-user-role headers unchanged, and
 * requireAuthorizedTenant() trusted them. An unauthenticated caller could
 * write into any tenant through e.g. /api/driver-app/emergency-sos.
 *
 * What is tested:
 *  - Middleware strips client-sent identity headers on public routes,
 *    on unauthenticated fall-through and on authenticated routes
 *  - Driver-app routes get the identity of a verified session cookie
 *  - A CRON_SECRET caller keeps its headers (the job scheduler relies on it)
 *  - The three driver-app write endpoints reject forged-header requests
 *
 * How forwarded headers are observed: NextResponse.next({ request: { headers } })
 * encodes the upstream request headers as `x-middleware-request-<name>`
 * response headers, listed in `x-middleware-override-headers`.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

// vitest.config.ts aliases next/server to a minimal stub with no cookies API
// and no NextResponse.next(). Middleware and the driver-session check need
// both, so use the real module for everything this file imports.
vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/tenant-session';
import { IDENTITY_HEADERS, stripIdentityHeaders } from '@/lib/identity-headers';
import { POST as emergencySos } from '@/app/api/driver-app/emergency-sos/route';
import { POST as liveLocation } from '@/app/api/driver-app/telematics/live-location/route';
import { POST as nrmToggle } from '@/app/api/driver-app/nrm-toggle/route';
import { GET as authMe } from '@/app/api/auth/me/route';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const FORGED = {
  'x-tenant-id': TENANT_B,
  'x-user-id': 'attacker',
  'x-user-role': 'SUPER_ADMIN',
  'x-role': 'SUPER_ADMIN',
  'x-tenant-plan': 'ENTERPRISE',
  'x-impersonated-by': 'attacker',
  'x-data-residency': 'US',
  'x-user-email': 'attacker@example.com',
  'x-user-name': 'Attacker',
};

function req(path: string, headers: Record<string, string> = {}, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

/** The upstream request header value middleware forwards, or null. */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

let driverCookieA: string;

beforeAll(async () => {
  driverCookieA = await signSession({
    userId: 'driver-a',
    tenantId: TENANT_A,
    plan: 'STANDARD',
    role: 'DRIVER',
  });
});

const savedCronSecret = process.env.CRON_SECRET;
afterEach(() => {
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
});

describe('stripIdentityHeaders', () => {
  it('removes every identity header and keeps the rest', () => {
    const out = stripIdentityHeaders(new Headers({ ...FORGED, 'content-type': 'application/json' }));
    for (const name of IDENTITY_HEADERS) expect(out.get(name)).toBeNull();
    expect(out.get('content-type')).toBe('application/json');
  });
});

describe('middleware — public routes', () => {
  it('strips forged identity headers on a driver-app route with no session', async () => {
    const res = await middleware(req('/api/driver-app/emergency-sos', FORGED));
    expect(res.status).toBe(200);
    for (const name of IDENTITY_HEADERS) expect(forwarded(res, name)).toBeNull();
  });

  it('strips forged identity headers on other public API prefixes', async () => {
    for (const path of [
      '/api/carrier-portal/resolve',
      '/api/shipper-portal/me',
      '/api/push/run-scheduler',
      '/api/cron/outbox-publish',
      '/api/bus-ops/gateway/events',
    ]) {
      const res = await middleware(req(path, FORGED));
      expect(forwarded(res, 'x-tenant-id'), path).toBeNull();
      expect(forwarded(res, 'x-user-role'), path).toBeNull();
    }
  });

  it('injects the verified driver session tenant, not the forged one', async () => {
    const res = await middleware(req('/api/driver-app/emergency-sos', {
      ...FORGED,
      cookie: `xl-driver-session=${driverCookieA}`,
    }));
    expect(forwarded(res, 'x-tenant-id')).toBe(TENANT_A);
    expect(forwarded(res, 'x-user-id')).toBe('driver-a');
    expect(forwarded(res, 'x-user-role')).toBe('DRIVER');
    expect(forwarded(res, 'x-data-residency')).toBeNull();
    expect(forwarded(res, 'x-impersonated-by')).toBeNull();
  });

  it('ignores an invalid driver cookie and strips forged headers', async () => {
    const res = await middleware(req('/api/driver-app/emergency-sos', {
      ...FORGED,
      cookie: 'xl-driver-session=not-a-valid-token',
    }));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
  });

  it('does not inject driver identity outside /api/driver-app/', async () => {
    const res = await middleware(req('/api/carrier-portal/resolve', {
      cookie: `xl-driver-session=${driverCookieA}`,
    }));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
  });
});

describe('middleware — CRON_SECRET callers', () => {
  it('preserves only an untrusted target on public scheduler routes', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789abcdef';
    const res = await middleware(req('/api/cron/outbox-publish', {
      authorization: 'Bearer cron-secret-for-tests-0123456789abcdef',
      'x-tenant-id': TENANT_A,
    }));
    expect(res.status).toBe(200);
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
    expect(forwarded(res, 'x-requested-tenant-id')).toBe(TENANT_A);
  });

  it('strips headers when the bearer does not match', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789abcdef';
    const res = await middleware(req('/api/cron/outbox-publish', {
      authorization: 'Bearer wrong',
      'x-tenant-id': TENANT_A,
    }));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
  });

  it('never matches when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await middleware(req('/api/cron/outbox-publish', {
      authorization: 'Bearer ',
      'x-tenant-id': TENANT_A,
    }));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
  });
});

describe('middleware — other paths', () => {
  it('strips forged headers on unauthenticated non-API fall-through', async () => {
    const res = await middleware(req('/some-asset.txt', FORGED, 'GET'));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
  });

  it('replaces forged headers with the session identity on authenticated routes', async () => {
    const operator = await signSession({
      userId: 'operator-a',
      tenantId: TENANT_A,
      plan: 'STANDARD',
      role: 'DISPATCHER',
      permissions: ['bus-ops:view:trips'],
    });
    const res = await middleware(req('/api/bus-ops/schedules', {
      ...FORGED,
      cookie: `xl-session=${operator}`,
    }, 'GET'));
    expect(forwarded(res, 'x-tenant-id')).toBe(TENANT_A);
    expect(forwarded(res, 'x-user-role')).toBe('DISPATCHER');
    expect(forwarded(res, 'x-data-residency')).toBeNull();
    expect(forwarded(res, 'x-impersonated-by')).toBeNull();
    expect(forwarded(res, 'x-user-email')).toBeNull();
    expect(forwarded(res, 'x-role')).toBeNull();
  });
});

describe('driver-app write endpoints reject forged tenants', () => {
  const handlers = {
    'emergency-sos': emergencySos,
    'telematics/live-location': liveLocation,
    'nrm-toggle': nrmToggle,
  } as const;

  for (const [name, handler] of Object.entries(handlers)) {
    it(`${name}: 401 with a forged x-tenant-id and no session`, async () => {
      const res = await handler(req(`/api/driver-app/${name}`, {
        'x-tenant-id': TENANT_B,
        'x-user-id': 'attacker',
        'content-type': 'application/json',
      }));
      expect(res.status).toBe(401);
    });

    it(`${name}: 403 when the session belongs to a different tenant`, async () => {
      const res = await handler(req(`/api/driver-app/${name}`, {
        'x-tenant-id': TENANT_B,
        'x-user-id': 'driver-a',
        cookie: `xl-driver-session=${driverCookieA}`,
        'content-type': 'application/json',
      }));
      expect(res.status).toBe(403);
    });
  }
});

describe('middleware — sessions without a role', () => {
  it('rejects a signed operator session that has no role instead of treating it as TENANT_ADMIN', async () => {
    const noRole = await signSession({
      userId: 'operator-a',
      tenantId: TENANT_A,
      plan: 'STANDARD',
      role: undefined as unknown as string,
    });
    const res = await middleware(req('/api/bus-ops/schedules', {
      cookie: `xl-session=${noRole}`,
    }, 'GET'));
    expect(res.status).toBe(401);
  });

  it('does not inject driver identity from a role-less driver session', async () => {
    const noRole = await signSession({
      userId: 'driver-a',
      tenantId: TENANT_A,
      plan: 'STANDARD',
      role: undefined as unknown as string,
    });
    const res = await middleware(req('/api/driver-app/emergency-sos', {
      cookie: `xl-driver-session=${noRole}`,
    }));
    expect(forwarded(res, 'x-tenant-id')).toBeNull();
    expect(forwarded(res, 'x-user-role')).toBeNull();
  });
});

describe('/api/auth/me — no role, no identity', () => {
  it('returns 401 when the request has user and tenant but no role', async () => {
    const res = await authMe(req('/api/auth/me', {
      'x-user-id': 'operator-a',
      'x-tenant-id': TENANT_A,
    }, 'GET'));
    expect(res.status).toBe(401);
  });
});
