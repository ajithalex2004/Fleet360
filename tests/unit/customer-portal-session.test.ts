import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// The guard reads the user and the customer's portal access through the users
// store; mock it so these tests cover the guard's decisions only.
const store = vi.hoisted(() => ({
  user: null as null | { id: string; tenantId: string; customerId: string; email: string; fullName: string | null; roles: Partial<Record<'FSM' | 'TRANSPORT', 'ADMIN' | 'REQUESTER' | 'VIEWER'>>; isActive: boolean; sessionVersion: number },
  portals: new Set<string>(),
}));
vi.mock('@/lib/customer-portal/users', () => ({
  getPortalUserById: async () => store.user,
  customerHasPortal: async (_t: string, _c: string, portal: string) => store.portals.has(portal),
}));

import {
  signCustomerPortalSession, verifyCustomerPortalSession, requireCustomerPortal,
} from '@/lib/customer-portal/session';

const base = { userId: 'u-1', customerId: 'cust-1', tenantId: 'tenant-1', sv: 1 };
const reqWith = (token?: string) =>
  new NextRequest('http://localhost/api/customer-portal/fsm/requests', {
    headers: token ? { cookie: `customer-portal-session=${token}` } : {},
  });

beforeEach(() => {
  store.user = { id: 'u-1', tenantId: 'tenant-1', customerId: 'cust-1', email: 'sara@example.test', fullName: 'Sara', roles: { FSM: 'REQUESTER' }, isActive: true, sessionVersion: 1 };
  store.portals = new Set(['FSM']);
});

describe('customer portal session token', () => {
  it('round-trips a signed session', () => {
    const p = verifyCustomerPortalSession(signCustomerPortalSession(base));
    expect(p).toMatchObject(base);
  });

  it('rejects a tampered payload or signature', () => {
    const token = signCustomerPortalSession(base);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), customerId: 'cust-2' })).toString('base64url');
    expect(verifyCustomerPortalSession(`${forged}.${sig}`)).toBeNull();
    expect(verifyCustomerPortalSession(`${body}.${'0'.repeat(sig.length)}`)).toBeNull();
    expect(verifyCustomerPortalSession('garbage')).toBeNull();
  });

  it('rejects an expired session', () => {
    vi.useFakeTimers();
    const token = signCustomerPortalSession(base);
    vi.setSystemTime(Date.now() + 8 * 24 * 3600 * 1000);
    expect(verifyCustomerPortalSession(token)).toBeNull();
    vi.useRealTimers();
  });
});

describe('requireCustomerPortal guard', () => {
  const token = () => signCustomerPortalSession(base);

  it('admits an active user of a customer with the portal', async () => {
    const ctx = await requireCustomerPortal(reqWith(token()), { portal: 'FSM' });
    expect(ctx).not.toBeInstanceOf(NextResponse);
    expect(ctx).toMatchObject({ tenantId: 'tenant-1', customerId: 'cust-1', user: { id: 'u-1', role: 'REQUESTER' } });
  });

  it('refuses without a session', async () => {
    const res = await requireCustomerPortal(reqWith(), { portal: 'FSM' });
    expect((res as NextResponse).status).toBe(401);
  });

  it('refuses a deactivated user and clears the cookie', async () => {
    store.user!.isActive = false;
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'FSM' })) as NextResponse;
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses a revoked session (session version changed)', async () => {
    store.user!.sessionVersion = 2;
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'FSM' })) as NextResponse;
    expect(res.status).toBe(401);
  });

  it('refuses when the user now belongs to another customer', async () => {
    store.user!.customerId = 'cust-9';
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'FSM' })) as NextResponse;
    expect(res.status).toBe(401);
  });

  it('refuses a portal the customer has not been given', async () => {
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'TRANSPORT' })) as NextResponse;
    expect(res.status).toBe(403);
  });

  it('enforces the role list', async () => {
    store.user!.roles = { FSM: 'VIEWER' };
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'FSM', roles: ['ADMIN', 'REQUESTER'] })) as NextResponse;
    expect(res.status).toBe(403);
  });

  it('refuses a portal the account has no role in, even when the company has it', async () => {
    store.portals = new Set(['FSM', 'TRANSPORT']);
    store.user!.roles = { FSM: 'ADMIN' };
    const res = (await requireCustomerPortal(reqWith(token()), { portal: 'TRANSPORT' })) as NextResponse;
    expect(res.status).toBe(403);
  });

  it('uses the role of the portal the route belongs to', async () => {
    store.portals = new Set(['FSM', 'TRANSPORT']);
    store.user!.roles = { FSM: 'VIEWER', TRANSPORT: 'ADMIN' };
    const ctx = await requireCustomerPortal(reqWith(token()), { portal: 'TRANSPORT', roles: ['ADMIN'] });
    expect(ctx).toMatchObject({ user: { role: 'ADMIN' } });
  });
});
