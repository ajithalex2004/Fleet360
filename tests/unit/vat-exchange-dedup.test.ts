/**
 * tests/unit/vat-exchange-dedup.test.ts
 *
 * Verifies that GET /api/finance/vat and GET /api/finance/vat-return:
 * 1. Never reference non-existent `source_type` column on `finance_invoices`
 * 2. Partition Exchange commission rows out of `financeInvRev`/`financeInvTax`/`invoiceRows`
 *    so Exchange commissions are counted ONCE in totals, breakdown, vat201Boxes, and FAF supplies
 * 3. Preserve `excludeMirrored(['RENTAL', 'LOGISTICS', 'LEASING'])` for other callers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));
import { NextRequest } from 'next/server';

type InvFixture = {
  invoice_number: string;
  client_name: string;
  client_address: string;
  subtotal: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  issue_date: string;
  branch: string;
  module_source: string | null;
  module: string | null;
  service_type: string | null;
  reference_type: string | null;
  source_entity_type: string | null;
};

type ExpenseFixture = {
  expense_no: string;
  category: string;
  sub_category: string | null;
  reference_no: string | null;
  amount: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  expense_date: string;
  description: string;
};

type CustomerFixture = {
  id: string;
  name_en: string;
  name_ar: string | null;
  tax_registration_number: string | null;
  country: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  contact_person: string | null;
};

const { state, mockTx, resetState } = vi.hoisted(() => {
  const state = {
    invoices: [] as InvFixture[],
    expenses: [] as ExpenseFixture[],
    customers: [] as CustomerFixture[],
    executedSql: [] as string[],
  };

  function isExchangeRow(r: InvFixture): boolean {
    return (
      r.module_source === 'EXCHANGE' ||
      r.module === 'EXCHANGE' ||
      r.service_type === 'EXCHANGE_COMMISSION' ||
      r.reference_type === 'EXCHANGE_COMMISSION' ||
      r.source_entity_type === 'EXCHANGE_COMMISSION' ||
      r.invoice_number.startsWith('COMM-')
    );
  }

  function resetState() {
    state.executedSql = [];
    state.expenses = [
      {
        expense_no: 'EXP-2026-001',
        category: 'MAINTENANCE',
        sub_category: 'PARTS',
        reference_no: 'SUP-REF-01',
        amount: 400,
        vat_amount: 20,
        total_amount: 420,
        currency: 'AED',
        expense_date: '2026-10-18',
        description: 'Taxable brake pads',
      },
    ];
    state.customers = [
      {
        id: 'cust-1',
        name_en: 'General Client LLC',
        name_ar: null,
        tax_registration_number: '100987654321003',
        country: 'AE',
        address_line1: 'Dubai Internet City',
        address_line2: null,
        city: 'Dubai',
        state: null,
        contact_person: 'Amina Ali',
      },
    ];
    state.invoices = [
      {
        invoice_number: 'INV-2026-001',
        client_name: 'General Client LLC',
        client_address: 'Dubai, UAE',
        subtotal: 1000,
        discount_amount: 0,
        vat_rate: 5,
        vat_amount: 50,
        total_amount: 1050,
        currency: 'AED',
        issue_date: '2026-10-15',
        branch: 'Dubai',
        module_source: null,
        module: 'GENERAL',
        service_type: 'GENERAL',
        reference_type: null,
        source_entity_type: null,
      },
      {
        invoice_number: 'COMM-2026-001',
        client_name: 'Exchange Carrier A',
        client_address: 'Dubai, UAE',
        subtotal: 300,
        discount_amount: 0,
        vat_rate: 5,
        vat_amount: 15,
        total_amount: 315,
        currency: 'AED',
        issue_date: '2026-10-20',
        branch: 'Dubai',
        module_source: 'EXCHANGE',
        module: 'EXCHANGE',
        service_type: 'EXCHANGE_COMMISSION',
        reference_type: 'EXCHANGE_COMMISSION',
        source_entity_type: 'EXCHANGE_COMMISSION',
      },
      {
        invoice_number: 'COMM-2026-002',
        client_name: 'Exchange Carrier B',
        client_address: 'Abu Dhabi, UAE',
        subtotal: 200,
        discount_amount: 0,
        vat_rate: 5,
        vat_amount: 10,
        total_amount: 210,
        currency: 'AED',
        issue_date: '2026-10-25',
        branch: 'Abu Dhabi',
        module_source: null,
        module: 'GENERAL',
        service_type: 'EXCHANGE_COMMISSION',
        reference_type: null,
        source_entity_type: null,
      },
    ];
  }

  const mockTx = {
    tenant: {
      findUnique: vi.fn(async () => ({
        code: 'DXB-TEST',
        name: 'Fleet360 Test LLC',
        localizedName: null,
        trn: '100123456789003',
        address: 'Dubai, UAE',
      })),
    },
    vatReturn: {
      findMany: vi.fn(async () => []),
    },
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      state.executedSql.push(sql);

      if (sql.includes('FROM finance_invoices') && sql.includes('source_type')) {
        throw new Error('PG 42703: column "source_type" does not exist on finance_invoices');
      }
      if (sql.includes('FROM finance_expenses') && /\b(expense_number|vendor_name)\b/.test(sql)) {
        throw new Error('PG 42703: column "expense_number" or "vendor_name" does not exist on finance_expenses');
      }
      if (sql.includes('FROM customers') && /\b(name|address)\b/.test(sql)) {
        throw new Error('PG 42703: column "name" or "address" does not exist on customers');
      }

      if (sql.includes('FROM finance_expenses')) {
        return state.expenses;
      }
      if (sql.includes('FROM customers')) {
        return state.customers;
      }

      if (sql.includes('FROM finance_invoices')) {
        const isExchangeOnly =
          sql.includes("module_source, '') = 'EXCHANGE'") && !sql.includes('AND NOT (');
        const excludesExchange = sql.includes('AND NOT (');
        const rows = state.invoices.filter((r) => {
          const ex = isExchangeRow(r);
          if (isExchangeOnly) return ex;
          if (excludesExchange) return !ex;
          return true;
        });

        if (sql.includes('SUM(total_amount - vat_amount)')) {
          return [{ total: rows.reduce((s, r) => s + (r.total_amount - r.vat_amount), 0) }];
        }
        if (sql.includes('SUM(vat_amount)')) {
          return [{ total: rows.reduce((s, r) => s + r.vat_amount, 0) }];
        }
        return rows.map((r) => ({ ...r, source_payload: {} }));
      }

      if (sql.includes('COALESCE(SUM(')) {
        return [{ total: 0 }];
      }
      return [];
    }),
  };

  return { state, mockTx, resetState };
});

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
}));

import { excludeMirrored, exchangeCommissionSqlPredicate } from '@/lib/finance/mirrored-revenue';
import { GET as getVat } from '@/app/api/finance/vat/route';
import { GET as getVatReturn } from '@/app/api/finance/vat-return/route';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const headers = {
  'x-tenant-id': TENANT_ID,
  'x-user-id': 'u-fin-1',
  'x-user-role': 'TENANT_ADMIN',
};

describe('VAT Exchange Commission Deduplication & SQL Schema Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('preserves excludeMirrored(["RENTAL", "LOGISTICS", "LEASING"]) and avoids source_type in exchangeCommissionSqlPredicate', () => {
    expect(excludeMirrored(['RENTAL', 'LOGISTICS', 'LEASING'])).toBe(
      " AND COALESCE(module_source, '') NOT IN ('RENTAL', 'LOGISTICS', 'LEASING')",
    );
    const pred = exchangeCommissionSqlPredicate('fi');
    expect(pred).not.toContain('source_type');
    expect(pred).toContain('fi.module_source');
    expect(pred).toContain('fi.invoice_number LIKE');
  });

  it('GET /api/finance/vat counts Exchange commissions once without source_type SQL errors', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/vat?year=2026&quarter=4', { headers });
    const res = await getVat(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.breakdown.invoices).toEqual({ revenue: 1000, vat: 50 });
    expect(json.summary.breakdown.exchangeCommissions).toEqual({ revenue: 500, vat: 25 });
    expect(json.summary.totalRevenue).toBe(1500);
    expect(json.summary.totalVatCollected).toBe(75);
    expect(json.summary.inputVat).toBe(20);
    expect(json.summary.netVatPayable).toBe(55);
    expect(json.summary.vat201Boxes.box8TotalSuppliesAndOutputVat).toEqual({
      amountAed: 1500,
      vatAmountAed: 75,
    });
    expect(json.summary.vat201Boxes.box9StandardRatedExpenses).toEqual({
      amountAed: 400,
      recoverableVatAed: 20,
    });

    for (const sql of state.executedSql) {
      if (sql.includes('FROM finance_invoices')) {
        expect(sql).not.toMatch(/\bsource_type\b/);
      }
      if (sql.includes('FROM finance_expenses')) {
        expect(sql).not.toMatch(/\b(expense_number|vendor_name)\b/);
        expect(sql).toMatch(/\bexpense_no\b/);
      }
      if (sql.includes('FROM customers')) {
        expect(sql).not.toMatch(/\b(name|address)\b/);
        expect(sql).toMatch(/\bname_en\b/);
        expect(sql).toMatch(/\baddress_line1\b/);
      }
    }
  });

  it('GET /api/finance/vat?format=faf-json emits each supply once (INV-2026-001 + consolidated EXCH-COMM)', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/vat?year=2026&quarter=4&format=faf-json', { headers });
    const res = await getVat(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    const invoiceNos = (json.faf.customerSupplies as Array<{ invoiceNo: string }>).map((s) => s.invoiceNo);
    expect(invoiceNos).toContain('INV-2026-001');
    expect(invoiceNos).toContain('EXCH-COMM-Q4-2026');
    expect(invoiceNos).not.toContain('COMM-2026-001');
    expect(invoiceNos).not.toContain('COMM-2026-002');
    expect(json.faf.supplierPurchases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invoiceNo: 'EXP-2026-001', supplierName: 'SUP-REF-01', purchaseValueAed: 400, vatValueAed: 20 }),
      ]),
    );
    expect(json.faf.customers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: 'cust-1', customerName: 'General Client LLC', address: 'Dubai Internet City, Dubai' }),
      ]),
    );
    expect(json.faf.vat201Boxes.box8TotalSuppliesAndOutputVat).toEqual({
      amountAed: 1500,
      vatAmountAed: 75,
    });
    expect(json.faf.vat201Boxes.box9StandardRatedExpenses).toEqual({
      amountAed: 400,
      recoverableVatAed: 20,
    });
  });

  it('GET /api/finance/vat-return counts Exchange commissions once without source_type SQL errors', async () => {
    const req = new NextRequest('http://localhost:3000/api/finance/vat-return?year=2026&quarter=4', { headers });
    const res = await getVatReturn(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.breakdown.invoices).toEqual({ revenue: 1000, vat: 50 });
    expect(json.breakdown.exchangeCommissions).toEqual({ revenue: 500, vat: 25 });
    expect(json.box1_standard_rated_supplies).toBe(1500);
    expect(json.box1_vat).toBe(75);
    expect(json.box8_standard_rated_expenses).toBe(400);
    expect(json.box8_vat).toBe(20);
    expect(json.box14_net_vat).toBe(55);
    expect(json.vat201Boxes.box8TotalSuppliesAndOutputVat).toEqual({
      amountAed: 1500,
      vatAmountAed: 75,
    });
    expect(json.vat201Boxes.box9StandardRatedExpenses).toEqual({
      amountAed: 400,
      recoverableVatAed: 20,
    });

    for (const sql of state.executedSql) {
      if (sql.includes('FROM finance_invoices')) {
        expect(sql).not.toMatch(/\bsource_type\b/);
      }
      if (sql.includes('FROM finance_expenses')) {
        expect(sql).not.toMatch(/\b(expense_number|vendor_name)\b/);
        expect(sql).toMatch(/\bexpense_no\b/);
      }
    }
  });
});
