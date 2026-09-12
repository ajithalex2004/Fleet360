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
