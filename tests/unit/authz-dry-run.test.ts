/**
 * Authorization dry run (src/lib/authz/dry-run.ts): the middleware answers
 * the admin gate and policy decision in headers, 204, and nothing
 * else runs.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';

let middleware: typeof import('@/middleware').middleware;
let signSession: typeof import('@/lib/tenant-session').signSession;
let POLICY_VERSION: string;

beforeAll(async () => {
  ({ middleware } = await import('@/middleware'));
  ({ signSession } = await import('@/lib/tenant-session'));
  ({ POLICY_VERSION } = await import('@/lib/authz/policy'));
});
afterEach(() => { vi.unstubAllEnvs(); });

const TENANT = '11111111-1111-4111-8111-111111111111';

async function dry(method: string, path: string, role: string, permissions: string[], extraCookie = '') {
  const token = await signSession({ userId: 'u1', tenantId: TENANT, plan: 'PRO', role, permissions });
  return middleware(new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: `xl-session=${token}${extraCookie}`, 'x-authz-dry-run': '1' },
  }));
}

const headersOf = (res: Response) => Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-authz') || k.startsWith('x-step-up')));

describe('dry run', () => {
  it('answers the policy decision without running the request', async () => {
    vi.stubEnv('AUTHZ_MODE', 'report');
    const res = await dry('POST', '/api/fleet/vehicles', 'VIEWER', ['fleet:view:*']);
    expect(res.status).toBe(204);
    // Not NextResponse.next(): the request goes no further.
    expect(res.headers.get('x-middleware-next')).toBeNull();
    expect(headersOf(res)).toMatchObject({
      'x-authz-backend': 'next', 'x-authz-policy': POLICY_VERSION, 'x-authz-mode': 'report',
      'x-authz-decision': 'deny', 'x-authz-reason': 'missing-permission', 'x-authz-area': 'fleet',
      'x-authz-required': 'fleet:create:vehicles', 'x-authz-outcome': 'allowed',
    });
    expect((await dry('GET', '/api/fleet/vehicles', 'VIEWER', ['fleet:view:*'])).headers.get('x-authz-decision')).toBe('allow');
  });

  it('reports what a real request would meet: enforce refuses, the admin gate always refuses', async () => {
    vi.stubEnv('AUTHZ_MODE', 'enforce');
    expect((await dry('POST', '/api/fleet/vehicles', 'VIEWER', ['fleet:view:*'])).headers.get('x-authz-outcome')).toBe('refused');
    const gate = await dry('POST', '/api/admin/users', 'DISPATCHER', []);
    expect(headersOf(gate)).toMatchObject({ 'x-authz-decision': 'deny', 'x-authz-reason': 'admin-gate:platform', 'x-authz-outcome': 'refused' });
  });

  it('decides admin actions by role alone: no passkey step-up', async () => {
    const res = await dry('POST', '/api/admin/users/set-password', 'SUPER_ADMIN', ['*:*:*']);
    expect(headersOf(res)).toMatchObject({ 'x-authz-decision': 'allow', 'x-authz-outcome': 'allowed' });
    expect(res.headers.get('x-step-up')).toBeNull();
  });

  it('needs a session, like any API request', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/fleet/vehicles', { headers: { 'x-authz-dry-run': '1' } }));
    expect(res.status).toBe(401);
  });
});
