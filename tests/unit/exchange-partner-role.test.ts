/**
 * The Partner tenant role (PARTNER): staff of a transport partner are users
 * of the tenant that onboarded the partner, but may use only the partner
 * portal. Tenant APIs are not gated by role permissions, so the middleware
 * confines a PARTNER session: other APIs answer 403 and other pages redirect
 * to the partner dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/tenant-session';
import { partnerRoleAllows, PARTNER_HOME, PARTNER_TENANT_ROLE } from '@/lib/exchange/partner-role';
import { SYSTEM_ROLES } from '@/lib/permissions';

const TENANT = '11111111-1111-4111-8111-111111111111';

async function request(pathname: string, role: string, method = 'GET') {
  const token = await signSession({ userId: 'user-1', tenantId: TENANT, plan: 'ENTERPRISE', role });
  return middleware(new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { cookie: `xl-session=${token}` },
  }));
}

describe('partnerRoleAllows', () => {
  it.each([
    '/api/exchange/partner/me',
    '/api/exchange/marketplace',
    '/api/exchange/statements/abc/pdf',
    '/api/auth/session',
    '/api/auth/logout',
    '/exchange/dashboard',
    '/exchange/compliance',
    '/invitation/token',
    '/login',
    '/icons/logo.png',
    '/manifest.json',
  ])('allows %s', (p) => expect(partnerRoleAllows(p)).toBe(true));

  it.each([
    '/api/fleet/vehicles',
    '/api/finance/payables',
    '/api/bus-ops/outsource/settlements',
    '/api/files/tenant/doc.pdf',
    '/api/admin/users',
    '/api/exchangeX',
    '/platform',
    '/fleet',
    '/finance/payables',
    '/admin/users',
    '/exchanges',
  ])('refuses %s', (p) => expect(partnerRoleAllows(p)).toBe(false));
});

describe('middleware with a PARTNER session', () => {
  // Sessions here carry no permission claim: this tests partner confinement,
  // not the authorization policy (which defaults to enforce).
  beforeEach(() => { vi.stubEnv('AUTHZ_MODE', 'report'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('refuses the tenant\'s own APIs with 403', async () => {
    for (const p of ['/api/fleet/vehicles', '/api/finance/payables', '/api/bus-ops/outsource/settlements']) {
      const res = await request(p, PARTNER_TENANT_ROLE);
      expect(res.status, p).toBe(403);
      expect((await res.json()).message).toMatch(/partner portal/);
    }
  });

  it('sends the tenant\'s pages to the partner dashboard', async () => {
    for (const p of ['/platform', '/fleet', '/finance/payables?x=1']) {
      const res = await request(p, PARTNER_TENANT_ROLE);
      expect(res.status, p).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname).toBe(PARTNER_HOME);
      expect(new URL(res.headers.get('location')!).search).toBe('');
    }
  });

  it('refuses the tenant\'s stored files behind /uploads', async () => {
    const res = await request('/uploads/vehicles/registration.pdf', PARTNER_TENANT_ROLE);
    expect(res.status).toBe(403);
  });

  it('lets the partner portal and its APIs through', async () => {
    for (const p of ['/exchange/dashboard', '/api/exchange/partner/me']) {
      const res = await request(p, PARTNER_TENANT_ROLE);
      expect(res.status, p).toBe(200);
    }
  });

  it('leaves other roles alone', async () => {
    const res = await request('/api/fleet/vehicles', 'VIEWER');
    expect(res.status).toBe(200);
    expect((await request('/platform', 'VIEWER')).status).toBe(200);
    expect((await request('/uploads/vehicles/registration.pdf', 'VIEWER')).status).toBe(200);
  });
});

describe('Partner role template', () => {
  it('grants no permissions in the tenant\'s own modules', () => {
    const partner = SYSTEM_ROLES.find((r) => r.code === 'PARTNER');
    expect(partner).toBeDefined();
    expect(partner!.name).toBe('Partner');
    expect(partner!.permissions).toEqual([]);
  });
});
