#!/usr/bin/env node
// Run only against the disposable database used by migration-safety.yml.
// All fixtures and migration reapplication are rolled back, even on failure.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { splitSqlStatements } = require('../../scripts/fresh-install-migrate.cjs');

const prerequisite = '20260815135900_create_rental_rate_quotes_prerequisite';
const firstUse = '20260815140000_tenant_001_leasing_rental_isolation';
const rollback = new Error('ROLLBACK_RENTAL_JOURNAL_REGRESSION');

async function rolledBack(client, fn) {
  await assert.rejects(client.$transaction(async tx => {
    await fn(tx);
    throw rollback;
  }, { timeout: 30000 }), error => error === rollback);
}

async function main() {
  assert.equal(process.env.CONFIRM_SCHEMA_REGRESSION_TEST, '1', 'Set CONFIRM_SCHEMA_REGRESSION_TEST=1 for a disposable test database');
  const ownerUrl = process.env.DIRECT_URL;
  const runtimeUrl = process.env.BOOTSTRAP_RUNTIME_DATABASE_URL;
  assert(ownerUrl && runtimeUrl, 'Explicit owner and runtime database URLs are required');
  for (const url of [ownerUrl, runtimeUrl]) {
    assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Regression fixtures require a local disposable database');
  }
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } });
  try {
    const identity = await runtime.$queryRaw`SELECT current_user AS role, current_database() AS db`;
    const ownerIdentity = await owner.$queryRaw`SELECT current_database() AS db`;
    assert.equal(identity[0].role, 'fleet360_app');
    assert.equal(identity[0].db, ownerIdentity[0].db);
    const columns = await owner.$queryRaw`
      SELECT table_name, column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'finance' AND
        ((table_name = 'finance_journal_entries' AND column_name = 'id') OR
         (table_name = 'finance_journal_lines' AND column_name IN ('id', 'journal_entry_id')))
      ORDER BY table_name, column_name`;
    assert.equal(columns.length, 3);
    assert(columns.every(c => c.udt_name === 'uuid'), 'Journal keys and FK must remain native UUID');

    // Fresh replay must execute the prerequisite before TENANT-001 attempts its ALTER.
    const ledger = await owner.$queryRaw`
      SELECT migration_name, MIN(started_at) AS started_at, MAX(finished_at) AS finished_at
      FROM public._prisma_migrations WHERE migration_name IN (${prerequisite}, ${firstUse})
      GROUP BY migration_name`;
    const prior = ledger.find(row => row.migration_name === prerequisite);
    const alter = ledger.find(row => row.migration_name === firstUse);
    assert(prior?.finished_at && alter?.started_at);
    assert(prior.finished_at <= alter.started_at, 'Quote creation must precede first historical ALTER on fresh replay');

    // Existing-table branch must preserve rows, relation identity and security policies.
    await rolledBack(owner, async tx => {
      const quoteId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO public.rental_rate_quotes
          (id, tenant_id, vehicle_category, pickup_date, dropoff_date, total_days, base_rental_charge, total_amount)
        VALUES (${quoteId}, 'regression-tenant', 'SEDAN', now(), now() + interval '1 day', 1, 100, 105)`;
      const snapshot = () => tx.$queryRaw`
        SELECT c.oid::text, c.relrowsecurity, c.relforcerowsecurity,
          (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c WHERE c.oid = 'public.rental_rate_quotes'::regclass`;
      const before = await snapshot();
      const sql = readFileSync(join(__dirname, '../../prisma/migrations', prerequisite, 'migration.sql'), 'utf8');
      for (const statement of splitSqlStatements(sql)) await tx.$executeRawUnsafe(statement);
      assert.deepEqual(await snapshot(), before);
      const rows = await tx.$queryRaw`SELECT total_amount::text AS amount FROM public.rental_rate_quotes WHERE id = ${quoteId}`;
      assert.equal(Number(rows[0]?.amount), 105);
    });

    // Exercise generated Prisma delegates, nested UUID FKs, filters and updates as the real runtime role.
    await rolledBack(runtime, async tx => {
      const tenantId = randomUUID();
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const entry = await tx.financeJournalEntry.create({
        data: {
          tenantId, jeNumber: `UUID-REGRESSION-${randomUUID()}`,
          entryDate: new Date('2026-09-17T00:00:00Z'), periodYear: 2026, periodMonth: 9,
          narration: 'UUID mapping regression', totalDebit: 100, totalCredit: 100, isBalanced: true,
          lines: { create: [
            { lineNumber: 1, accountCode: 'TEST-DEBIT', debitAmount: 100 },
            { lineNumber: 2, accountCode: 'TEST-CREDIT', creditAmount: 100 },
          ] },
        }, include: { lines: true },
      });
      assert.match(entry.id, /^[0-9a-f-]{36}$/i);
      assert.equal(entry.lines.length, 2);
      assert(entry.lines.every(line => line.journalEntryId === entry.id));
      const fetched = await tx.financeJournalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { lines: true } });
      assert.equal(fetched.lines.length, 2);
      const line = await tx.financeJournalLine.update({
        where: { id: entry.lines[0].id }, data: { description: 'UUID filter verified' },
        include: { journalEntry: true },
      });
      assert.equal(line.journalEntry.id, entry.id);
      await tx.financeJournalEntry.update({ where: { id: entry.id }, data: { notes: 'UUID filter verified' } });
    });
    console.log('PASS: prerequisite ordering, existing quote preservation, native UUID types, and Prisma journal CRUD/relations under fleet360_app');
  } finally {
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
