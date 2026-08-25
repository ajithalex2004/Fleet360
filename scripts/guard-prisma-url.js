#!/usr/bin/env node
/**
 * Refuses to let schema-mutating Prisma commands run against a remote database.
 *
 * WHY THIS EXISTS
 * `prisma db push` and `prisma migrate dev` reconcile the database to
 * prisma/schema.prisma. In this repo that schema does NOT model large parts of
 * the live database, so reconciling means DROPPING ~174 real tables —
 * finance.finance_chart_of_accounts, the Workflow* tables, the admin_* tables,
 * and the tenant_id columns that enforce tenant isolation.
 *
 * scripts/check-destructive-migrations.js catches this when it arrives as a
 * committed migration file. It cannot catch `prisma db push`, which applies the
 * changes immediately and writes no file at all — nothing reaches CI, and the
 * damage is already done. This guard covers that gap.
 *
 * Usage — wrap the dangerous commands:
 *   node scripts/guard-prisma-url.js && npx prisma db push
 * or via the npm scripts in package.json (db:push, db:migrate-dev).
 *
 * Override for a genuinely local/disposable database:
 *   ALLOW_REMOTE_SCHEMA_PUSH=1 npm run db:push
 *
 * Exit codes: 0 = target looks local, 1 = remote (blocked).
 */

const url = process.env.DATABASE_URL || process.env.DIRECT_URL || '';

if (!url) {
  console.error('❌ No DATABASE_URL / DIRECT_URL set — refusing to guess. Aborting.');
  process.exit(1);
}

let host = '';
try {
  host = new URL(url).hostname;
} catch {
  console.error('❌ DATABASE_URL is not a parseable URL — refusing to proceed.');
  process.exit(1);
}

const LOCAL = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|postgres|db)$/i;
const isLocal = LOCAL.test(host);

if (isLocal) {
  console.log(`✅ Target database host "${host}" looks local — proceeding.`);
  process.exit(0);
}

if (process.env.ALLOW_REMOTE_SCHEMA_PUSH === '1') {
  console.warn('━'.repeat(64));
  console.warn(`⚠️  ALLOW_REMOTE_SCHEMA_PUSH=1 — proceeding against REMOTE host "${host}".`);
  console.warn('   You are bypassing the guard. Be certain you have a backup.');
  console.warn('━'.repeat(64));
  process.exit(0);
}

console.error('━'.repeat(64));
console.error('🛑 BLOCKED: schema push against a remote database');
console.error('━'.repeat(64));
console.error(`Target host: ${host}`);
console.error('');
console.error('`prisma db push` / `prisma migrate dev` reconcile the database to');
console.error('prisma/schema.prisma. That schema does NOT model large parts of');
console.error('this database, so reconciling it would DROP ~174 real tables,');
console.error('including finance.finance_chart_of_accounts, the Workflow* and');
console.error('admin_* tables, and tenant_id isolation columns.');
console.error('');
console.error('To change the schema, hand-write an additive migration instead.');
console.error('See prisma/migrations/20260903000000_add_breakdown_reports for the');
console.error('pattern (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS),');
console.error('then apply it with:');
console.error('  npx prisma db execute --file <migration.sql> --schema prisma/schema.prisma');
console.error('');
console.error('If you really do mean it (e.g. a disposable local branch DB):');
console.error('  ALLOW_REMOTE_SCHEMA_PUSH=1 <your command>');
console.error('━'.repeat(64));
process.exit(1);
