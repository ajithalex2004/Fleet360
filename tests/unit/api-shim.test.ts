import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxyToGoBackend } from '@/lib/api-shim';

const originalJwtSecret = process.env.JWT_SECRET;

function migratedRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/logistics/sla', {
    method: 'GET',
    headers,
  });
}

describe('proxyToGoBackend — fail-closed JWT signing', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('returns a controlled 503 and never calls fetch when JWT_SECRET is unset for an authenticated request', async () => {
    delete process.env.JWT_SECRET;

    const result = await proxyToGoBackend(
      migratedRequest({ 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1', 'x-user-role': 'TENANT_ADMIN' }),
    );

    expect(result.proxied).toBe(true);
    expect(result.response?.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a controlled 503 and never calls fetch when JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';

    const result = await proxyToGoBackend(
      migratedRequest({ 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' }),
    );

    expect(result.proxied).toBe(true);
    expect(result.response?.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still signs and proxies normally when JWT_SECRET is valid', async () => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';

    const result = await proxyToGoBackend(
      migratedRequest({ 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' }),
    );

    expect(result.proxied).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [URL | string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toMatch(/^Bearer /);
  });

  it('does not attempt to sign (and is unaffected by JWT_SECRET) when the request carries no operator session — e.g. carrier-portal/driver-app', async () => {
    delete process.env.JWT_SECRET;

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/driver-app/whatever', { method: 'GET' }),
    );

    expect(result.proxied).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('proxyToGoBackend — routes with a confirmed, live Go handler are proxied', () => {
  // 2026-09-14: fleet360-backend is now deployed and reachable (see
  // docs/LOGISTICS_GO_MIGRATION_STATUS.md). Every path below was verified
  // against backend/main.go's route registration to have a real, matching
  // Go handler before being re-added to the shim's allowlist — re-enabling
  // proxying for a path with no backend handler would 404 real users, so
  // this list must never grow without that same check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it.each([
    ['GET', '/api/logistics/tracking'],
    ['GET', '/api/logistics/shipments'],
    ['POST', '/api/logistics/shipments'],
    ['GET', '/api/logistics/shipments/abc-123'],
    ['GET', '/api/logistics/rfqs'],
    ['GET', '/api/logistics/rfqs/abc-123/bids'],
    ['GET', '/api/logistics/carriers'],
    ['GET', '/api/logistics/carriers/abc-123'],
    ['GET', '/api/logistics/planner/plans'],
    ['GET', '/api/logistics/stops'],
    ['GET', '/api/logistics/route-legs'],
    ['GET', '/api/logistics/assignments'],
    ['GET', '/api/logistics/tracking-events'],
    ['GET', '/api/logistics/pod-events'],
    ['GET', '/api/logistics/telematics-events'],
    ['GET', '/api/logistics/exceptions'],
    ['GET', '/api/logistics/bids'],
    ['GET', '/api/logistics/carrier-scorecards'],
    ['GET', '/api/logistics/freight-charges'],
    ['GET', '/api/logistics/analytics'],
    ['GET', '/api/logistics/driver-stats'],
    ['GET', '/api/logistics/rates/quote'],
    ['GET', '/api/logistics/sla'],
  ])('%s %s is proxied to the Go backend', async (method, path) => {
    const result = await proxyToGoBackend(
      new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' },
      }),
    );

    expect(result.proxied).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.response?.headers.get('x-backend')).toBe('go');
  });

  it('a path with no Go handler at all is left unproxied (falls through to Next.js)', async () => {
    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/rate-contracts', {
        method: 'GET',
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' },
      }),
    );

    expect(result.proxied).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('proxyToGoBackend — kill switch & canary tenant controls', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    process.env.JWT_SECRET = 'a-valid-secret-that-is-long-enough';
    delete process.env.LOGISTICS_GO_PROXY_ENABLED;
    delete process.env.LOGISTICS_GO_CANARY_TENANT_IDS;
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.LOGISTICS_GO_PROXY_ENABLED;
    delete process.env.LOGISTICS_GO_CANARY_TENANT_IDS;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('immediately disables all Go proxying when LOGISTICS_GO_PROXY_ENABLED is false (kill switch)', async () => {
    process.env.LOGISTICS_GO_PROXY_ENABLED = 'false';

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'GET',
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' },
      }),
    );

    expect(result.proxied).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies only tenants listed in LOGISTICS_GO_CANARY_TENANT_IDS when canary allowlist is active', async () => {
    process.env.LOGISTICS_GO_CANARY_TENANT_IDS = 'canary-tenant-1, canary-tenant-2';

    // 1. Allowed canary tenant
    const canaryResult = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'GET',
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'canary-tenant-1' },
      }),
    );
    expect(canaryResult.proxied).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(canaryResult.response?.headers.get('x-backend')).toBe('go');

    fetchSpy.mockClear();

    // 2. Non-canary tenant falls through to Next.js
    const nonCanaryResult = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'GET',
        headers: { 'x-user-id': 'user-2', 'x-tenant-id': 'general-prod-tenant' },
      }),
    );
    expect(nonCanaryResult.proxied).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls through to Next.js when request has no tenant ID and canary allowlist is active', async () => {
    process.env.LOGISTICS_GO_CANARY_TENANT_IDS = 'canary-tenant-1';

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'GET',
      }),
    );
    expect(result.proxied).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('respects headersOverride when checking canary tenant', async () => {
    process.env.LOGISTICS_GO_CANARY_TENANT_IDS = 'canary-override-tenant';

    const overrideHeaders = new Headers();
    overrideHeaders.set('x-tenant-id', 'canary-override-tenant');
    overrideHeaders.set('x-user-id', 'user-1');

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', { method: 'GET' }),
      overrideHeaders,
    );
    expect(result.proxied).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('proxies all tenants when LOGISTICS_GO_CANARY_TENANT_IDS is unset or empty', async () => {
    process.env.LOGISTICS_GO_CANARY_TENANT_IDS = '';

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'GET',
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'any-tenant' },
      }),
    );
    expect(result.proxied).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 502 (proxied: true) on network failure and never falls back to Next.js (no duplicate writes)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await proxyToGoBackend(
      new NextRequest('http://localhost:3000/api/logistics/shipments', {
        method: 'POST',
        headers: { 'x-user-id': 'user-1', 'x-tenant-id': 'tenant-1' },
        body: JSON.stringify({ action: 'CREATE' }),
      }),
    );

    // proxied: true prevents falling through to Next.js route handler
    expect(result.proxied).toBe(true);
    expect(result.response?.status).toBe(502);
    const body = await result.response?.json();
    expect(body.error).toBe('Backend unavailable');
  });
});

