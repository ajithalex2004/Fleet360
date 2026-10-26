/**
 * Mirrored module revenue is counted once.
 *
 * module-ledger.ts copies rental, logistics and lease invoices into
 * finance_invoices (module_source = RENTAL / LOGISTICS / LEASING). Reports
 * that summed both a module's own table and finance_invoices counted that
 * revenue twice — corporate tax among them, overstating the tax.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { excludeMirrored } from '@/lib/finance/mirrored-revenue';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({ sql: [] as string[] }));
const raw = vi.hoisted(() => async (sql: string) => { st.sql.push(sql); return [{ t: '0', total: '0', count: 0 }]; });

vi.mock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: raw } }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({ $queryRawUnsafe: raw }),
}));

import { NextRequest } from 'next/server';
import { GET as corporateTax } from '@/app/api/finance/corporate-tax/route';

beforeEach(() => { st.sql.length = 0; });

describe('excludeMirrored', () => {
  it('excludes the given modules, keeping invoices with no module_source', () => {
    expect(excludeMirrored(['RENTAL', 'LOGISTICS'])).toBe(" AND COALESCE(module_source, '') NOT IN ('RENTAL', 'LOGISTICS')");
  });
  it('qualifies the column with an alias', () => {
    expect(excludeMirrored(['LEASING'], 'fi')).toBe(" AND COALESCE(fi.module_source, '') NOT IN ('LEASING')");
  });
  it('adds nothing when no module is summed from its own table', () => {
    expect(excludeMirrored([])).toBe('');
  });
});

describe('corporate tax revenue', () => {
  it('leaves rental and logistics mirrors out of the finance_invoices sum it adds to their own tables', async () => {
    await corporateTax(new NextRequest('http://localhost/api/finance/corporate-tax?type=estimate&year=2026', {
      headers: { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' },
    }));
    const fromFinance = st.sql.find((q) => q.includes('SUM(subtotal)') && q.includes('FROM finance_invoices'));
    expect(fromFinance).toBeDefined();
    expect(fromFinance).toContain("NOT IN ('RENTAL', 'LOGISTICS')");
    expect(st.sql.some((q) => q.includes('FROM rental_invoices'))).toBe(true);
    expect(st.sql.some((q) => q.includes('FROM logistics_shipment_orders'))).toBe(true);
  });
});
