/**
 * Real PostgreSQL 17 Integration Test — UAE VAT 201 & FTA FAF (M5-R6 Iteration 2).
 *
 * Exercises GET /api/finance/vat, GET /api/finance/vat?format=faf-json, and
 * GET /api/finance/vat-return directly against real PostgreSQL with active
 * Row-Level Security (FORCE RLS under `fleet360_app`), verifying:
 *   - Real `finance_expenses` (`expense_no`) and `customers` (`name_en`, `address_line1`) queries succeed
 *   - Zero `42703` (undefined column) or `25P02` (aborted transaction) errors
 *   - Exact net VAT calculations across general invoices, Exchange commissions,
 *     approved expenses, applied credit notes, and draft exclusion
 *   - `vat201Boxes.box9StandardRatedExpenses` matches `box8_standard_rated_expenses` / `box8_vat`
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { hasTestDatabase } from '../db-guard';

const hasDb = hasTestDatabase();
const tenantId = crypto.randomUUID();
const userId = crypto.randomUUID();
const customerId = crypto.randomUUID();
const vatReturnId = crypto.randomUUID();
const generalInvId = crypto.randomUUID();
const commInvId = crypto.randomUUID();
const draftInvId = crypto.randomUUID();
const expenseId = crypto.randomUUID();
const creditNoteId = crypto.randomUUID();
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

import { GET as vatGet } from '@/app/api/finance/vat/route';
import { GET as vatReturnGet } from '@/app/api/finance/vat-return/route';

describe.skipIf(!hasDb)('M5-R6 Real PG17 Integration — VAT & VAT Return (FORCE RLS)', () => {
  beforeAll(async () => {
    await withPlatformAdmin(prisma, async (tx) => {
      const roleRows = await tx.$queryRawUnsafe<
        Array<{ current_user: string; rolbypassrls: boolean; rolsuper: boolean }>
      >(
        `SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleRows[0]?.current_user).toBe('fleet360_app');
      expect(roleRows[0]?.rolbypassrls).toBe(false);
      expect(roleRows[0]?.rolsuper).toBe(false);

      await tx.tenant.create({
        data: {
          id: tenantId,
          name: `M5R6 VAT Tenant ${suffix}`,
          code: `V6-${suffix}`,
          domain: `v6-${suffix}.example.com`,
          plan: 'ENTERPRISE',
          isActive: true,
          trn: '100123456789003',
          address: 'Dubai, UAE',
        },
      });
    });

    await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO customers (id, tenant_id, customer_type, name_en, tax_registration_number, country, address_line1, city)
         VALUES ($1, $2, 'CORPORATE', 'Test VAT Customer LLC', '100987654321003', 'AE', 'Dubai Internet City', 'Dubai')`,
        customerId,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO vat_returns (id, tenant_id, period_from, period_to, status)
         VALUES ($1, $2, '2026-07-01T00:00:00Z'::timestamptz, '2026-09-30T23:59:59Z'::timestamptz, 'DRAFT')`,
        vatReturnId,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_invoices (
           id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount,
           payment_status, module, service_type, module_source, issue_date, tenant_id
         ) VALUES (
           $1::uuid, $2, 'General Client LLC', 1000, 5, 50, 1050,
           'SENT', 'GENERAL', 'GENERAL', NULL, '2026-11-18'::date, $3
         )`,
        generalInvId,
        `INV-R6-${suffix}`,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_invoices (
           id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount,
           payment_status, module, service_type, module_source, reference_type, source_entity_type,
           issue_date, tenant_id
         ) VALUES (
           $1::uuid, $2, 'Exchange Carrier LLC', 300, 5, 15, 315,
           'PAID', 'EXCHANGE', 'EXCHANGE_COMMISSION', 'EXCHANGE', 'EXCHANGE_COMMISSION', 'EXCHANGE_COMMISSION',
           '2026-11-18'::date, $3
         )`,
        commInvId,
        `COMM-R6-${suffix}`,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_invoices (
           id, invoice_number, client_name, subtotal, vat_rate, vat_amount, total_amount,
           payment_status, module, service_type, module_source, issue_date, tenant_id
         ) VALUES (
           $1::uuid, $2, 'Draft Client LLC', 500, 5, 25, 525,
           'DRAFT', 'GENERAL', 'GENERAL', NULL, '2026-11-18'::date, $3
         )`,
        draftInvId,
        `DRF-R6-${suffix}`,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_expenses (
           id, expense_no, category, description, amount, vat_amount, total_amount,
           expense_date, status, reference_no, tenant_id
         ) VALUES (
           $1::uuid, $2, 'MAINTENANCE', 'Taxable parts', 400, 20, 420,
           '2026-11-18'::date, 'APPROVED', 'SUP-INV-01', $3
         )`,
        expenseId,
        `EXP-R6-${suffix}`,
        tenantId,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO finance_credit_notes (
           id, cn_number, original_invoice_id, original_invoice_no, client_name,
           reason_code, subtotal, vat_amount, total_amount, issue_date, status, applied_amount, tenant_id
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4, 'General Client LLC',
           'BILLING_CORRECTION', 100, 5, 105, '2026-11-18'::date, 'APPLIED', 105, $5
         )`,
        creditNoteId,
        `CN-R6-${suffix}`,
        generalInvId,
        `INV-R6-${suffix}`,
        tenantId,
      );
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await withPlatformAdmin(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM finance_credit_notes WHERE tenant_id = $1`, tenantId).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM finance_expenses WHERE tenant_id = $1`, tenantId).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE tenant_id = $1`, tenantId).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM vat_returns WHERE tenant_id = $1`, tenantId).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM customers WHERE tenant_id = $1`, tenantId).catch(() => {});
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenantId).catch(() => {});
    });
  });

  it('GET /api/finance/vat returns exact net VAT breakdown, expenses input VAT, and returns without PG errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const req = new NextRequest('http://localhost:3000/api/finance/vat?year=2026&quarter=4');
      const res = await vatGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.summary.breakdown.invoices).toEqual({ revenue: 1000, vat: 50 });
      expect(json.summary.breakdown.exchangeCommissions).toEqual({ revenue: 300, vat: 15 });
      expect(json.summary.breakdown.creditNotes).toEqual({ revenue: 100, vat: 5 });
      expect(json.summary.totalRevenue).toBe(1200);
      expect(json.summary.totalVatCollected).toBe(60);
      expect(json.summary.inputVat).toBe(20);
      expect(json.summary.netVatPayable).toBe(40);
      expect(json.returns).toHaveLength(1);

      const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
      expect(errLogs).not.toMatch(/42703|25P02/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('GET /api/finance/vat?format=faf-json populates customers, supplierPurchases, and deduplicated customerSupplies', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const req = new NextRequest('http://localhost:3000/api/finance/vat?year=2026&quarter=4&format=faf-json');
      const res = await vatGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      const supplyNos = (json.faf.customerSupplies as Array<{ invoiceNo: string }>).map((s) => s.invoiceNo);
      expect(supplyNos).toContain(`INV-R6-${suffix}`);
      expect(supplyNos).toContain('EXCH-COMM-Q4-2026');
      expect(supplyNos).toContain(`CN-R6-${suffix}`);
      expect(supplyNos).not.toContain(`COMM-R6-${suffix}`);

      expect(json.faf.supplierPurchases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            invoiceNo: `EXP-R6-${suffix}`,
            purchaseValueAed: 400,
            vatValueAed: 20,
          }),
        ]),
      );
      expect(json.faf.customers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            customerName: 'Test VAT Customer LLC',
          }),
        ]),
      );
      expect(json.faf.vat201Boxes.box8TotalSuppliesAndOutputVat).toEqual({
        amountAed: 1200,
        vatAmountAed: 60,
      });
      expect(json.faf.vat201Boxes.box9StandardRatedExpenses).toEqual({
        amountAed: 400,
        recoverableVatAed: 20,
      });

      const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
      expect(errLogs).not.toMatch(/42703|25P02/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('GET /api/finance/vat-return returns exact box1, box8, box9, and box14 values without PG errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const req = new NextRequest('http://localhost:3000/api/finance/vat-return?year=2026&quarter=4');
      const res = await vatReturnGet(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.periodEnd).toBe('2026-12-31');
      expect(json.box1_standard_rated_supplies).toBe(1200);
      expect(json.box1_vat).toBe(60);
      expect(json.box8_standard_rated_expenses).toBe(400);
      expect(json.box8_vat).toBe(20);
      expect(json.box14_net_vat).toBe(40);
      expect(json.netVatPayable).toBe(40);
      expect(json.breakdown.invoices).toEqual({ revenue: 1000, vat: 50 });
      expect(json.breakdown.exchangeCommissions).toEqual({ revenue: 300, vat: 15 });
      expect(json.breakdown.creditNotes).toEqual({ revenue: 100, vat: 5 });
      expect(json.vat201Boxes.box9StandardRatedExpenses).toEqual({
        amountAed: 400,
        recoverableVatAed: 20,
      });

      const errLogs = errSpy.mock.calls.flat().map(String).join('\n');
      expect(errLogs).not.toMatch(/42703|25P02/);
    } finally {
      errSpy.mockRestore();
    }
  });
});
