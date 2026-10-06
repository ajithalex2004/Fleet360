/**
 * tests/unit/tenant-hard-delete.test.ts
 *
 * POST /api/admin/tenants/[id]/hard-delete?dryRun=false ran every table's
 * DELETE in one transaction without savepoints. The app role has no DELETE
 * on lease_dunning_stage_transitions, so that statement failed, Postgres
 * aborted the transaction (25P02 for every later statement) and the delete
 * always answered 500 — even for a tenant with no rows in that table.
 *
 * The fake transaction below behaves like Postgres: after a failed
 * statement everything fails until ROLLBACK TO SAVEPOINT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-zz';

const db = vi.hoisted(() => ({
  rows: {} as Record<string, number>,
  deleteDenied: new Set<string>(),
  /** table → table whose rows must be gone first (FK). */
  referencedBy: {} as Record<string, string>,
  tenantRows: 1,
  aborted: false,
  log: [] as string[],
}));

const tx = vi.hoisted(() => {
  const exec = async (sql: string, ...args: unknown[]) => {
    db.log.push(sql);
    if (sql.startsWith('SAVEPOINT')) { if (db.aborted) throw new Error('25P02 aborted'); return 0; }
    if (sql.startsWith('ROLLBACK TO SAVEPOINT')) { db.aborted = false; return 0; }
    if (db.aborted) throw new Error('Raw query failed. Code: `25P02`. ERROR: current transaction is aborted');
    if (sql.startsWith('RELEASE SAVEPOINT') || sql.includes('set_config')) return 0;
    const del = /^DELETE FROM "?(\w+)"?/.exec(sql);
    if (del) {
      const table = del[1];
      if (table === 'tenants') {
        if (Object.values(db.rows).some((n) => n > 0)) { db.aborted = true; throw new Error('ERROR: FK violation on tenants'); }
        const n = db.tenantRows; db.tenantRows = 0; return n;
      }
      if (db.deleteDenied.has(table)) { db.aborted = true; throw new Error(`ERROR: permission denied for table ${table}`); }
      const dep = db.referencedBy[table];
      if (dep && (db.rows[dep] ?? 0) > 0) { db.aborted = true; throw new Error(`ERROR: FK violation, ${dep} references ${table}`); }
      const n = db.rows[table] ?? 0; db.rows[table] = 0; return n;
    }
    void args;
    return 0;
  };
  const query = async (sql: string, ...args: unknown[]) => {
    if (db.aborted) throw new Error('Raw query failed. Code: `25P02`');
    const ex = /FROM "(\w+)" WHERE/.exec(sql);
    if (sql.includes('EXISTS') && ex) return [{ found: (db.rows[ex[1]] ?? 0) > 0 }];
    if (sql.includes('FROM tenants WHERE id')) return [{ id: args[0], name: 'ZZ Test', is_active: false }];
    if (sql.includes('COUNT(*)::bigint AS n FROM tenants')) return [{ n: 5n }];
    return [];
  };
  return { $executeRawUnsafe: exec, $queryRawUnsafe: query };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) =>
      sql.includes('information_schema')
        ? Object.keys(db.rows).map((table_name) => ({ table_name }))
        : [],
    $transaction: async (fn: (t: unknown) => unknown) => {
      db.aborted = false;
      const snapshot = { rows: { ...db.rows }, tenantRows: db.tenantRows };
      try { return await fn(tx); }
      catch (e) { db.rows = snapshot.rows; db.tenantRows = snapshot.tenantRows; throw e; }
    },
  },
}));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
  withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/platform-audit-log', () => ({ logAudit: async () => {} }));
vi.mock('@/lib/server-cache', () => ({ revalidateCache: () => {} }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));
vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: () => ({ ok: true, tenantId: 'platform', userId: 'u1' }),
  stripTenantOwnershipFields: (b: unknown) => b,
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/tenants/[id]/hard-delete/route';

const call = () => POST(
  new NextRequest(`http://x/api/admin/tenants/${TENANT}/hard-delete?dryRun=false`, {
    method: 'POST',
    headers: { 'x-user-role': 'SUPER_ADMIN', 'x-user-id': 'u1', 'x-user-email': 'a@x' },
  }),
  { params: Promise.resolve({ id: TENANT }) },
);

beforeEach(() => {
  db.rows = {};
  db.deleteDenied = new Set();
  db.referencedBy = {};
  db.tenantRows = 1;
  db.aborted = false;
  db.log = [];
});

describe('tenant hard delete', () => {
  it('ignores a table the app role cannot delete from when the tenant has no rows there', async () => {
    db.rows = { audit_logs: 2, lease_dunning_stage_transitions: 0, tenant_modules: 21, tenant_feature_overrides: 55 };
    db.deleteDenied.add('lease_dunning_stage_transitions');

    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.totalRows).toBe(2 + 21 + 55 + 1);
    expect(db.log.some((s) => s.includes('DELETE FROM "lease_dunning_stage_transitions"'))).toBe(false);
  });

  it('retries FK-blocked tables in later passes without aborting the transaction', async () => {
    db.rows = { a_parent: 3, b_child: 4 };
    db.referencedBy = { a_parent: 'b_child' };

    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).tables).toEqual(expect.arrayContaining([
      { name: 'a_parent', rowCount: 3 }, { name: 'b_child', rowCount: 4 }, { name: 'tenants', rowCount: 1 },
    ]));
  });

  it('fails clearly, and deletes nothing, when a table holding the tenant rows cannot be cleared', async () => {
    db.rows = { audit_logs: 2, lease_dunning_stage_transitions: 7 };
    db.deleteDenied.add('lease_dunning_stage_transitions');

    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.message).toContain('lease_dunning_stage_transitions');
    expect(body.message).toContain('permission denied');
    expect(db.rows.audit_logs).toBe(2); // rolled back
    expect(db.tenantRows).toBe(1);
  });
});
