/**
 * logAudit — fire-and-forget transaction race (#72). PostgreSQL Integration
 * Tests.
 *
 * Reproduces the exact original bug: a caller inside a withTenantRls
 * transaction fires `void logAudit(...)` and returns immediately, closing
 * the transaction before the unawaited write could reach it. Before the
 * fix, the write inherited the caller's `scope.tx` (a transaction client
 * that commits the moment the callback returns) via AsyncLocalStorage
 * propagation — "Transaction already closed" (P2028), racy because it
 * depended on how much work the caller did after the call before
 * returning. This suite calls `logAudit` from inside a callback that
 * returns on literally the next tick, the tightest version of that race,
 * against a real database with active RLS.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import { logAudit, logAuditInTx } from '@/lib/audit';

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const tenantA = crypto.randomUUID();
const tenantB = crypto.randomUUID();
const entityIds: string[] = [];

async function findRow(entityId: string) {
  const rows = await withPlatformAdmin(prisma, (tx) =>
    tx.$queryRawUnsafe<Array<{ tenant_id: string | null; entity_id: string; action: string }>>(
      `SELECT tenant_id, entity_id, action FROM audit_logs WHERE entity_id = $1`,
      entityId,
    ),
  );
  return rows[0] ?? null;
}

d('logAudit — fire-and-forget transaction race (#72)', () => {
  afterAll(async () => {
    if (!hasDb || entityIds.length === 0) return;
    await withPlatformAdmin(prisma, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE entity_id = ANY($1)`, entityIds),
    );
  });

  it('survives the tightest race: fire-and-forget inside a transaction that commits on the next tick', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    // The exact shape of the original bug site (leasing/returns route):
    // an awaited withTenantRls call whose callback fires-and-forgets
    // logAudit, then returns immediately — nothing else keeps the
    // transaction open. Capture the promise in an outer-scope variable
    // (mirroring `void logAudit(...)`, not `return`-ing it) — returning it
    // from the callback would make Prisma wait for it before committing,
    // which would serialize the two and defeat the point of this test.
    let capturedPromise: Promise<void> | undefined;
    await withTenantRls(prisma, tenantA, async (tx) => {
      capturedPromise = logAudit({
        tenantId: tenantA,
        entityType: 'TestRace',
        entityId,
        action: 'CREATE',
        details: 'tightest-race regression test',
      });
      await tx.$queryRawUnsafe('SELECT 1'); // the callback's only other work, then returns
    });

    // By now the outer transaction has committed, independently of
    // capturedPromise. The old code would have already logged "Transaction
    // already closed" to console.error by this point (or shortly after)
    // and the row would never land. Await it now only so the test can
    // assert deterministically instead of sleeping.
    await capturedPromise;

    const row = await findRow(entityId);
    expect(row).not.toBeNull();
    expect(row?.tenant_id).toBe(tenantA);
    expect(row?.action).toBe('CREATE');
  });

  it('is independent of the caller transaction: writes even after the caller rolls back', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);
    let capturedPromise: Promise<void> | null = null;

    await expect(
      withTenantRls(prisma, tenantA, async (tx) => {
        capturedPromise = logAudit({
          tenantId: tenantA,
          entityType: 'TestRace',
          entityId,
          action: 'CREATE',
          details: 'independent-of-rollback regression test',
        });
        await tx.$queryRawUnsafe('SELECT 1');
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    await capturedPromise!;

    // logAudit's own transaction is independent — it commits regardless of
    // whether the caller's transaction that spawned it rolled back.
    const row = await findRow(entityId);
    expect(row).not.toBeNull();
  });

  it('a no-tenantId call writes a real row with tenant_id NULL (#83)', async () => {
    // AuditPayload.tenantId is typed optional, and this function correctly
    // routes a missing one to withPlatformAdmin. audit_logs.tenant_id was
    // NOT NULL on the live database until #83's fix — every no-tenantId
    // call (e.g. withAudit() outside a request with an x-tenant-id header)
    // used to fail here, silently. Now it persists.
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    await expect(
      logAudit({
        entityType: 'TestRace',
        entityId,
        action: 'LOGIN',
        details: 'platform-level, no tenantId',
      }),
    ).resolves.toBeUndefined();

    const row = await findRow(entityId);
    expect(row).not.toBeNull();
    expect(row!.tenant_id).toBeNull();
  });

  it('a platform-level (NULL-tenant) audit row is not visible to an ordinary tenant session', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    await logAudit({
      entityType: 'TestRace',
      entityId,
      action: 'LOGIN',
      details: 'platform-level, no tenantId',
    });

    const seenByTenant = await withTenantRls(prisma, tenantA, (tx) =>
      tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM audit_logs WHERE entity_id = $1`, entityId),
    );
    expect(seenByTenant).toHaveLength(0);
  });

  it('cross-tenant isolation: tenant A cannot read tenant B\'s audit row', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    await logAudit({
      tenantId: tenantB,
      entityType: 'TestRace',
      entityId,
      action: 'CREATE',
      details: 'tenant B row',
    });

    const seenByA = await withTenantRls(prisma, tenantA, (tx) =>
      tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM audit_logs WHERE entity_id = $1`, entityId),
    );
    expect(seenByA).toHaveLength(0);

    const seenByB = await withTenantRls(prisma, tenantB, (tx) =>
      tx.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM audit_logs WHERE entity_id = $1`, entityId),
    );
    expect(seenByB).toHaveLength(1);
  });

  it('logAuditInTx shares the caller\'s transaction — rolls back with it', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    await expect(
      withTenantRls(prisma, tenantA, async (tx) => {
        await logAuditInTx(
          { tenantId: tenantA, entityType: 'TestRace', entityId, action: 'CREATE', details: 'in-tx rollback test' },
          tx,
        );
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    // Unlike logAudit, logAuditInTx deliberately shares the caller's
    // transaction — so it must NOT be present after the caller rolls back.
    const row = await findRow(entityId);
    expect(row).toBeNull();
  });

  it('logAuditInTx commits atomically with the caller on success', async () => {
    const entityId = crypto.randomUUID();
    entityIds.push(entityId);

    await withTenantRls(prisma, tenantA, async (tx) => {
      await logAuditInTx(
        { tenantId: tenantA, entityType: 'TestRace', entityId, action: 'CREATE', details: 'in-tx commit test' },
        tx,
      );
    });

    const row = await findRow(entityId);
    expect(row).not.toBeNull();
  });
});
