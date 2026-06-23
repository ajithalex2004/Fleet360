import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity } from '@/lib/cross-module-governance';
import { ensureFinanceSourceLedger } from '@/lib/finance-source-ledger';
import {
  cleanupTenant,
  cleanupUser,
  createAuthHeaders,
  createSessionToken,
  createTestUser,
  createTestUserTenant,
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

async function ensurePermission(module: string, action: string, resource = '*') {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO permissions (id, module, action, resource, label, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (module, action, resource)
     DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    randomUUID(),
    module,
    action,
    resource,
    `${module}:${action}:${resource}`,
    'Finance leasing billing consolidation test permission',
  );
  return rows[0].id;
}

async function createLessee(name: string) {
  return prisma.lessee.create({
    data: {
      name,
      type: 'corporate',
      tradeLicense: `TL-FIN-${Date.now()}`,
      email: `${name.toLowerCase().replace(/\W+/g, '-')}@example.com`,
    },
  });
}

describe('Finance Leasing Billing consolidation', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;
  let lesseeId = '';
  let contractId = '';
  let invoiceId = '';
  let financeInvoiceId = '';
  let duplicateFinanceInvoiceId = '';
  let orphanFinanceInvoiceId = '';
  let viewerRoleId = '';
  let viewerUserId = '';
  let financeViewPermissionId = '';
  let financeDirectDebitId = '';
  let financeCreatePermissionId = '';
  let financeEditPermissionId = '';
  let financeApprovePermissionId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
    await ensureLeasingTenantColumns();
    await ensureFinanceSourceLedger();

    const lessee = await createLessee('Finance Leasing Consolidation Customer');
    lesseeId = lessee.id;

    const contract = await prisma.leaseContract2.create({
      data: {
        contractNumber: `FLC-${Date.now()}`,
        lesseeId,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2027-06-30T00:00:00.000Z'),
        monthlyRate: 7000,
        totalContractValue: 84000,
        currency: 'AED',
        status: 'ACTIVE',
      },
    });
    await attachTenantToEntity('lease_contracts_v2', contract.id, tenantA.tenant.id);
    contractId = contract.id;

    const invoice = await prisma.leaseInvoice.create({
      data: {
        invoiceNo: `INV-FLC-${Date.now()}`,
        lesseeId,
        billingPeriod: '2026-07',
        issueDate: new Date('2026-07-01T00:00:00.000Z'),
        dueDate: new Date('2026-07-31T00:00:00.000Z'),
        subTotal: 7000,
        vatPct: 5,
        vatAmount: 350,
        totalAmount: 7350,
        currency: 'AED',
        status: 'SENT',
        lines: {
          create: [{
            contractId,
            description: 'Base rent July 2026',
            lineType: 'RENT',
            quantity: 1,
            unitAmount: 7000,
            totalAmount: 7000,
            currency: 'AED',
          }],
        },
      },
      include: { lines: true },
    });
    invoiceId = invoice.id;

    [financeViewPermissionId, financeCreatePermissionId, financeEditPermissionId, financeApprovePermissionId] = await Promise.all([
      ensurePermission('finance', 'view', 'leasing_billing'),
      ensurePermission('finance', 'create', 'leasing_billing'),
      ensurePermission('finance', 'edit', 'leasing_billing'),
      ensurePermission('finance', 'approve', 'leasing_billing'),
    ]);
    await prisma.rolePermission.createMany({
      data: [
        { roleId: tenantA.role.id, permissionId: financeViewPermissionId },
        { roleId: tenantA.role.id, permissionId: financeCreatePermissionId },
        { roleId: tenantA.role.id, permissionId: financeEditPermissionId },
        { roleId: tenantA.role.id, permissionId: financeApprovePermissionId },
        { roleId: tenantB.role.id, permissionId: financeViewPermissionId },
        { roleId: tenantB.role.id, permissionId: financeCreatePermissionId },
        { roleId: tenantB.role.id, permissionId: financeEditPermissionId },
        { roleId: tenantB.role.id, permissionId: financeApprovePermissionId },
      ],
      skipDuplicates: true,
    });
    const viewerRole = await prisma.role.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA.tenant.id,
        name: 'Finance Leasing Billing Viewer',
        code: `FINANCE_LEASING_VIEWER_${Date.now()}`,
        description: 'Read-only finance leasing billing access',
        isSystem: false,
        permissions: {
          create: [{ permissionId: financeViewPermissionId }],
        },
      },
    });
    viewerRoleId = viewerRole.id;
    const viewerUser = await createTestUser();
    viewerUserId = viewerUser.id;
    await createTestUserTenant(viewerUser.id, tenantA.tenant.id, viewerRole.id);
  }, 120_000);

  afterAll(async () => {
    if (duplicateFinanceInvoiceId) {
      await prisma.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE id::text = $1`, duplicateFinanceInvoiceId).catch(() => {});
    }
    if (orphanFinanceInvoiceId) {
      await prisma.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE id::text = $1`, orphanFinanceInvoiceId).catch(() => {});
    }
    if (financeInvoiceId) {
      await prisma.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE id::text = $1`, financeInvoiceId).catch(() => {});
    }
    if (financeDirectDebitId) {
      await prisma.leaseDirectDebit.deleteMany({ where: { id: financeDirectDebitId } }).catch(() => {});
    }
    if (lesseeId) {
      await prisma.leaseDirectDebit.deleteMany({ where: { lesseeId } }).catch(() => {});
    }
    if (viewerRoleId) {
      await prisma.userTenant.deleteMany({ where: { roleId: viewerRoleId } }).catch(() => {});
      await prisma.rolePermission.deleteMany({ where: { roleId: viewerRoleId } }).catch(() => {});
      await prisma.role.delete({ where: { id: viewerRoleId } }).catch(() => {});
    }
    if (viewerUserId) await cleanupUser(viewerUserId);
    if (invoiceId) {
      await prisma.leaseInvoiceLine.deleteMany({ where: { invoiceId } }).catch(() => {});
      await prisma.leaseInvoice.deleteMany({ where: { id: invoiceId } }).catch(() => {});
    }
    if (contractId) await prisma.leaseContract2.delete({ where: { id: contractId } }).catch(() => {});
    if (lesseeId) await prisma.lessee.delete({ where: { id: lesseeId } }).catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('reports missing Finance mirrors and backfills source-tagged Leasing invoices', async () => {
    if (!serverAvailable) return;

    await prisma.$executeRawUnsafe(
      `DELETE FROM finance_invoices
        WHERE tenant_id = $1
          AND module_source = 'LEASING'
          AND reference_type = 'LEASE_INVOICE'
          AND reference_id::text = $2`,
      tenantA.tenant.id,
      invoiceId,
    ).catch(() => {});

    const before = await makeRequest('GET', '/api/finance/leasing-billing/reconciliation', undefined, routeHeaders(tenantA));
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.rows.some((row: Record<string, unknown>) => row.leaseInvoiceId === invoiceId && row.mirrored === false)).toBe(true);
    expect(beforeBody.missingFinanceMirror).toBeGreaterThanOrEqual(1);

    const backfill = await makeRequest('POST', '/api/finance/leasing-billing/reconciliation', undefined, routeHeaders(tenantA));
    expect(backfill.status).toBe(200);
    const backfillBody = await backfill.json();
    expect(backfillBody.processed).toBeGreaterThanOrEqual(1);
    const mirrored = backfillBody.reconciliation.rows.find((row: Record<string, unknown>) => row.leaseInvoiceId === invoiceId);
    expect(mirrored).toMatchObject({ mirrored: true, totalMatches: true });
    financeInvoiceId = String(mirrored.financeInvoiceId);

    const financeRows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      module_source: string;
      reference_type: string;
      reference_id: string;
      source_entity_id: string;
      tenant_id: string;
      total_amount: string;
    }>>(
      `SELECT id::text, module_source, reference_type, reference_id::text, source_entity_id, tenant_id, total_amount::text
         FROM finance_invoices
        WHERE id::text = $1`,
      financeInvoiceId,
    );
    expect(financeRows[0]).toMatchObject({
      module_source: 'LEASING',
      reference_type: 'LEASE_INVOICE',
      reference_id: invoiceId,
      source_entity_id: invoiceId,
      tenant_id: tenantA.tenant.id,
    });
    expect(Number(financeRows[0]?.total_amount)).toBe(7350);

    const historyColumns = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_name = 'admin_change_history'
            AND column_name = 'source_module'
       ) AS exists`
    );
    if (historyColumns[0]?.exists) {
      const historyRows = await prisma.$queryRawUnsafe<Array<{
        entity_type: string;
        entity_id: string | null;
        source_module: string | null;
        source_entity_type: string | null;
        source_entity_id: string | null;
        related_entity_type: string | null;
        related_entity_id: string | null;
      }>>(
        `SELECT entity_type, entity_id, source_module, source_entity_type, source_entity_id, related_entity_type, related_entity_id
           FROM admin_change_history
          WHERE tenant_id = $1
            AND entity_type = 'FinanceInvoice'
            AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        tenantA.tenant.id,
        financeInvoiceId,
      );
      expect(historyRows[0]).toMatchObject({
        entity_type: 'FinanceInvoice',
        entity_id: financeInvoiceId,
        source_module: 'LEASING',
        source_entity_type: 'LeaseInvoice',
        source_entity_id: invoiceId,
        related_entity_type: 'LeaseInvoice',
        related_entity_id: invoiceId,
      });
    } else {
      const historyRows = await prisma.$queryRawUnsafe<Array<{
        entity_type: string;
        entity_id: string | null;
      }>>(
        `SELECT entity_type, entity_id
           FROM admin_change_history
          WHERE tenant_id = $1
            AND entity_type = 'FinanceInvoice'
            AND entity_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        tenantA.tenant.id,
        financeInvoiceId,
      );
      expect(historyRows[0]).toMatchObject({
        entity_type: 'FinanceInvoice',
        entity_id: financeInvoiceId,
      });
    }
  }, 120_000);

  it('supports Finance source filters and preserves tenant boundary', async () => {
    if (!serverAvailable) return;

    const financeList = await makeRequest(
      'GET',
      '/api/finance/invoices?sourceModule=LEASING&referenceType=LEASE_INVOICE',
      undefined,
      routeHeaders(tenantA),
    );
    expect(financeList.status).toBe(200);
    const financeBody = await financeList.json();
    expect(JSON.stringify(financeBody.data)).toContain(invoiceId);

    const tenantBReconciliation = await makeRequest('GET', '/api/finance/leasing-billing/reconciliation', undefined, routeHeaders(tenantB));
    expect(tenantBReconciliation.status).toBe(200);
    const tenantBBody = await tenantBReconciliation.json();
    expect(JSON.stringify(tenantBBody.rows)).not.toContain(invoiceId);

    const tenantBFinanceList = await makeRequest(
      'GET',
      '/api/finance/invoices?sourceModule=LEASING&referenceType=LEASE_INVOICE',
      undefined,
      routeHeaders(tenantB),
    );
    expect(tenantBFinanceList.status).toBe(200);
    const tenantBFinanceBody = await tenantBFinanceList.json();
    expect(JSON.stringify(tenantBFinanceBody.data)).not.toContain(invoiceId);
  }, 120_000);

  it('flags duplicate mirrors and orphan finance records in reconciliation', async () => {
    if (!serverAvailable) return;

    const duplicates = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO finance_invoices
         (invoice_number, client_name, service_type, module, module_source, description,
          line_items, subtotal, discount_amount, vat_rate, vat_amount, total_amount,
          paid_amount, currency, issue_date, due_date, payment_status, notes,
          reference_id, reference_type, created_by, tenant_id, source_entity_type,
          source_entity_id, source_entity_no, source_customer_id, source_customer_name, source_contract_ids, source_payload)
       VALUES
         ($1,$2,'LEASING','LEASING','LEASING',$3,'[]'::jsonb,$4,0,5,$5,$6,0,'AED',$7::date,$8::date,'DRAFT',$9,$10::uuid,'LEASE_INVOICE',$11,$12,'LEASE_INVOICE',$13,$14,$15,$16,$17::text[],$18::jsonb)
       RETURNING id::text`,
      `LSE-DUP-${Date.now()}`,
      'Duplicate Mirror Customer',
      'Duplicate mirror test row',
      7000,
      350,
      7350,
      '2026-07-01',
      '2026-07-31',
      'duplicate mirror',
      invoiceId,
      tenantA.user.id,
      tenantA.tenant.id,
      invoiceId,
      `INV-DUP-${Date.now()}`,
      lesseeId,
      'Duplicate Mirror Customer',
      [contractId],
      JSON.stringify({ test: 'duplicate' }),
    );
    duplicateFinanceInvoiceId = duplicates[0]?.id ?? '';

    const orphans = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO finance_invoices
         (invoice_number, client_name, service_type, module, module_source, description,
          line_items, subtotal, discount_amount, vat_rate, vat_amount, total_amount,
          paid_amount, currency, issue_date, due_date, payment_status, notes,
          reference_id, reference_type, created_by, tenant_id, source_entity_type,
          source_entity_id, source_entity_no, source_customer_id, source_customer_name, source_contract_ids, source_payload)
       VALUES
         ($1,$2,'LEASING','LEASING','LEASING',$3,'[]'::jsonb,$4,0,5,$5,$6,0,'AED',$7::date,$8::date,'SENT',$9,$10::uuid,'LEASE_INVOICE',$11,$12,'LEASE_INVOICE',$13,$14,$15,$16,$17::text[],$18::jsonb)
       RETURNING id::text`,
      `LSE-ORPH-${Date.now()}`,
      'Orphan Mirror Customer',
      'Orphan mirror test row',
      1000,
      50,
      1050,
      '2026-07-01',
      '2026-07-31',
      'orphan mirror',
      '11111111-1111-1111-1111-111111111111',
      tenantA.user.id,
      tenantA.tenant.id,
      '11111111-1111-1111-1111-111111111111',
      'INV-ORPHAN',
      lesseeId,
      'Orphan Mirror Customer',
      [contractId],
      JSON.stringify({ test: 'orphan' }),
    );
    orphanFinanceInvoiceId = orphans[0]?.id ?? '';

    await prisma.leaseInvoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: new Date('2026-07-15T00:00:00.000Z') },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET payment_status = 'SENT'
        WHERE id::text = $1`,
      financeInvoiceId,
    ).catch(() => {});

    const recon = await makeRequest('GET', '/api/finance/leasing-billing/reconciliation', undefined, routeHeaders(tenantA));
    expect(recon.status).toBe(200);
    const body = await recon.json();
    expect(body.duplicateMirrors).toBeGreaterThanOrEqual(1);
    expect(body.orphanFinanceMirrors).toBeGreaterThanOrEqual(1);
    expect(body.statusMismatches).toBeGreaterThanOrEqual(1);
    expect(body.orphanRows.some((row: Record<string, unknown>) => row.financeInvoiceId === orphanFinanceInvoiceId)).toBe(true);
    const invoiceRow = body.rows.find((row: Record<string, unknown>) => row.leaseInvoiceId === invoiceId);
    expect(invoiceRow).toMatchObject({
      mirrored: true,
      statusMatches: false,
    });
  }, 120_000);

  it('lets a finance leasing billing viewer read reconciliation but blocks backfill mutation', async () => {
    if (!serverAvailable) return;

    const token = await createSessionToken(viewerUserId, tenantA.tenant.id, tenantA.tenant.plan, 'TENANT_ADMIN');
    const headers = {
      ...createAuthHeaders(token),
      'x-user-id': viewerUserId,
      'x-tenant-id': tenantA.tenant.id,
      'x-user-role': 'TENANT_ADMIN',
      'x-tenant-plan': tenantA.tenant.plan,
    };

    const readable = await makeRequest('GET', '/api/finance/leasing-billing/reconciliation', undefined, headers);
    expect(readable.status).toBe(200);

    const blocked = await makeRequest('POST', '/api/finance/leasing-billing/reconciliation', undefined, headers);
    expect(blocked.status).toBe(403);
    const blockedBody = await blocked.json();
    expect(String(blockedBody.message ?? '')).toContain('reconcile Leasing Billing mirrors');
  }, 120_000);

  it('moves legacy Leasing billing writes to Finance aliases while keeping Finance write path active', async () => {
    if (!serverAvailable) return;

    const legacy = await makeRequest(
      'POST',
      '/api/leasing/direct-debits',
      {
        lesseeId,
        bankName: 'Legacy Bank',
        accountName: 'Legacy Account',
        iban: 'AE070331234567890123456',
        collectionDay: 5,
        currency: 'AED',
      },
      routeHeaders(tenantA),
    );
    expect(legacy.status).toBe(410);
    const legacyBody = await legacy.json();
    expect(legacyBody.movedTo).toBe('/api/finance/leasing-billing/direct-debits');

    const finance = await makeRequest(
      'POST',
      '/api/finance/leasing-billing/direct-debits',
      {
        lesseeId,
        bankName: 'Finance Bank',
        accountName: 'Finance Account',
        iban: 'AE070331234567890123456',
        collectionDay: 5,
        currency: 'AED',
      },
      routeHeaders(tenantA),
    );
    expect(finance.status).toBe(201);
    const financeBody = await finance.json();
    financeDirectDebitId = String(financeBody.id);
    expect(financeBody.mandateRef).toBeTruthy();
  }, 120_000);
});
