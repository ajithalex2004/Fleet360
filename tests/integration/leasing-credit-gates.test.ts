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

describe('Leasing credit assessment approval and activation gates', () => {
  let tenant: SeedResult;
  let lesseeId = '';
  let quotationId = '';
  let blockedQuotationId = '';
  let contractId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    tenant = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
    await ensureLeasingTenantColumns();

    const lessee = await prisma.lessee.create({
      data: {
        name: 'Credit Gate Corporate',
        type: 'corporate',
        tradeLicense: `CG-${Date.now()}`,
        email: `credit-gate-${Date.now()}@example.com`,
      },
    });
    lesseeId = lessee.id;

    const quotation = await prisma.leaseQuotation.create({
      data: {
        quotationNumber: `QT-CG-${Date.now()}`,
        lesseeId,
        durationMonths: 12,
        totalMonthlyRate: 5000,
        totalContractValue: 60000,
        currency: 'AED',
        status: 'PENDING_CREDIT_APPROVAL',
      },
    });
    quotationId = quotation.id;

    const blockedQuotation = await prisma.leaseQuotation.create({
      data: {
        quotationNumber: `QT-CG-BLOCK-${Date.now()}`,
        lesseeId,
        durationMonths: 12,
        totalMonthlyRate: 5000,
        totalContractValue: 60000,
        currency: 'AED',
        status: 'CUSTOMER_APPROVED',
      },
    });
    blockedQuotationId = blockedQuotation.id;
  }, 120_000);

  afterAll(async () => {
    if (contractId) {
      await prisma.leasePayment2.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContractVehicle.deleteMany({ where: { contractId } }).catch(() => {});
      await prisma.leaseContract2.deleteMany({ where: { id: contractId } }).catch(() => {});
    }
    if (quotationId || blockedQuotationId) {
      await prisma.leaseQuotation.deleteMany({ where: { id: { in: [quotationId, blockedQuotationId].filter(Boolean) } } }).catch(() => {});
    }
    if (lesseeId) {
      await prisma.leaseCreditAssessment.deleteMany({ where: { lesseeId } }).catch(() => {});
      await prisma.lessee.deleteMany({ where: { id: lesseeId } }).catch(() => {});
    }
    if (tenant) await cleanupTenant(tenant.tenant.id).then(() => cleanupUser(tenant.user.id));
  }, 120_000);

  it('blocks quotation credit approval until assessment is active, valid, and within limit', async () => {
    if (!serverAvailable) return;

    const missing = await makeRequest('POST', `/api/leasing/quotations/${quotationId}/approve`, {
      action: 'APPROVE',
      targetStatus: 'CREDIT_APPROVED',
    }, routeHeaders(tenant));
    expect(missing.status).toBe(409);
    expect((await missing.json()).code).toBe('CREDIT_ASSESSMENT_REQUIRED');

    await prisma.leaseCreditAssessment.create({
      data: {
        lesseeId,
        assessmentDate: new Date(),
        creditScore: 720,
        riskRating: 'LOW',
        creditLimit: 10000,
        currentExposure: 0,
        validUntil: new Date(Date.now() + 30 * 86400000),
        status: 'ACTIVE',
      },
    });

    const lowLimit = await makeRequest('POST', `/api/leasing/quotations/${quotationId}/approve`, {
      action: 'APPROVE',
      targetStatus: 'CREDIT_APPROVED',
    }, routeHeaders(tenant));
    expect(lowLimit.status).toBe(409);
    expect((await lowLimit.json()).code).toBe('CREDIT_LIMIT_EXCEEDED');

    await prisma.leaseCreditAssessment.create({
      data: {
        lesseeId,
        assessmentDate: new Date(Date.now() + 1000),
        creditScore: 810,
        riskRating: 'LOW',
        creditLimit: 100000,
        currentExposure: 0,
        validUntil: new Date(Date.now() + 60 * 86400000),
        status: 'ACTIVE',
      },
    });

    const passed = await makeRequest('POST', `/api/leasing/quotations/${quotationId}/approve`, {
      action: 'APPROVE',
      targetStatus: 'CREDIT_APPROVED',
    }, routeHeaders(tenant));
    expect(passed.status).toBe(200);
    expect((await passed.json()).status).toBe('CREDIT_APPROVED');
  }, 120_000);

  it('rejects conversion before credit approval and gates contract activation', async () => {
    if (!serverAvailable) return;

    const earlyConvert = await makeRequest('POST', `/api/leasing/quotations/${blockedQuotationId}/convert`, {}, routeHeaders(tenant));
    expect(earlyConvert.status).toBe(400);

    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber: `LC-CG-${Date.now()}`,
        lesseeId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
        monthlyRate: 5000,
        totalContractValue: 60000,
        currency: 'AED',
        status: 'APPROVED',
      },
    });
    contractId = contract.id;
    await prisma.$executeRawUnsafe(
      `UPDATE lease_contracts_v2 SET tenant_id = $1 WHERE id::text = $2`,
      tenant.tenant.id,
      contractId,
    );

    await prisma.leaseCreditAssessment.create({
      data: {
        lesseeId,
        assessmentDate: new Date(Date.now() + 2000),
        creditScore: 500,
        riskRating: 'HIGH',
        creditLimit: 500000,
        currentExposure: 0,
        validUntil: new Date(Date.now() + 60 * 86400000),
        status: 'ACTIVE',
      },
    });

    const highRisk = await makeRequest('PATCH', `/api/leasing/contracts-v2/${contractId}`, {
      status: 'ACTIVE',
    }, routeHeaders(tenant));
    expect(highRisk.status).toBe(409);
    expect((await highRisk.json()).code).toBe('CREDIT_RISK_TOO_HIGH');

    await prisma.leaseCreditAssessment.create({
      data: {
        lesseeId,
        assessmentDate: new Date(Date.now() + 3000),
        creditScore: 820,
        riskRating: 'LOW',
        creditLimit: 500000,
        currentExposure: 0,
        validUntil: new Date(Date.now() + 60 * 86400000),
        status: 'ACTIVE',
      },
    });

    const activated = await makeRequest('PATCH', `/api/leasing/contracts-v2/${contractId}`, {
      status: 'ACTIVE',
    }, routeHeaders(tenant));
    expect(activated.status).toBe(200);
    expect((await activated.json()).status).toBe('ACTIVE');
  }, 120_000);
});
