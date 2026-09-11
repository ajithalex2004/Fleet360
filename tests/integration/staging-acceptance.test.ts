/**
 * Staging Acceptance Verification Suite
 * Target Database: neondb_staging
 * Runtime Principle: fleet360_app
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { signSession } from '@/lib/tenant-session';
import { POST as quotationsPOST, GET as quotationsGET } from '@/app/api/leasing/quotations/route';
import { POST as costsPOST, GET as costsGET } from '@/app/api/service-tickets/[id]/costs/route';
import { withTenantRls } from '@/lib/rls';

const stagingRuntimeUrl =
  'postgresql://fleet360_app:87f855bb8b0d868fc1b4d4f1038b283ae2895405ac563ec1@ep-calm-heart-a15voo2a-pooler.ap-southeast-1.aws.neon.tech/neondb_staging?sslmode=require&channel_binding=require';

// Ensure the application uses the staging runtime database
process.env.DATABASE_URL = stagingRuntimeUrl;
process.env.DIRECT_URL = stagingRuntimeUrl;

const prisma = new PrismaClient({
  datasources: { db: { url: stagingRuntimeUrl } },
});

describe('Staging Acceptance Verification Suite (neondb_staging / fleet360_app)', () => {
  const tenantAlpha = 'tenant-staging-alpha';
  const tenantBeta = 'tenant-staging-beta';
  const lesseeAlpha = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const lesseeBeta = '22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const ticketAlpha = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const ticketBeta = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

  let sessionTokenAlpha: string;
  let sessionTokenBeta: string;
  let createdQuotationId: string;

  beforeAll(async () => {
    // 1. Verify connected role and database
    const [dbInfo] = await prisma.$queryRawUnsafe<Array<{ current_user: string; current_database: string }>>(
      `SELECT current_user, current_database()`
    );
    expect(dbInfo.current_user).toBe('fleet360_app');
    expect(dbInfo.current_database).toBe('neondb_staging');

    // 2. Generate cryptographically signed sessions
    sessionTokenAlpha = await signSession({
      userId: 'user-alpha-admin',
      tenantId: tenantAlpha,
      role: 'TENANT_ADMIN',
      plan: 'ENTERPRISE',
    });

    sessionTokenBeta = await signSession({
      userId: 'user-beta-admin',
      tenantId: tenantBeta,
      role: 'TENANT_ADMIN',
      plan: 'PRO',
    });

    // Clean any previous test artifacts in staging
    await withTenantRls(prisma, tenantAlpha, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotation_items WHERE tenant_id = $1`, tenantAlpha);
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotation_vehicles WHERE tenant_id = $1`, tenantAlpha);
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotations WHERE tenant_id = $1`, tenantAlpha);
      await tx.$executeRawUnsafe(`DELETE FROM service_case_costs WHERE tenant_id = $1`, tenantAlpha);
    });
    await withTenantRls(prisma, tenantBeta, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotation_items WHERE tenant_id = $1`, tenantBeta);
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotation_vehicles WHERE tenant_id = $1`, tenantBeta);
      await tx.$executeRawUnsafe(`DELETE FROM lease_quotations WHERE tenant_id = $1`, tenantBeta);
      await tx.$executeRawUnsafe(`DELETE FROM service_case_costs WHERE tenant_id = $1`, tenantBeta);
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Gate 4.1: Quotation Creation & Persistence Workflow
  // ---------------------------------------------------------------------------
  it('4.1: creates quotation with line items and vehicles, persists to DB, and isolates from Tenant Beta', async () => {
    const payload = {
      lesseeId: lesseeAlpha,
      monthlyRate: 3500,
      durationMonths: 12,
      accessoriesCost: 250,
      servicesCost: 150,
      insuranceIncluded: true,
      insuranceCost: 300,
      vehicles: [
        { vehicleType: 'SEDAN', make: 'Toyota', model: 'Camry', year: 2025, quantity: 1, monthlyRate: 3500 },
      ],
      lineItems: [
        { itemType: 'GPS', description: 'Telematics Tracker', quantity: 1, unitRate: 50, monthlyAmount: 50 },
      ],
    };

    const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await quotationsPOST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBeDefined();
    expect(json.tenantId).toBe(tenantAlpha);
    expect(json.quotationNumber).toMatch(/^QUO-\d{4}$/);
    expect(json.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(json.lineItems.length).toBeGreaterThanOrEqual(1);

    createdQuotationId = json.id;

    // Tenant Alpha retrieves the quotation via GET
    const getAlphaReq = new NextRequest('http://localhost:3000/api/leasing/quotations', {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
    });
    const getAlphaRes = await quotationsGET(getAlphaReq);
    expect(getAlphaRes.status).toBe(200);
    const getAlphaJson = await getAlphaRes.json();
    expect(getAlphaJson.some((q: any) => q.id === createdQuotationId)).toBe(true);

    // Tenant Beta retrieves quotations via GET � must be 0 (RLS isolation)
    const getBetaReq = new NextRequest('http://localhost:3000/api/leasing/quotations', {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantBeta,
        'x-user-id': 'user-beta-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenBeta}`,
      },
    });
    const getBetaRes = await quotationsGET(getBetaReq);
    expect(getBetaRes.status).toBe(200);
    const getBetaJson = await getBetaRes.json();
    expect(getBetaJson).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Gate 4.2: Cross-Tenant Customer Reference Rejection
  // ---------------------------------------------------------------------------
  it('4.2: strictly rejects quotation creation referencing another tenant customer with HTTP 400', async () => {
    const crossTenantPayload = {
      lesseeId: lesseeBeta, // Belongs to Tenant Beta!
      monthlyRate: 4000,
      durationMonths: 24,
    };

    const crossReq = new NextRequest('http://localhost:3000/api/leasing/quotations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
      body: JSON.stringify(crossTenantPayload),
    });

    const crossRes = await quotationsPOST(crossReq);
    expect(crossRes.status).toBe(400);
    const crossJson = await crossRes.json();
    expect(crossJson.error).toContain('not found in current tenant');
  });

  // ---------------------------------------------------------------------------
  // Gate 4.3: Concurrency & Serial Number Generation
  // ---------------------------------------------------------------------------
  it('4.3: generates distinct sequential quotation numbers under concurrent load without duplicates', async () => {
    const count = 5;
    const concurrentReqs = Array.from({ length: count }).map((_, i) => {
      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': tenantAlpha,
          'x-user-id': 'user-alpha-admin',
          'x-user-role': 'TENANT_ADMIN',
          'cookie': `xl-session=${sessionTokenAlpha}`,
        },
        body: JSON.stringify({
          lesseeId: lesseeAlpha,
          monthlyRate: 2000 + i * 100,
          notes: `Concurrency test line ${i + 1}`,
        }),
      });
      return quotationsPOST(req).then(async (r) => ({ status: r.status, data: await r.json() }));
    });

    const results = await Promise.all(concurrentReqs);
    for (const r of results) {
      expect(r.status).toBe(201);
    }

    const quotationNumbers = results.map((r) => r.data.quotationNumber);
    const uniqueSerials = new Set(quotationNumbers);
    expect(uniqueSerials.size).toBe(count);
  });

  // ---------------------------------------------------------------------------
  // Gate 4.4: Quotation Rollback on Failure
  // ---------------------------------------------------------------------------
  it('4.4: rolls back transaction cleanly on midway failure leaving no orphaned records', async () => {
    const countBefore = await withTenantRls(prisma, tenantAlpha, async (tx) => {
      return tx.leaseQuotation.count({ where: { tenantId: tenantAlpha } });
    });

    await expect(
      withTenantRls(prisma, tenantAlpha, async (tx) => {
        await tx.leaseQuotation.create({
          data: {
            tenantId: tenantAlpha,
            quotationNumber: 'QUO-ABORT-TEST',
            status: 'DRAFT',
          },
        });
        throw new Error('Simulated midway failure to trigger transaction rollback');
      })
    ).rejects.toThrow('Simulated midway failure');

    const countAfter = await withTenantRls(prisma, tenantAlpha, async (tx) => {
      return tx.leaseQuotation.count({ where: { tenantId: tenantAlpha } });
    });

    expect(countAfter).toBe(countBefore);
  });

  // ---------------------------------------------------------------------------
  // Gate 4.5: Cost-Ledger Multi-Line Workflow & RLS Isolation
  // ---------------------------------------------------------------------------
  it('4.5: creates multiple cost lines, computes summary, and enforces strict tenant isolation on tickets', async () => {
    // 1. Add TOWING cost to Alpha ticket
    const costReq1 = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketAlpha}/costs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
      body: JSON.stringify({
        costType: 'TOWING',
        estimatedAmount: 300,
        approvedAmount: 300,
        actualAmount: 320,
        currency: 'AED',
        payerType: 'TENANT',
        vendorName: 'Desert Towing LLC',
        invoiceReference: 'INV-TOW-101',
      }),
    });
    const costRes1 = await costsPOST(costReq1, { params: Promise.resolve({ id: ticketAlpha }) });
    expect(costRes1.status).toBe(201);

    // 2. Add PARTS cost to Alpha ticket
    const costReq2 = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketAlpha}/costs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
      body: JSON.stringify({
        costType: 'PARTS',
        estimatedAmount: 800,
        approvedAmount: 750,
        actualAmount: 750,
        currency: 'AED',
        payerType: 'CUSTOMER',
        customerRechargeStatus: 'PENDING',
        notes: 'Brake pads replacement chargeable to lessee',
      }),
    });
    const costRes2 = await costsPOST(costReq2, { params: Promise.resolve({ id: ticketAlpha }) });
    expect(costRes2.status).toBe(201);

    // 3. GET /api/service-tickets/[id]/costs as Tenant Alpha
    const getCostReqAlpha = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketAlpha}/costs`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantAlpha,
        'x-user-id': 'user-alpha-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenAlpha}`,
      },
    });
    const getCostResAlpha = await costsGET(getCostReqAlpha, { params: Promise.resolve({ id: ticketAlpha }) });
    expect(getCostResAlpha.status).toBe(200);
    const getCostJsonAlpha = await getCostResAlpha.json();
    expect(getCostJsonAlpha.costs).toHaveLength(2);
    expect(getCostJsonAlpha.summary.totalEstimated).toBe(1100);
    expect(getCostJsonAlpha.summary.totalApproved).toBe(1050);
    expect(getCostJsonAlpha.summary.totalActual).toBe(1070);
    expect(getCostJsonAlpha.summary.customerRechargePending).toBe(750);

    // 4. Cross-tenant read: Tenant Beta attempts to view Alpha's ticket costs -> 404
    const crossGetReq = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketAlpha}/costs`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantBeta,
        'x-user-id': 'user-beta-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenBeta}`,
      },
    });
    const crossGetRes = await costsGET(crossGetReq, { params: Promise.resolve({ id: ticketAlpha }) });
    expect(crossGetRes.status).toBe(404);

    // 5. Cross-tenant write: Tenant Beta attempts to add cost to Alpha's ticket -> 404
    const crossAddReq = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketAlpha}/costs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantBeta,
        'x-user-id': 'user-beta-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenBeta}`,
      },
      body: JSON.stringify({ costType: 'OTHER', estimatedAmount: 50, currency: 'AED' }),
    });
    const crossAddRes = await costsPOST(crossAddReq, { params: Promise.resolve({ id: ticketAlpha }) });
    expect(crossAddRes.status).toBe(404);

    // 6. Tenant Beta adds cost to Beta's ticket -> succeeds in Beta's partition
    const betaAddReq = new NextRequest(`http://localhost:3000/api/service-tickets/${ticketBeta}/costs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenantBeta,
        'x-user-id': 'user-beta-admin',
        'x-user-role': 'TENANT_ADMIN',
        'cookie': `xl-session=${sessionTokenBeta}`,
      },
      body: JSON.stringify({
        costType: 'LABOUR',
        estimatedAmount: 500,
        approvedAmount: 500,
        actualAmount: 480,
        currency: 'AED',
        payerType: 'TENANT',
        vendorName: 'Beta Auto Garage',
      }),
    });
    const betaAddRes = await costsPOST(betaAddReq, { params: Promise.resolve({ id: ticketBeta }) });
    expect(betaAddRes.status).toBe(201);
  });

  // ---------------------------------------------------------------------------
  // Gate 7: Previous Application Version Compatibility (Rollback Readiness)
  // ---------------------------------------------------------------------------
  it('7.0: proves previous application version queries execute cleanly under fleet360_app on neondb_staging without runtime DDL', async () => {
    const oldAppExecution = await withTenantRls(prisma, tenantAlpha, async (tx) => {
      // 1. SELECT query used by old app
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, ticket_id, cost_type, actual_amount, currency FROM service_case_costs WHERE tenant_id = $1`,
        tenantAlpha
      );

      // 2. INSERT query used by old app without DDL
      const [inserted] = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO service_case_costs (
          tenant_id, ticket_id, cost_type, estimated_amount, approved_amount, actual_amount, currency, payer_type, customer_recharge_status, created_at, updated_at
        ) VALUES (
          $1, $2::uuid, 'STORAGE', 100, 100, 100, 'AED', 'TENANT', 'NOT_APPLICABLE', NOW(), NOW()
        ) RETURNING id, cost_type`,
        tenantAlpha,
        ticketAlpha
      );

      return { priorCount: rows.length, insertedId: inserted.id };
    });

    expect(oldAppExecution.priorCount).toBeGreaterThanOrEqual(2);
    expect(oldAppExecution.insertedId).toBeDefined();
  });
});
