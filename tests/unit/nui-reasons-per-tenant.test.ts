import { describe, it, expect, afterAll } from 'vitest';
import type { TxClient } from '@/lib/rls';
import {
  createNuiReason,
  deleteNuiReason,
  getNuiReason,
  listNuiReasons,
  seedDefaultsIfEmpty,
  toNuiReason,
  updateNuiReason,
} from '@/lib/fleet/nui-reasons-store';
import { DEFAULT_NUI_REASONS } from '@/lib/fleet/nui-reasons';
import { hasTestDatabase } from '../db-guard';

type Call = { sql: string; params: unknown[] };

/** A transaction that records every statement and answers from a queue. */
function fakeTx(answers: unknown[] = []) {
  const calls: Call[] = [];
  const next = () => (answers.length ? answers.shift() : []);
  const tx = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return next();
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      const a = next();
      return typeof a === 'number' ? a : 1;
    },
  } as unknown as TxClient;
  return { tx, calls };
}

const T = 'tenant-a';

describe('NUI reasons are per tenant (store)', () => {
  it('never returns tenant_id to callers', () => {
    expect(toNuiReason({ id: '1', tenant_id: T, reason_type: 'ALL' })).toEqual({ id: '1', reasonType: 'ALL' });
  });

  it('lists only the tenant\'s reasons', async () => {
    const { tx, calls } = fakeTx([[{ id: '1', tenant_id: T, code: 'X' }]]);
    const rows = await listNuiReasons(tx, T, { activeOnly: true, type: 'TRANSFER', search: 'reb' });
    expect(calls[0].sql).toMatch(/WHERE tenant_id = \$1 AND is_active = TRUE/);
    expect(calls[0].params).toEqual([T, 'TRANSFER', '%reb%']);
    expect(rows).toEqual([{ id: '1', code: 'X' }]);
  });

  it('reads, updates and deletes by id only within the tenant', async () => {
    const read = fakeTx([[]]);
    expect(await getNuiReason(read.tx, T, 'id-of-b')).toBeNull();
    expect(read.calls[0].sql).toMatch(/id::text = \$1 AND tenant_id = \$2/);
    expect(read.calls[0].params).toEqual(['id-of-b', T]);

    const upd = fakeTx([[]]);
    expect(await updateNuiReason(upd.tx, T, 'id-of-b', { name: 'n' }, { allowCodeChange: false })).toEqual({ ok: false, notFound: true });
    expect(upd.calls[0].sql).toMatch(/WHERE id::text = \$2 AND tenant_id = \$3/);
    expect(upd.calls[0].params).toEqual(['n', 'id-of-b', T]);

    const del = fakeTx([0]);
    expect(await deleteNuiReason(del.tx, T, 'id-of-b')).toBe(false);
    expect(del.calls[0].params).toEqual(['id-of-b', T]);
  });

  it('creates for the tenant, and a code the tenant already has is a conflict', async () => {
    const ok = fakeTx([[], [{ id: 'new', tenant_id: T, code: 'TR-NEW' }]]);
    const created = await createNuiReason(ok.tx, T, { code: ' tr-new ', name: 'New', reasonType: 'transfer' });
    expect(created).toEqual({ ok: true, reason: { id: 'new', code: 'TR-NEW' } });
    expect(ok.calls[0].params).toEqual([T, 'TR-NEW']);
    expect(ok.calls[1].params.slice(1, 5)).toEqual([T, 'TR-NEW', 'New', 'TRANSFER']);

    const dup = fakeTx([[{ id: 'existing' }]]);
    expect(await createNuiReason(dup.tx, T, { code: 'TR-NEW', name: 'New', reasonType: 'TRANSFER' })).toEqual({ ok: false, conflict: 'TR-NEW' });
    expect(dup.calls).toHaveLength(1);
  });

  it('the master screen cannot change a code; the fleet API checks the new code per tenant', async () => {
    const admin = fakeTx([[{ id: '1', tenant_id: T, code: 'OLD' }]]);
    await updateNuiReason(admin.tx, T, '1', { code: 'NEW', name: 'n' }, { allowCodeChange: false });
    expect(admin.calls[0].sql).not.toMatch(/\bcode = /);

    const fleet = fakeTx([[{ id: 'other' }]]);
    expect(await updateNuiReason(fleet.tx, T, '1', { code: 'taken' }, { allowCodeChange: true })).toEqual({ ok: false, conflict: 'TAKEN' });
    expect(fleet.calls[0].params).toEqual([T, 'TAKEN', '1']);
  });

  it('seeds the defaults for a tenant with no reasons of its own', async () => {
    const empty = fakeTx([[{ count: 0 }]]);
    await seedDefaultsIfEmpty(empty.tx, T);
    expect(empty.calls[0].params).toEqual([T]);
    expect(empty.calls).toHaveLength(1 + DEFAULT_NUI_REASONS.length);
    expect(empty.calls.slice(1).every((c) => c.params[0] === T && /ON CONFLICT DO NOTHING/.test(c.sql))).toBe(true);

    const seeded = fakeTx([[{ count: 3 }]]);
    await seedDefaultsIfEmpty(seeded.tx, T);
    expect(seeded.calls).toHaveLength(1);
  });
});

// Against a real, migrated database (CI's unit-test database). Skipped
// without TEST_DATABASE_URL; never runs against .env's database.
const NO_TEST_DB = !hasTestDatabase();

describe('NUI reasons are per tenant (database)', () => {
  const A = `nui-test-a-${Date.now()}`;
  const B = `nui-test-b-${Date.now()}`;

  afterAll(async () => {
    if (NO_TEST_DB) return;
    const { prisma } = await import('@/lib/prisma');
    const { withPlatformAdmin } = await import('@/lib/rls');
    await withPlatformAdmin(prisma, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM fleet_nui_reasons WHERE tenant_id IN ($1, $2)`, A, B),
    );
  });

  it.skipIf(NO_TEST_DB)('each tenant sees and changes only its own codes; the same code may exist in both', async () => {
    const { prisma } = await import('@/lib/prisma');
    const { withTenantRls } = await import('@/lib/rls');
    const input = { code: 'TR-ISO', name: 'Isolation check', reasonType: 'TRANSFER' };

    const a = await withTenantRls(prisma, A, (tx) => createNuiReason(tx, A, input));
    const b = await withTenantRls(prisma, B, (tx) => createNuiReason(tx, B, input));
    expect(a.ok && b.ok).toBe(true);
    const aId = a.ok ? String(a.reason.id) : '';

    const seenByB = await withTenantRls(prisma, B, (tx) => listNuiReasons(tx, B, { activeOnly: false }));
    expect(seenByB.map((r) => r.id)).not.toContain(aId);
    expect(seenByB.every((r) => !('tenantId' in r))).toBe(true);

    expect(await withTenantRls(prisma, B, (tx) => getNuiReason(tx, B, aId))).toBeNull();
    expect(await withTenantRls(prisma, B, (tx) => updateNuiReason(tx, B, aId, { name: 'hijack' }, { allowCodeChange: false })))
      .toEqual({ ok: false, notFound: true });
    expect(await withTenantRls(prisma, B, (tx) => deleteNuiReason(tx, B, aId))).toBe(false);

    const stillA = await withTenantRls(prisma, A, (tx) => getNuiReason(tx, A, aId));
    expect(stillA?.name).toBe('Isolation check');
    expect(await withTenantRls(prisma, A, (tx) => createNuiReason(tx, A, input))).toEqual({ ok: false, conflict: 'TR-ISO' });
  }, 60_000);
});
