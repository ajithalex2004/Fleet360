import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { attachTenantToEntity } from '@/lib/cross-module-governance';
import { ensureRentalGovernance } from '@/lib/rental-governance';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, role = seed.role.code, extra: Record<string, string> = {}) {
  return {
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': role,
    'x-tenant-plan': seed.tenant.plan,
    'x-test-auth-bypass': 'fleet360-test-bypass',
    ...extra,
  };
}

describe('RAC governance hardening', () => {
  let tenantA: SeedResult;
  let tenantB: SeedResult;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    await ensureRentalGovernance();

    [tenantA, tenantB] = await Promise.all([
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
      seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN'),
    ]);
  }, 120_000);

  afterAll(async () => {
    await ensureRentalGovernance().catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_invoice_line_items WHERE invoice_id IN (SELECT id FROM rental_invoices WHERE tenant_id::text IN ($1,$2))`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_invoice_payments WHERE invoice_id IN (SELECT id FROM rental_invoices WHERE tenant_id::text IN ($1,$2))`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_invoices WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_agreements WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_bookings WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM rental_customers WHERE tenant_id::text IN ($1,$2)`, tenantA?.tenant.id ?? '', tenantB?.tenant.id ?? '').catch(() => {});
    await Promise.all([
      tenantA ? cleanupTenant(tenantA.tenant.id).then(() => cleanupUser(tenantA.user.id)) : Promise.resolve(),
      tenantB ? cleanupTenant(tenantB.tenant.id).then(() => cleanupUser(tenantB.user.id)) : Promise.resolve(),
    ]);
  }, 120_000);

  it('scopes RAC customers to the active tenant and audits create', async () => {
    if (!serverAvailable) return;

    const create = await makeRequest(
      'POST',
      '/api/rental/customers',
      {
        fullName: 'Tenant A RAC Customer',
        customerType: 'INDIVIDUAL',
        email: `rac-customer-a-${Date.now()}@example.com`,
        phone: '+971500000001',
      },
      routeHeaders(tenantA),
    );
    expect(create.status).toBe(201);
    const created = await create.json();

    const customerBId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_customers (id, full_name, customer_type, email, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NOW(),NOW())`,
      customerBId,
      'Tenant B RAC Customer',
      'INDIVIDUAL',
      `rac-customer-b-${Date.now()}@example.com`,
    );
    await attachTenantToEntity('rental_customers', customerBId, tenantB.tenant.id);

    const list = await makeRequest('GET', '/api/rental/customers', undefined, routeHeaders(tenantA));
    expect(list.status).toBe(200);
    const body = await list.json();
    const ids = (body as Array<{ id: string }>).map(row => row.id);
    expect(ids).toContain(created.id);
    expect(ids).not.toContain(customerBId);

    const blockedDetail = await makeRequest('GET', `/api/rental/customers/${customerBId}`, undefined, routeHeaders(tenantA));
    expect(blockedDetail.status).toBe(404);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type = 'RentalCustomer'
          AND action = 'CREATE'
          AND entity_id = $2`,
      tenantA.tenant.id,
      created.id,
    );
    expect(Number(auditRows[0]?.count ?? 0)).toBeGreaterThan(0);
  }, 120_000);

  it('blocks cross-tenant agreement creation and scopes invoice detail updates/deletes', async () => {
    if (!serverAvailable) return;

    const customerAId = randomUUID();
    const customerBId = randomUUID();
    const bookingAId = randomUUID();
    const bookingBId = randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_customers (id, full_name, customer_type, created_at, updated_at)
       VALUES
         ($1,'Agreement Customer A','INDIVIDUAL',NOW(),NOW()),
         ($2,'Agreement Customer B','INDIVIDUAL',NOW(),NOW())`,
      customerAId,
      customerBId,
    );
    await attachTenantToEntity('rental_customers', customerAId, tenantA.tenant.id);
    await attachTenantToEntity('rental_customers', customerBId, tenantB.tenant.id);

    await prisma.$executeRawUnsafe(
      `INSERT INTO rental_bookings
         (id, customer_id, pickup_date, dropoff_date, status, created_at, updated_at)
       VALUES
         ($1,$2,NOW(),NOW() + INTERVAL '2 day','PENDING',NOW(),NOW()),
         ($3,$4,NOW(),NOW() + INTERVAL '2 day','PENDING',NOW(),NOW())`,
      bookingAId,
      customerAId,
      bookingBId,
      customerBId,
    );
    await attachTenantToEntity('rental_bookings', bookingAId, tenantA.tenant.id);
    await attachTenantToEntity('rental_bookings', bookingBId, tenantB.tenant.id);

    const blockedAgreement = await makeRequest(
      'POST',
      '/api/rental/agreements',
      {
        bookingId: bookingBId,
        customerId: customerAId,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 172_800_000).toISOString(),
        status: 'DRAFT',
      },
      routeHeaders(tenantA),
    );
    expect(blockedAgreement.status).toBe(404);

    const agreementCreate = await makeRequest(
      'POST',
      '/api/rental/agreements',
      {
        bookingId: bookingAId,
        customerId: customerAId,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 172_800_000).toISOString(),
        dailyRate: 150,
        totalAmount: 300,
        status: 'DRAFT',
      },
      routeHeaders(tenantA),
    );
    expect(agreementCreate.status).toBe(201);
    const agreement = await agreementCreate.json();

    const invoiceCreate = await makeRequest(
      'POST',
      '/api/rental/invoices',
      {
        agreementId: agreement.id,
        customerId: customerAId,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        subtotal: 300,
        taxableAmount: 300,
        taxAmount: 15,
        totalAmount: 315,
        lineItems: [
          {
            lineType: 'RENTAL',
            description: 'Daily rental charge',
            quantity: 2,
            unitPrice: 150,
            amount: 300,
          },
        ],
      },
      routeHeaders(tenantA),
    );
    expect(invoiceCreate.status).toBe(201);
    const invoice = await invoiceCreate.json();

    const blockedRead = await makeRequest('GET', `/api/rental/invoices/${invoice.id}`, undefined, routeHeaders(tenantB));
    expect(blockedRead.status).toBe(404);

    const update = await makeRequest(
      'PUT',
      `/api/rental/invoices/${invoice.id}`,
      {
        notes: 'Approved for customer delivery',
        internalNotes: 'Tenant A ops note',
      },
      routeHeaders(tenantA),
    );
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(String(updated.notes ?? '')).toContain('Approved for customer delivery');

    const blockedDelete = await makeRequest('DELETE', `/api/rental/invoices/${invoice.id}`, undefined, routeHeaders(tenantB));
    expect(blockedDelete.status).toBe(404);

    const deleted = await makeRequest('DELETE', `/api/rental/invoices/${invoice.id}`, undefined, routeHeaders(tenantA));
    expect(deleted.status).toBe(200);

    const auditRows = await prisma.$queryRawUnsafe<Array<{ entity_type: string; action: string; count: bigint }>>(
      `SELECT entity_type, action, COUNT(*)::bigint AS count
         FROM admin_change_history
        WHERE tenant_id = $1
          AND entity_type = 'RentalInvoice'
          AND entity_id = $2
          AND action IN ('CREATE', 'UPDATE', 'DELETE')
        GROUP BY entity_type, action`,
      tenantA.tenant.id,
      invoice.id,
    );
    const actions = auditRows.map(row => row.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('DELETE');
  }, 120_000);
});
