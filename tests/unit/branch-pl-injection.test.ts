/**
 * GET /api/finance/branch-pl binds branchId; it never builds SQL from it.
 *
 * branchId went from the query string into the SQL text unvalidated —
 * `AND i.branch_id = '${branchId}'::uuid` — so any caller with finance
 * access could run arbitrary SQL in their tenant transaction. The same
 * fragment referenced alias `i` in the expenses query, which has none, so
 * with a branch selected that query failed, the failure was swallowed, and
 * branch expenses always read 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; args: unknown[] }> }));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({
    $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
      st.queries.push({ sql, args });
      if (sql.includes('FROM tenants')) return [{ name: 'Acme' }];
      if (sql.includes('branch_id IS NULL')) return [{ total_invoiced: 0, total_paid: 0, vat_collected: 0, invoice_count: 0n }];
      return [];
    },
  }),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/finance/branch-pl/route';

const BRANCH = '11111111-2222-4333-8444-555555555555';
const headers = { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' };
const get = (qs: string) => GET(new NextRequest(`http://localhost/api/finance/branch-pl?${qs}`, { headers }));

beforeEach(() => { st.queries.length = 0; });

describe('GET /api/finance/branch-pl', () => {
  it('refuses a branchId that is not a UUID, before any query', async () => {
    const res = await get(`branchId=${encodeURIComponent("x'::uuid OR 1=1 --")}`);
    expect(res.status).toBe(400);
    expect(st.queries).toHaveLength(0);
  });

  it('binds a valid branchId as a parameter and filters the branch row in both queries', async () => {
    const res = await get(`branchId=${BRANCH}`);
    expect(res.status).toBe(200);
    const byBranch = st.queries.filter((q) => q.sql.includes('FROM tenant_branches b'));
    expect(byBranch).toHaveLength(2); // revenue and expenses
    for (const q of byBranch) {
      expect(q.sql).not.toContain(BRANCH);
      expect(q.sql).toContain('b.id = $4::uuid');
      expect(q.args).toContain(BRANCH);
    }
  });

  it('passes no branch (all branches) as a null parameter', async () => {
    await get('');
    const byBranch = st.queries.filter((q) => q.sql.includes('FROM tenant_branches b'));
    for (const q of byBranch) expect(q.args[3]).toBeNull();
  });
});
