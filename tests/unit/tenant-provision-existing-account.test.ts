/**
 * Public sign-up never takes over an existing account.
 *
 * POST /api/tenants/provision is public. When the contact email already
 * belonged to a user it used to fall back to that user: overwrite their
 * password with the one in the request, make them admin of the new tenant
 * and sign a session as them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({
  existingUser: null as null | { id: string },
  writes: [] as string[],
  signed: 0,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: async () => [] } }));
vi.mock('@/lib/handlers/tenant-bootstrap-handler', () => ({
  tenantBootstrapHandler: async (_req: unknown, _kind: string, cb: (ctx: unknown) => unknown) => cb({
    tx: {
      tenant: { findFirst: async () => null, create: async () => { st.writes.push('tenant.create'); return { id: 't-new' }; } },
      user: {
        findUnique: async () => st.existingUser,
        create: async () => { st.writes.push('user.create'); return { id: 'u-new' }; },
      },
      $executeRawUnsafe: async (sql: string) => { st.writes.push(sql); return 1; },
      $queryRawUnsafe: async () => [],
    },
    rescopeToTenant: async () => {},
  }),
}));
vi.mock('@/lib/tenant-session', () => ({ signSession: async () => { st.signed++; return 'tok'; } }));
vi.mock('@/lib/email-templates', () => ({ appUrl: (p: string) => p, sendTemplatedEmail: async () => ({ sent: true }) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tenants/provision/route';

const body = {
  companyName: 'Victim Co', domain: 'victim.example', contactEmail: 'ceo@victim.example',
  contactName: 'Attacker', selectedModules: [], adminFirstName: 'A', adminLastName: 'B',
  adminPassword: 'attacker-chosen-password',
};

describe('POST /api/tenants/provision with an email that already has an account', () => {
  beforeEach(() => {
    st.existingUser = { id: 'victim' };
    st.writes.length = 0;
    st.signed = 0;
  });

  it('refuses with 409 and writes nothing, signs nothing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(new NextRequest('http://localhost/api/tenants/provision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    expect(res.status).toBe(409);
    expect(st.writes).toEqual([]);
    expect(st.signed).toBe(0);
  });
});
