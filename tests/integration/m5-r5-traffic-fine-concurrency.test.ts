/**
 * Real PostgreSQL Concurrency Stress Test — Traffic Fine Recharge (M5-R5 WP1).
 *
 * Exercises POST /api/leasing/traffic-fines/recharge directly against real
 * PostgreSQL with active Row-Level Security (FORCE RLS) and concurrent
 * transactions. Fires 5 simultaneous requests on the same PENDING
 * LeaseTrafficFine (and 5 on the same TrafficFine) and verifies:
 *   - Exactly 1 returns 201 Created
 *   - Exactly 4 return 409 Conflict
 *   - Exactly 1 LeaseInvoice and 1 POSTED GL journal entry are persisted
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';

const hasDb = Boolean(process.env.DATABASE_URL);
const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();
const lesseeId = crypto.randomUUID();
const leaseFineId = crypto.randomUUID();
const trafficFineId = crypto.randomUUID();
const suffix = Date.now().toString().slice(-6);

vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: vi.fn(() => ({
    ok: true as const,
    tenantId,
    userId,
    role: 'TENANT_ADMIN',
  })),
  stripTenantOwnershipFields: vi.fn((body: Record<string, unknown>) => {
    const copy = { ...body };
    delete copy.tenantId;
    delete copy.tenant_id;
    return copy;
  }),
}));

import { POST as rechargePost } from '@/app/api/leasing/traffic-fines/recharge/route';

describe.skipIf(!hasDb)('M5-R5 PostgreSQL Concurrency — Traffic Fine Recharge', () => {
  beforeAll(async () => {
    await withPlatformAdmin(prisma, async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          name: `M5R5 Race Tenant ${suffix}`,
          code: `R5-${suffix}`,
          domain: `r5-${suffix}.example.com`,
          plan: 'ENTERPRISE',
          isActive: true,
        },
      });
    });

    await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.lessee.create({
        data: {
          id: lesseeId,
          tenantId,
          name: `R5 Race Lessee ${suffix}`,
          type: 'corporate',
          email: `r5-${suffix}@lessee.example.com`,
        },
      });

      await tx.leaseTrafficFine.create({
        data: {
          id: leaseFineId,
          tenantId,
          fineNo: `LTF-R5-${suffix}`,
          lesseeId,
          violationDate: new Date(),
          violationType: 'SPEEDING',
          fineAmount: 600,
          finalAmount: 600,
          currency: 'AED',
          billingStatus: 'PENDING',
        },
      });

      await tx.trafficFine.create({
        data: {
          id: trafficFineId,
          tenantId,
          fineDate: new Date(),
          fineAmount: 500,
          adminFee: 50,
          fineRef: `TF-R5-${suffix}`,
          status: 'PAID',
          isBilledToCustomer: false,
        },
      });
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await withPlatformAdmin(prisma, async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM finance_journal_lines WHERE journal_entry_id IN (SELECT id FROM finance_journal_entries WHERE tenant_id = $1)`,
        tenantId,
      ).catch(() => {});
      await tx.$executeRawUnsafe(
        `DELETE FROM finance_journal_entries WHERE tenant_id = $1`,
        tenantId,
      ).catch(() => {});
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_logs WHERE tenant_id = $1`,
        tenantId,
      ).catch(() => {});
      await tx.leaseInvoiceLine.deleteMany({ where: { tenantId } }).catch(() => {});
      await tx.leaseInvoice.deleteMany({ where: { tenantId } }).catch(() => {});
      await tx.leaseTrafficFine.deleteMany({ where: { tenantId } }).catch(() => {});
      await tx.trafficFine.deleteMany({ where: { tenantId } }).catch(() => {});
      await tx.lessee.deleteMany({ where: { tenantId } }).catch(() => {});
      await tx.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    });
  });

  it('serializes 5 simultaneous LeaseTrafficFine recharges: 1x 201, 4x 409, 1 invoice, 1 GL entry', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        rechargePost(
          new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
            method: 'POST',
            body: JSON.stringify({ fineId: leaseFineId, fineAmount: 600, adminFee: 60 }),
          }),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    await withTenantRls(prisma, tenantId, async (tx) => {
      const fine = await tx.leaseTrafficFine.findFirst({ where: { id: leaseFineId, tenantId } });
      expect(fine?.billingStatus).toBe('INVOICED');

      const invoiceCount = await tx.leaseInvoice.count({ where: { tenantId } });
      expect(invoiceCount).toBe(1);

      const jeRows = await tx.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
        `SELECT COUNT(*) AS count FROM finance_journal_entries WHERE tenant_id = $1 AND source_type = 'LEASE_INVOICE'`,
        tenantId,
      );
      expect(Number(jeRows[0]?.count ?? 0)).toBe(1);
    });
  });

  it('serializes 5 simultaneous TrafficFine recharges: 1x 201, 4x 409, 1 GL entry', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        rechargePost(
          new NextRequest('http://localhost/api/leasing/traffic-fines/recharge', {
            method: 'POST',
            body: JSON.stringify({ fineId: trafficFineId, fineAmount: 500, adminFee: 50 }),
          }),
        ),
      ),
    );

    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);

    await withTenantRls(prisma, tenantId, async (tx) => {
      const fine = await tx.trafficFine.findFirst({ where: { id: trafficFineId, tenantId } });
      expect(fine?.status).toBe('RECHARGED');
      expect(fine?.isBilledToCustomer).toBe(true);

      const jeRows = await tx.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
        `SELECT COUNT(*) AS count FROM finance_journal_entries WHERE tenant_id = $1 AND source_type = 'TRAFFIC_FINE_RECHARGE'`,
        tenantId,
      );
      expect(Number(jeRows[0]?.count ?? 0)).toBe(1);
    });
  });
});
