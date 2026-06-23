import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
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

async function createLessee(name: string) {
  return prisma.lessee.create({
    data: {
      name,
      type: 'corporate',
      tradeLicense: `TL-${Date.now()}`,
      email: `${name.toLowerCase().replace(/\W+/g, '-')}@example.com`,
    },
  });
}

describe('Leasing governance and canonical contract model', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;
  let lesseeId: string;
  let contractId: string;
  let preBillingId = '';
  let executedPreBillingId = '';
  let invoiceId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureLeasingTenantColumns();
    const lessee = await createLessee('Governance Leasing Customer');
    lesseeId = lessee.id;
  }, 120_000);

  afterAll(async () => {
    if (preBillingId) {
      await prisma.leasePreBillingStatement.deleteMany({ where: { id: preBillingId } }).catch(() => {});
    }
    if (executedPreBillingId) {
      await prisma.leasePreBillingStatement.deleteMany({ where: { id: executedPreBillingId } }).catch(() => {});
    }
    if (invoiceId) {
      await prisma.leaseInvoiceLine.deleteMany({ where: { invoiceId } }).catch(() => {});
      await prisma.leaseInvoice.deleteMany({ where: { id: invoiceId } }).catch(() => {});
    }
    if (contractId) {
      await prisma.leasePayment2.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContractVehicle.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseVehicleExchange.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContract2.delete({ where: { id: contractId } }).catch(() => {});
    }
    if (lesseeId) await prisma.lessee.delete({ where: { id: lesseeId } }).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('creates contracts in the canonical v2 table, scopes reads by tenant, and audits creation', async () => {
    if (!serverAvailable) return;
    const create = await makeRequest('POST', '/api/leasing/contracts', {
      lesseeId,
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      monthlyRate: 6500,
      durationMonths: 12,
    }, routeHeaders(tenantA));
    expect(create.status).toBe(201);
    const body = await create.json();
    contractId = body.id;
    expect(contractId).toBeTruthy();

    const scopedRows = await prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
      `SELECT tenant_id FROM lease_contracts_v2 WHERE id::text = $1`,
      contractId,
    );
    expect(scopedRows[0]?.tenant_id).toBe(tenantA.tenant.id);

    const tenantAList = await makeRequest('GET', '/api/leasing/contracts', undefined, routeHeaders(tenantA));
    expect(tenantAList.status).toBe(200);
    expect(JSON.stringify(await tenantAList.json())).toContain(contractId);

    const tenantBList = await makeRequest('GET', '/api/leasing/contracts', undefined, routeHeaders(tenantB));
    expect(tenantBList.status).toBe(200);
    expect(JSON.stringify(await tenantBList.json())).not.toContain(contractId);

    const tenantBDirect = await makeRequest('GET', `/api/leasing/contracts/${contractId}`, undefined, routeHeaders(tenantB));
    expect(tenantBDirect.status).toBe(404);

    const audit = await prisma.$queryRawUnsafe<Array<{ entity_id: string }>>(
      `SELECT entity_id FROM admin_change_history
        WHERE tenant_id = $1 AND entity_type = 'LeaseContract' AND entity_id = $2
        LIMIT 1`,
      tenantA.tenant.id,
      contractId,
    );
    expect(audit.length).toBeGreaterThan(0);
  }, 120_000);

  it('scopes leasing analytics and persists generated payment schedule rows', async () => {
    if (!serverAvailable) return;
    const analyticsA = await makeRequest('GET', '/api/leasing/analytics', undefined, routeHeaders(tenantA));
    expect(analyticsA.status).toBe(200);
    const analyticsABody = await analyticsA.json();
    expect(analyticsABody.kpis.totalContracts).toBeGreaterThanOrEqual(1);

    const analyticsB = await makeRequest('GET', '/api/leasing/analytics', undefined, routeHeaders(tenantB));
    expect(analyticsB.status).toBe(200);
    const analyticsBBody = await analyticsB.json();
    expect(analyticsBBody.kpis.totalContracts).toBe(0);

    const payments = await makeRequest('POST', `/api/leasing/contracts-v2/${contractId}/payments`, {
      payments: [
        { month: 7, dueDate: '2026-07-05', amount: 6500, vat: 325, total: 6825 },
        { month: 8, dueDate: '2026-08-05', amount: 6500, vat: 325, total: 6825 },
      ],
    }, routeHeaders(tenantA));
    expect(payments.status).toBe(200);
    const paymentBody = await payments.json();
    expect(paymentBody.count).toBe(2);

    const persisted = await prisma.leasePayment2.count({ where: { contractId } });
    expect(persisted).toBe(2);

    const blocked = await makeRequest('POST', `/api/leasing/contracts-v2/${contractId}/payments`, {
      payments: [{ month: 9, dueDate: '2026-09-05', amount: 6500 }],
    }, routeHeaders(tenantB));
    expect(blocked.status).toBe(404);
  }, 120_000);

  it('scopes billing reconciliation data and gates dangerous billing execution', async () => {
    if (!serverAvailable) return;
    const preview = await makeRequest('POST', '/api/leasing/pre-billing/aggregate', {
      contractId,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      maintenanceCharges: 100,
      otherCharges: 50,
    }, routeHeaders(tenantA));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.mode).toBe('preview');
    expect(Number(previewBody.baseRent)).toBeGreaterThan(0);

    const blockedPreview = await makeRequest('POST', '/api/leasing/pre-billing/aggregate', {
      contractId,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
    }, routeHeaders(tenantB));
    expect(blockedPreview.status).toBe(404);

    const commit = await makeRequest('POST', '/api/leasing/pre-billing/aggregate', {
      contractId,
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      commit: true,
    }, routeHeaders(tenantA));
    expect(commit.status).toBe(428);

    const now = Date.now();
    const statement = await prisma.leasePreBillingStatement.create({
      data: {
        statementNo: `PBS-TST-${now}`,
        contractId,
        lesseeId,
        billingPeriod: '2026-07',
        dueDate: new Date('2026-08-05T00:00:00.000Z'),
        baseRent: 6500,
        fuelCharges: 25,
        fineCharges: 0,
        maintenanceCharges: 100,
        overageCharges: 0,
        otherCharges: 50,
        vatAmount: 333.75,
        totalAmount: 7008.75,
        currency: 'AED',
        status: 'DRAFT',
      },
    });
    preBillingId = statement.id;

    const tenantAStatements = await makeRequest('GET', '/api/leasing/pre-billing', undefined, routeHeaders(tenantA));
    expect(tenantAStatements.status).toBe(200);
    expect(JSON.stringify(await tenantAStatements.json())).toContain(preBillingId);

    const tenantBStatements = await makeRequest('GET', '/api/leasing/pre-billing', undefined, routeHeaders(tenantB));
    expect(tenantBStatements.status).toBe(200);
    expect(JSON.stringify(await tenantBStatements.json())).not.toContain(preBillingId);

    const invoice = await makeRequest('POST', '/api/leasing/invoices', {
      preBillingStatementId: preBillingId,
    }, routeHeaders(tenantA));
    expect(invoice.status).toBe(428);
  }, 120_000);

  it('requires approvals for high-risk leasing contract and vehicle mutations', async () => {
    if (!serverAvailable) return;
    await prisma.leaseContract2.update({ where: { id: contractId }, data: { status: 'ACTIVE' } });

    const terminate = await makeRequest('DELETE', `/api/leasing/contracts-v2/${contractId}`, undefined, routeHeaders(tenantA));
    expect(terminate.status).toBe(428);

    const suspend = await makeRequest('PATCH', `/api/leasing/contracts-v2/${contractId}`, {
      status: 'SUSPENDED',
    }, routeHeaders(tenantA));
    expect(suspend.status).toBe(428);

    const exchange = await makeRequest('POST', `/api/leasing/contracts-v2/${contractId}/exchange`, {
      outgoingVehicleId: 'vehicle-out-test',
      incomingVehicleId: 'vehicle-in-test',
      reason: 'Integration approval gate test',
    }, routeHeaders(tenantA));
    expect(exchange.status).toBe(428);
  }, 120_000);

  it('executes approved Leasing approvals directly from the Admin Approvals queue', async () => {
    if (!serverAvailable) return;
    await prisma.$executeRawUnsafe(
      `DELETE FROM admin_approval_requests
        WHERE tenant_id = $1
          AND action = 'leasing.prebilling.commit'
          AND target_id = $2`,
      tenantA.tenant.id,
      contractId,
    ).catch(() => {});

    const queued = await makeRequest('POST', '/api/leasing/pre-billing/aggregate', {
      contractId,
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
      commit: true,
    }, routeHeaders(tenantA));
    expect(queued.status).toBe(428);
    const queuedBody = await queued.json();
    const approvalId = queuedBody.approvalRequest?.id;
    expect(approvalId).toBeTruthy();

    await prisma.$executeRawUnsafe(
      `UPDATE admin_approval_requests
          SET status = 'APPROVED', decided_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid`,
      approvalId,
    );

    const execute = await makeRequest(
      'POST',
      `/api/admin/approvals/${approvalId}/execute`,
      undefined,
      routeHeaders(tenantA),
    );
    expect(execute.status).toBe(200);
    const executed = await execute.json();
    expect(executed).toMatchObject({
      ok: true,
      approvalId,
      action: 'leasing.prebilling.commit',
      entityType: 'LeasePreBillingStatement',
    });
    executedPreBillingId = executed.entityId;

    const statement = await prisma.leasePreBillingStatement.findUnique({ where: { id: executedPreBillingId } });
    expect(statement).toMatchObject({ contractId, billingPeriod: '2026-09', status: 'DRAFT' });

    const approvalRows = await prisma.$queryRawUnsafe<Array<{ execution_status: string | null }>>(
      `SELECT execution_status FROM admin_approval_requests WHERE id = $1::uuid`,
      approvalId,
    );
    expect(approvalRows[0]?.execution_status).toBe('EXECUTED');
  }, 120_000);

  it('requires approval to execute dangerous invoice status changes and records history', async () => {
    if (!serverAvailable) return;
    const stamp = Date.now();
    const invoice = await prisma.leaseInvoice.create({
      data: {
        invoiceNo: `INV-GOV-${stamp}`,
        lesseeId,
        billingPeriod: '2026-10',
        issueDate: new Date('2026-10-01T00:00:00.000Z'),
        dueDate: new Date('2026-10-31T00:00:00.000Z'),
        subTotal: 1000,
        vatPct: 5,
        vatAmount: 50,
        totalAmount: 1050,
        currency: 'AED',
        status: 'SENT',
        lines: {
          create: [{
            contractId,
            description: 'Governance status change test',
            lineType: 'RENT',
            quantity: 1,
            unitAmount: 1000,
            totalAmount: 1000,
            currency: 'AED',
          }],
        },
      },
      include: { lines: true },
    });
    invoiceId = invoice.id;

    const blockedTenant = await makeRequest('GET', `/api/leasing/invoices/${invoiceId}`, undefined, routeHeaders(tenantB));
    expect(blockedTenant.status).toBe(404);

    const markPaid = await makeRequest('PATCH', `/api/leasing/invoices/${invoiceId}`, {
      status: 'PAID',
    }, routeHeaders(tenantA));
    expect(markPaid.status).toBe(428);
    const queuedBody = await markPaid.json();
    const approvalId = queuedBody.approvalRequest?.id;
    expect(approvalId).toBeTruthy();
    expect(queuedBody.action).toBe('leasing.invoice.status_change');

    await prisma.$executeRawUnsafe(
      `UPDATE admin_approval_requests
          SET status = 'APPROVED', decided_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid`,
      approvalId,
    );

    const execute = await makeRequest(
      'POST',
      `/api/admin/approvals/${approvalId}/execute`,
      undefined,
      routeHeaders(tenantA),
    );
    expect(execute.status).toBe(200);
    const executed = await execute.json();
    expect(executed).toMatchObject({
      ok: true,
      approvalId,
      action: 'leasing.invoice.status_change',
      entityType: 'LeaseInvoice',
      entityId: invoiceId,
    });

    const updated = await prisma.leaseInvoice.findUnique({ where: { id: invoiceId } });
    expect(updated?.status).toBe('PAID');
    expect(updated?.paidAt).toBeTruthy();

    const approvalRows = await prisma.$queryRawUnsafe<Array<{ execution_status: string | null }>>(
      `SELECT execution_status FROM admin_approval_requests WHERE id = $1::uuid`,
      approvalId,
    );
    expect(approvalRows[0]?.execution_status).toBe('EXECUTED');

    const history = await prisma.$queryRawUnsafe<Array<{ entity_id: string }>>(
      `SELECT entity_id
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type = 'LeaseInvoice'
          AND entity_id = $2
          AND action = 'EXECUTE_APPROVED_LEASING_ACTION'
        LIMIT 1`,
      tenantA.tenant.id,
      invoiceId,
    );
    expect(history.length).toBeGreaterThan(0);
  }, 120_000);
});
