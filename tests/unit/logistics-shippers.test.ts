/**
 * tests/unit/logistics-shippers.test.ts
 *
 * Logistics > Shippers failed for every tenant with "listShipperOnboarding is
 * not yet implemented". The four shipper functions in src/lib/logistics/
 * domain.ts are implemented now. Runs against a PostgreSQL built from the
 * migrations when SHIPPERS_TEST_DATABASE_URL is set; skipped otherwise.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Only ever the test database — never the .env DATABASE_URL.
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client');
  return { prisma: new PrismaClient({ datasourceUrl: process.env.SHIPPERS_TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:1/unused' }) };
});

import { prisma } from '@/lib/prisma';
import {
  listShipperOnboarding, getShipperOnboarding, onboardShipperCustomer, updateShipperOnboarding, LogisticsValidationError,
} from '@/lib/logistics/domain';

const A = 'tenant-ship-a';
const B = 'tenant-ship-b';
const suite = process.env.SHIPPERS_TEST_DATABASE_URL ? describe : describe.skip;

suite('shipper onboarding (PostgreSQL)', () => {
  beforeAll(async () => {
    const x = (sql: string, ...a: unknown[]) => prisma.$executeRawUnsafe(sql, ...a);
    for (const t of [A, B]) {
      await x(`DELETE FROM customer_portal_invitations WHERE tenant_id = $1`, t);
      await x(`DELETE FROM customer_portal_users WHERE tenant_id = $1`, t);
      await x(`DELETE FROM logistics_shipping_requests WHERE tenant_id = $1`, t);
      await x(`DELETE FROM logistics_customer_marketplace_settings WHERE tenant_id = $1`, t);
      await x(`DELETE FROM customers WHERE tenant_id = $1`, t);
    }
    await x(`INSERT INTO tenants (id, name) VALUES ($1, 'Shipper Test A'), ($2, 'Shipper Test B') ON CONFLICT (id) DO NOTHING`, A, B);
    // Tenant A: a shipper with freight activity, a plain (non-shipper) customer.
    await x(`INSERT INTO customers (id, tenant_id, customer_type, name_en, customer_code, email, trade_license)
             VALUES ('cust-gulf', $1, 'CORPORATE', 'Gulf Foods LLC', 'CORP-T-1', 'ops@gulf.test', 'TL-100'),
                    ('cust-rac', $1, 'INDIVIDUAL', 'Rental Customer', 'CUST-T-2', NULL, NULL)`, A);
    await x(`INSERT INTO logistics_shipping_requests (tenant_id, request_no, shipper_id, status)
             VALUES ($1, 'SR-1', 'cust-gulf', 'SUBMITTED'), ($1, 'SR-2', 'cust-gulf', 'UNDER_REVIEW'), ($1, 'SR-3', 'cust-gulf', 'ACCEPTED')`, A);
    await x(`INSERT INTO customer_portal_users (id, tenant_id, customer_id, email, password_hash, is_active)
             VALUES ('aaaaaaaa-0000-4000-8000-000000000001', $1, 'cust-gulf', 'a@gulf.test', 'hash', true),
                    ('aaaaaaaa-0000-4000-8000-000000000002', $1, 'cust-gulf', 'b@gulf.test', NULL, true)`, A);
    await x(`INSERT INTO customer_portal_invitations (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
             VALUES ($1, 'aaaaaaaa-0000-4000-8000-000000000002', 'tok', NOW() + INTERVAL '3 days', 'admin')`, A);
    // Tenant B: its own shipper.
    await x(`INSERT INTO customers (id, tenant_id, customer_type, name_en) VALUES ('cust-b', $1, 'CORPORATE', 'Other Tenant Shipper')`, B);
    await x(`INSERT INTO logistics_customer_marketplace_settings (tenant_id, customer_id, customer_name) VALUES ($1, 'cust-b', 'Other Tenant Shipper')`, B);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('lists the tenant\'s shippers with portal and freight activity', async () => {
    const list = await listShipperOnboarding({ tenantId: A, limit: 50 });
    expect(list.map((s) => s.id)).toEqual(['cust-gulf']); // not the rental customer
    expect(list[0]).toMatchObject({
      name: 'Gulf Foods LLC', customerCode: 'CORP-T-1', tradeLicense: 'TL-100',
      onboardingStatus: 'DRAFT', complianceStatus: 'PENDING', trackingLevel: 'STATUS_ONLY',
      activePortalUsers: 1, pendingPortalUsers: 1, portalEnabled: true,
      shipmentOrderCount: 0, openRequestCount: 2,
    });
  });

  it('does not show another tenant\'s shippers', async () => {
    expect((await listShipperOnboarding({ tenantId: B, limit: 50 })).map((s) => s.id)).toEqual(['cust-b']);
    expect(await getShipperOnboarding({ tenantId: B, customerId: 'cust-gulf' })).toBeNull();
  });

  it('onboards a shipper, who then appears in the list', async () => {
    const s = await onboardShipperCustomer({ tenantId: A, name: '  Desert Cargo  ', email: 'd@desert.test', creditLimit: 50000, onboardingStatus: 'in_review' });
    expect(s).toMatchObject({ name: 'Desert Cargo', email: 'd@desert.test', creditLimit: 50000, onboardingStatus: 'IN_REVIEW', complianceStatus: 'PENDING', portalEnabled: false });
    expect(s.customerCode).toMatch(/^SHP-[A-Z2-9]{6}$/);
    const names = (await listShipperOnboarding({ tenantId: A, limit: 50 })).map((x) => x.name);
    expect(names).toEqual(['Desert Cargo', 'Gulf Foods LLC']);
  });

  it('filters by status and searches by name, code, email or trade licence', async () => {
    expect((await listShipperOnboarding({ tenantId: A, onboardingStatus: 'IN_REVIEW', limit: 50 })).map((s) => s.name)).toEqual(['Desert Cargo']);
    expect((await listShipperOnboarding({ tenantId: A, search: 'tl-100', limit: 50 })).map((s) => s.name)).toEqual(['Gulf Foods LLC']);
    expect((await listShipperOnboarding({ tenantId: A, search: '100%', limit: 50 }))).toEqual([]); // % is literal
  });

  it('updates onboarding fields, leaving unspecified ones as they are', async () => {
    const s = await updateShipperOnboarding({ tenantId: A, customerId: 'cust-gulf', onboardingStatus: 'APPROVED', complianceStatus: 'VERIFIED', creditLimit: 1000 });
    expect(s).toMatchObject({ onboardingStatus: 'APPROVED', complianceStatus: 'VERIFIED', creditLimit: 1000, tradeLicense: 'TL-100' });
  });

  it('rejects unknown states, a bad credit limit, a missing name and another tenant\'s shipper', async () => {
    await expect(updateShipperOnboarding({ tenantId: A, customerId: 'cust-gulf', onboardingStatus: 'DONE' })).rejects.toBeInstanceOf(LogisticsValidationError);
    await expect(onboardShipperCustomer({ tenantId: A, name: 'X', creditLimit: -5 })).rejects.toBeInstanceOf(LogisticsValidationError);
    await expect(onboardShipperCustomer({ tenantId: A, name: '   ' })).rejects.toBeInstanceOf(LogisticsValidationError);
    await expect(updateShipperOnboarding({ tenantId: B, customerId: 'cust-gulf', onboardingStatus: 'APPROVED' })).rejects.toThrow('Shipper not found');
  });
});
