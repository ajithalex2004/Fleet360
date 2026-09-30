/**
 * tests/unit/maintenance-warranties.test.ts
 *
 * Vehicle warranties and claims, as the Warranties screen uses them:
 *  - input checks (vehicle, type, dates, amounts, description)
 *  - the claim workflow: PENDING -> APPROVED | REJECTED, APPROVED -> PAID
 *  - a claim can only be filed on an active warranty covering its date
 *  - approving can't exceed what was claimed or the warranty's limit
 *  - a new claim always starts PENDING, whatever the body says
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';

const db = vi.hoisted(() => ({
  vehicles: new Set<string>(),
  warranties: new Map<string, Record<string, unknown>>(),
  claims: new Map<string, Record<string, unknown>>(),
  audits: [] as Array<Record<string, unknown>>,
}));

const tx = vi.hoisted(() => ({
  vehicle: {
    findFirst: async ({ where }: { where: { id: string } }) => (db.vehicles.has(where.id) ? { id: where.id } : null),
  },
  vehicleWarranty: {
    findUnique: async ({ where }: { where: { id: string } }) => db.warranties.get(where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: 'w-new', ...data, claims: [] };
      db.warranties.set('w-new', row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...db.warranties.get(where.id)!, ...data };
      db.warranties.set(where.id, row);
      return { ...row, claims: [] };
    },
  },
  warrantyClaim: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const c = db.claims.get(where.id);
      return c ? { ...c, VehicleWarranty: db.warranties.get(String(c.warrantyId)) } : null;
    },
    findMany: async ({ where }: { where: { warrantyId: string; id: { not: string }; status: { in: string[] } } }) =>
      [...db.claims.values()].filter((c) =>
        c.warrantyId === where.warrantyId && c.id !== where.id.not && where.status.in.includes(String(c.status))),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: 'c-new', ...data };
      db.claims.set('c-new', row);
      return { ...row, VehicleWarranty: db.warranties.get(String(data.warrantyId)) };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...db.claims.get(where.id)!, ...data };
      db.claims.set(where.id, row);
      return row;
    },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/audit', () => ({ logAudit: async (a: Record<string, unknown>) => { db.audits.push(a); } }));
vi.mock('@/lib/maintenance/publish-event', () => ({ publishWarrantyClaimRaised: async () => {} }));

import { NextRequest } from 'next/server';
import * as warranties from '@/app/api/maintenance/warranties/route';
import * as warrantyById from '@/app/api/maintenance/warranties/[id]/route';
import * as claims from '@/app/api/maintenance/warranty-claims/route';
import * as claimById from '@/app/api/maintenance/warranty-claims/[id]/route';
import { canMoveClaim, parseClaimStatusChange, parseWarrantyInput, warrantyOpenForClaims } from '@/lib/maintenance/warranty';

const headers = { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };
const req = (path: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost/api/maintenance/${path}`, { method, headers, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const warranty = (id: string, extra: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, vehicleId: 'veh-1', warrantyType: 'MANUFACTURER', isActive: true,
  startDate: new Date('2026-01-01'), expiryDate: new Date('2027-01-01'), maxClaimAmount: null, ...extra,
});

beforeEach(() => {
  db.vehicles = new Set(['veh-1']);
  db.warranties = new Map();
  db.claims = new Map();
  db.audits = [];
});

describe('warranty rules', () => {
  it('checks a new warranty', () => {
    const base = { vehicleId: 'veh-1', warrantyType: 'extended', startDate: '2026-01-01', expiryDate: '2027-01-01' };
    expect(parseWarrantyInput(base)).toMatchObject({ ok: true, data: { warrantyType: 'EXTENDED', maxClaimAmount: null } });
    expect(parseWarrantyInput({ ...base, maxClaimAmount: 5000 })).toMatchObject({ ok: true, data: { maxClaimAmount: 5000 } });
    expect(parseWarrantyInput({ ...base, vehicleId: '' }).ok).toBe(false);
    expect(parseWarrantyInput({ ...base, warrantyType: 'LIFETIME' }).ok).toBe(false);
    expect(parseWarrantyInput({ ...base, expiryDate: '2025-12-31' }).ok).toBe(false);
    expect(parseWarrantyInput({ ...base, startDate: '01/01/2026' }).ok).toBe(false);
    expect(parseWarrantyInput({ ...base, maxClaimAmount: -1 }).ok).toBe(false);
  });

  it('allows only the claim workflow moves', () => {
    expect(canMoveClaim('PENDING', 'APPROVED')).toBe(true);
    expect(canMoveClaim('PENDING', 'REJECTED')).toBe(true);
    expect(canMoveClaim('APPROVED', 'PAID')).toBe(true);
    expect(canMoveClaim('PENDING', 'PAID')).toBe(false);
    expect(canMoveClaim('REJECTED', 'APPROVED')).toBe(false);
    expect(canMoveClaim('PAID', 'PENDING')).toBe(false);
  });

  it('approves at the claimed amount unless told otherwise, never above it', () => {
    const pending = { status: 'PENDING', claimedAmount: 3000, approvedAmount: null };
    expect(parseClaimStatusChange(pending, { status: 'APPROVED' })).toEqual({ ok: true, data: { status: 'APPROVED', approvedAmount: 3000 } });
    expect(parseClaimStatusChange(pending, { status: 'APPROVED', approvedAmount: 2500 })).toMatchObject({ data: { approvedAmount: 2500 } });
    expect(parseClaimStatusChange(pending, { status: 'APPROVED', approvedAmount: 3500 }).ok).toBe(false);
    expect(parseClaimStatusChange(pending, { status: 'PAID' }).ok).toBe(false);
  });

  it('takes claims only while the warranty is active and covers the date', () => {
    const w = warranty('w1');
    expect(warrantyOpenForClaims(w, new Date('2026-06-01'))).toBe(true);
    expect(warrantyOpenForClaims(w, new Date('2027-01-01'))).toBe(true);
    expect(warrantyOpenForClaims(w, new Date('2027-01-02'))).toBe(false);
    expect(warrantyOpenForClaims({ ...w, isActive: false }, new Date('2026-06-01'))).toBe(false);
  });
});

describe('warranties API', () => {
  it('creates a warranty for a vehicle of the tenant', async () => {
    const res = await warranties.POST(req('warranties', 'POST', {
      vehicleId: 'veh-1', warrantyType: 'MANUFACTURER', provider: 'Toyota', startDate: '2026-01-01', expiryDate: '2029-01-01', maxClaimAmount: 50000,
    }));
    expect(res.status).toBe(201);
    expect(db.warranties.get('w-new')).toMatchObject({ tenantId: TENANT, vehicleId: 'veh-1', provider: 'Toyota', maxClaimAmount: 50000, isActive: true });
  });

  it('refuses an unknown vehicle and bad input', async () => {
    const base = { warrantyType: 'MANUFACTURER', startDate: '2026-01-01', expiryDate: '2027-01-01' };
    expect((await warranties.POST(req('warranties', 'POST', { ...base, vehicleId: 'someone-elses' }))).status).toBe(404);
    expect((await warranties.POST(req('warranties', 'POST', { ...base, vehicleId: 'veh-1', expiryDate: '2025-01-01' }))).status).toBe(400);
    expect(db.warranties.size).toBe(0);
  });

  it('deactivates and reactivates a warranty', async () => {
    db.warranties.set('w1', warranty('w1'));
    const res = await warrantyById.PATCH(req('warranties/w1', 'PATCH', { isActive: false }), params('w1'));
    expect(res.status).toBe(200);
    expect(db.warranties.get('w1')!.isActive).toBe(false);
    expect((await warrantyById.PATCH(req('warranties/w1', 'PATCH', {}), params('w1'))).status).toBe(400);
    expect((await warrantyById.PATCH(req('warranties/nope', 'PATCH', { isActive: true }), params('nope'))).status).toBe(404);
  });
});

describe('warranty claims API', () => {
  it('files a claim as PENDING, ignoring a status or approved amount in the body', async () => {
    db.warranties.set('w1', warranty('w1'));
    const res = await claims.POST(req('warranty-claims', 'POST', {
      warrantyId: 'w1', description: 'Engine sensor', claimDate: '2026-03-10', claimedAmount: 3200,
      status: 'PAID', approvedAmount: 3200, tenantId: 'other',
    }));
    expect(res.status).toBe(201);
    const row = db.claims.get('c-new')!;
    expect(row).toMatchObject({ tenantId: TENANT, status: 'PENDING', claimedAmount: 3200, description: 'Engine sensor' });
    expect(row.approvedAmount).toBeUndefined();
  });

  it('refuses a claim on an inactive or expired warranty, or with no description', async () => {
    db.warranties.set('w1', warranty('w1', { isActive: false }));
    db.warranties.set('w2', warranty('w2'));
    expect((await claims.POST(req('warranty-claims', 'POST', { warrantyId: 'w1', description: 'x', claimDate: '2026-03-10' }))).status).toBe(409);
    expect((await claims.POST(req('warranty-claims', 'POST', { warrantyId: 'w2', description: 'x', claimDate: '2027-03-10' }))).status).toBe(409);
    expect((await claims.POST(req('warranty-claims', 'POST', { warrantyId: 'w2', description: ' ' }))).status).toBe(400);
    expect((await claims.POST(req('warranty-claims', 'POST', { warrantyId: 'missing', description: 'x' }))).status).toBe(404);
    expect(db.claims.size).toBe(0);
  });

  it('approves, then pays, a claim, auditing each step', async () => {
    db.warranties.set('w1', warranty('w1'));
    db.claims.set('c1', { id: 'c1', warrantyId: 'w1', status: 'PENDING', claimedAmount: 3200, approvedAmount: null });

    expect((await claimById.PATCH(req('warranty-claims/c1', 'PATCH', { status: 'APPROVED' }), params('c1'))).status).toBe(200);
    expect(db.claims.get('c1')).toMatchObject({ status: 'APPROVED', approvedAmount: 3200 });
    expect((await claimById.PATCH(req('warranty-claims/c1', 'PATCH', { status: 'PAID' }), params('c1'))).status).toBe(200);
    expect(db.claims.get('c1')!.status).toBe('PAID');
    expect(db.audits.map((a) => a.details)).toEqual([
      'Warranty claim PENDING -> APPROVED (AED 3200)',
      'Warranty claim APPROVED -> PAID (AED 3200)',
    ]);
  });

  it('refuses a move outside the workflow', async () => {
    db.warranties.set('w1', warranty('w1'));
    db.claims.set('c1', { id: 'c1', warrantyId: 'w1', status: 'REJECTED', claimedAmount: 100, approvedAmount: null });
    expect((await claimById.PATCH(req('warranty-claims/c1', 'PATCH', { status: 'APPROVED' }), params('c1'))).status).toBe(409);
    expect(db.claims.get('c1')!.status).toBe('REJECTED');
  });

  it("refuses an approval past the warranty's claim limit", async () => {
    db.warranties.set('w1', warranty('w1', { maxClaimAmount: 5000 }));
    db.claims.set('c0', { id: 'c0', warrantyId: 'w1', status: 'PAID', claimedAmount: 4000, approvedAmount: 4000 });
    db.claims.set('c1', { id: 'c1', warrantyId: 'w1', status: 'PENDING', claimedAmount: 1500, approvedAmount: null });

    const res = await claimById.PATCH(req('warranty-claims/c1', 'PATCH', { status: 'APPROVED' }), params('c1'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('claim limit');
    expect((await claimById.PATCH(req('warranty-claims/c1', 'PATCH', { status: 'APPROVED', approvedAmount: 1000 }), params('c1'))).status).toBe(200);
  });
});
