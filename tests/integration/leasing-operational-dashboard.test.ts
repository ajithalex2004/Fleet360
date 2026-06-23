import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ensureAdminApprovalTables } from '@/lib/admin-approvals';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, role = seed.role.code) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    'x-tenant-plan': seed.tenant.plan,
    'x-test-auth-bypass': 'fleet360-test-bypass',
  };
}

async function ensureLeasingTenantColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE lease_contracts_v2 ADD COLUMN IF NOT EXISTS tenant_id TEXT`).catch(() => {});
}

describe('Leasing operational dashboard', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;
  let lesseeId = '';
  let contractId = '';
  let statementId = '';
  let invoiceId = '';
  let approvalId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureLeasingTenantColumns();
    await ensureAdminApprovalTables();

    const lessee = await prisma.lessee.create({
      data: {
        name: 'Operational Dashboard Customer',
        type: 'corporate',
        tradeLicense: `OD-${Date.now()}`,
        email: `ops-dashboard-${Date.now()}@example.com`,
      },
    });
    lesseeId = lessee.id;

    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber: `LCD-OPS-${Date.now()}`,
        lesseeId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date(Date.now() + 30 * 86400000),
        monthlyRate: 4200,
        totalContractValue: 50400,
        currency: 'AED',
        status: 'ACTIVE',
      },
    });
    contractId = contract.id;
    await prisma.$executeRawUnsafe(
      `UPDATE lease_contracts_v2 SET tenant_id = $1 WHERE id::text = $2`,
      tenantA.tenant.id,
      contractId,
    );

    const statement = await prisma.leasePreBillingStatement.create({
      data: {
        statementNo: `PBS-OPS-${Date.now()}`,
        contractId,
        lesseeId,
        billingPeriod: '2026-11',
        dueDate: new Date('2026-12-05T00:00:00.000Z'),
        baseRent: 4200,
        vatAmount: 210,
        totalAmount: 4410,
        currency: 'AED',
        status: 'CONFIRMED',
      },
    });
    statementId = statement.id;

    const invoice = await prisma.leaseInvoice.create({
      data: {
        invoiceNo: `INV-OPS-${Date.now()}`,
        lesseeId,
        billingPeriod: '2026-10',
        issueDate: new Date('2026-10-01T00:00:00.000Z'),
        dueDate: new Date('2026-10-31T00:00:00.000Z'),
        subTotal: 1000,
        vatPct: 5,
        vatAmount: 50,
        totalAmount: 1050,
        currency: 'AED',
        status: 'PAID',
        lines: {
          create: [{
            contractId,
            description: 'Paid invoice without reference test',
            lineType: 'RENT',
            quantity: 1,
            unitAmount: 1000,
            totalAmount: 1000,
            currency: 'AED',
          }],
        },
      },
    });
    invoiceId = invoice.id;

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO admin_approval_requests
         (tenant_id, action, target_type, target_id, summary, payload_json,
          status, required_approvals, requested_by, requested_role)
       VALUES ($1, 'leasing.invoice.status_change', 'LeaseInvoice', $2,
          'Dashboard approved action awaiting execution', '{"before":{},"after":{"status":"PAID"}}'::jsonb,
          'APPROVED', 2, $3, $4)
       RETURNING id::text`,
      tenantA.tenant.id,
      invoiceId,
      tenantA.user.id,
      tenantA.role.code,
    );
    approvalId = rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    if (approvalId) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE id = $1::uuid`, approvalId).catch(() => {});
    }
    if (invoiceId) {
      await prisma.leaseInvoiceLine.deleteMany({ where: { invoiceId } }).catch(() => {});
      await prisma.leaseInvoice.deleteMany({ where: { id: invoiceId } }).catch(() => {});
    }
    if (statementId) {
      await prisma.leasePreBillingStatement.deleteMany({ where: { id: statementId } }).catch(() => {});
    }
    if (contractId) {
      await prisma.leasePayment2.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContractVehicle.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContract2.deleteMany({ where: { id: contractId } }).catch(() => {});
    }
    if (lesseeId) await prisma.lessee.deleteMany({ where: { id: lesseeId } }).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('surfaces tenant-scoped Leasing execution exceptions and hides them from other tenants', async () => {
    if (!serverAvailable) return;
    const response = await makeRequest('GET', '/api/leasing/operational-dashboard', undefined, routeHeaders(tenantA));
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.exceptions.map((item: { id: string }) => item.id);

    expect(body.kpis.activeContracts).toBe(1);
    expect(body.kpis.openExceptions).toBeGreaterThanOrEqual(4);
    expect(ids).toContain('contracts-at-risk');
    expect(ids).toContain('active-contracts-without-schedule');
    expect(ids).toContain('confirmed-prebilling-without-invoice');
    expect(ids).toContain('paid-invoice-without-payment-reference');
    expect(ids).toContain('approved-leasing-actions-not-executed');

    const otherTenant = await makeRequest('GET', '/api/leasing/operational-dashboard', undefined, routeHeaders(tenantB));
    expect(otherTenant.status).toBe(200);
    const otherBody = await otherTenant.json();
    expect(JSON.stringify(otherBody)).not.toContain(contractId);
    expect(otherBody.kpis.activeContracts).toBe(0);
  }, 120_000);
});
