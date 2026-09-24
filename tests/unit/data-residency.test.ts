/**
 * tests/unit/data-residency.test.ts
 *
 * Data residency must fail closed. It used to fail open twice over: the
 * db-router fell back to the global database with a warning when a
 * regional URL was missing, and no route used the router anyway, so an
 * EU/UAE/US tenant's data always went to the global database.
 *
 * What is tested:
 *  - residency helpers (normalise, served regions, session claim)
 *  - db-router throws instead of falling back to the global primary
 *  - middleware refuses (503) sessions for a region this deployment does not
 *    serve, on authenticated and driver-app routes, and serves them once
 *    DATA_RESIDENCY_SERVED_REGIONS lists the region
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const queryRaw = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/tenant-session';
import * as sessionBlocklist from '@/lib/session-blocklist';
import {
  canServeResidency,
  normalizeResidency,
  residencySessionClaim,
  servedResidencies,
} from '@/lib/data-residency';
import {
  DataResidencyUnavailableError,
  getPrismaForRegion,
  getPrismaForTenant,
  invalidateResidencyCache,
  residencyClaimForTenant,
} from '@/lib/db-router';

vi.spyOn(sessionBlocklist, 'isSessionRevoked').mockResolvedValue(false);

const TENANT = '11111111-1111-4111-8111-111111111111';
const saved = {
  served: process.env.DATA_RESIDENCY_SERVED_REGIONS,
  uae: process.env.DATABASE_URL_UAE,
};

afterEach(() => {
  for (const [key, value] of [
    ['DATA_RESIDENCY_SERVED_REGIONS', saved.served],
    ['DATABASE_URL_UAE', saved.uae],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  queryRaw.mockReset();
  invalidateResidencyCache(TENANT);
});

describe('residency helpers', () => {
  it('normalises stored values, treating missing as GLOBAL and unknown as null', () => {
    expect(normalizeResidency(undefined)).toBe('GLOBAL');
    expect(normalizeResidency('')).toBe('GLOBAL');
    expect(normalizeResidency(' uae ')).toBe('UAE');
    expect(normalizeResidency('MARS')).toBeNull();
  });

  it('serves only GLOBAL unless DATA_RESIDENCY_SERVED_REGIONS says otherwise', () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    expect([...servedResidencies()]).toEqual(['GLOBAL']);
    expect(canServeResidency(undefined)).toBe(true);
    expect(canServeResidency('UAE')).toBe(false);
    expect(canServeResidency('MARS')).toBe(false);

    process.env.DATA_RESIDENCY_SERVED_REGIONS = 'uae, bogus';
    expect(canServeResidency('UAE')).toBe(true);
    expect(canServeResidency('EU')).toBe(false);
  });

  it('signs a claim for every non-GLOBAL tenant, including unknown values', () => {
    expect(residencySessionClaim('GLOBAL')).toEqual({});
    expect(residencySessionClaim(null)).toEqual({});
    expect(residencySessionClaim('eu')).toEqual({ dataResidency: 'EU' });
    expect(residencySessionClaim('MARS')).toEqual({ dataResidency: 'MARS' });
  });
});

describe('db-router fails closed', () => {
  it('throws for an unserved region with no regional database', () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    delete process.env.DATABASE_URL_UAE;
    expect(() => getPrismaForRegion('UAE')).toThrow(DataResidencyUnavailableError);
    expect(() => getPrismaForRegion('MARS')).toThrow(DataResidencyUnavailableError);
  });

  it('uses the primary for GLOBAL and for a region this deployment serves', async () => {
    const { prisma } = await import('@/lib/prisma');
    expect(getPrismaForRegion('GLOBAL')).toBe(prisma);
    process.env.DATA_RESIDENCY_SERVED_REGIONS = 'UAE';
    expect(getPrismaForRegion('UAE')).toBe(prisma);
  });

  it('applies to tenants whatever their plan, and fails when the lookup fails', async () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    delete process.env.DATABASE_URL_UAE;
    queryRaw.mockResolvedValueOnce([{ data_residency: 'UAE' }]);
    await expect(getPrismaForTenant(TENANT)).rejects.toBeInstanceOf(DataResidencyUnavailableError);

    invalidateResidencyCache(TENANT);
    queryRaw.mockRejectedValueOnce(new Error('db down'));
    await expect(residencyClaimForTenant(TENANT)).rejects.toBeInstanceOf(DataResidencyUnavailableError);
  });

  it('builds the session claim from the stored residency', async () => {
    queryRaw.mockResolvedValueOnce([{ data_residency: 'EU' }]);
    await expect(residencyClaimForTenant(TENANT)).resolves.toEqual({ dataResidency: 'EU' });
    invalidateResidencyCache(TENANT);
    queryRaw.mockResolvedValueOnce([]);
    await expect(residencyClaimForTenant(TENANT)).resolves.toEqual({});
  });
});

describe('middleware refuses unserved residency', () => {
  async function cookie(dataResidency?: string) {
    return signSession({
      userId: 'user-1',
      tenantId: TENANT,
      plan: 'ENTERPRISE',
      role: 'TENANT_ADMIN',
      ...(dataResidency ? { dataResidency } : {}),
    });
  }

  function req(path: string, name: string, token: string, accept = 'application/json') {
    return new NextRequest(`http://localhost${path}`, {
      headers: { cookie: `${name}=${token}`, accept },
    });
  }

  it('503s API and page requests for a UAE tenant on a GLOBAL-only deployment', async () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    const token = await cookie('UAE');

    const api = await middleware(req('/api/vehicles', 'xl-session', token));
    expect(api.status).toBe(503);
    expect(await api.json()).toMatchObject({ code: 'DATA_RESIDENCY_UNAVAILABLE' });

    const page = await middleware(req('/dashboard', 'xl-session', token, 'text/html'));
    expect(page.status).toBe(503);
  });

  it('503s driver-app requests carrying such a session', async () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    const res = await middleware(req('/api/driver-app/emergency-sos', 'xl-driver-session', await cookie('UAE')));
    expect(res.status).toBe(503);
  });

  it('refuses an unrecognised residency claim', async () => {
    const res = await middleware(req('/api/vehicles', 'xl-session', await cookie('MARS')));
    expect(res.status).toBe(503);
  });

  it('serves the tenant once the deployment declares the region', async () => {
    process.env.DATA_RESIDENCY_SERVED_REGIONS = 'UAE';
    const res = await middleware(req('/api/auth/me', 'xl-session', await cookie('UAE')));
    expect(res.status).not.toBe(503);
    expect(res.headers.get('x-middleware-request-x-data-residency')).toBe('UAE');
  });

  it('leaves GLOBAL tenants and sign-out unaffected', async () => {
    delete process.env.DATA_RESIDENCY_SERVED_REGIONS;
    const global = await middleware(req('/api/auth/me', 'xl-session', await cookie()));
    expect(global.status).not.toBe(503);
    const logout = await middleware(req('/api/auth/logout', 'xl-session', await cookie('UAE')));
    expect(logout.status).not.toBe(503);
  });
});
