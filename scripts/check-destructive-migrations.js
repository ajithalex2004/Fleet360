#!/usr/bin/env node
/**
 * Blocks destructive SQL from entering prisma/migrations/.
 *
 * WHY THIS EXISTS
 * prisma/schema.prisma is NOT an accurate model of the live database. Running
 * `prisma migrate diff` against production emits ~2541 lines containing 657
 * DROP statements, including 174 DROP TABLE — it would drop
 * finance.finance_chart_of_accounts, the Workflow* tables, the admin_* tables
 * and many more, because the schema simply doesn't declare them.
 *
 * The realistic disaster path is not malice, it's routine Prisma workflow:
 *   1. a dev runs `prisma migrate dev` to add one field
 *   2. Prisma silently generates a migration containing all 174 DROP TABLEs
 *   3. it gets committed, reviewed as "add one field", and deployed
 *   4. production is gone
 *
 * This check makes step 3 impossible without a human explicitly allowlisting
 * the migration below, which forces the drop to be a conscious, reviewed
 * decision instead of a side effect.
 *
 * NOTE: this cannot catch `prisma db push`, which mutates the database without
 * producing a migration file at all. See scripts/guard-prisma-url.js for that.
 *
 * Usage:
 *   node scripts/check-destructive-migrations.js
 * Exit codes: 0 = clean, 1 = destructive SQL found outside the allowlist.
 */

const fs = require('fs');
const path = require('path');

// ── Migrations that are ALLOWED to contain destructive SQL ───────────────────
// Keyed by migration directory name. Adding an entry here is the deliberate,
// reviewable act of saying "yes, this really is meant to delete data".
//
// These live here rather than as a marker comment inside the .sql files
// because Prisma checksums every applied migration — editing an already-applied
// migration file makes `prisma migrate` fail with a checksum mismatch.
const ALLOWLIST = {
  '20260413143418_add_transport_modules':
    'Original transport-modules migration; drops the pre-rename Alert/AlertConfig/Attachment/Comment tables.',
  '20260626000001_drop_lease_v1_tables':
    'Intentional removal of superseded lease v1 tables — the whole point of the migration.',
  '20260910000005_resolve_finance_payments_shadow':
    'Drops public.finance_payments, an empty shadow of finance.finance_payments. Two ' +
    'tables shared the name and public precedes finance on search_path, so every ' +
    'unqualified reference resolved to the copy with no tenant_id and no RLS while the ' +
    'tenant-isolated one sat unreachable behind it. The dropped table held 0 rows and had ' +
    'no inbound foreign keys, views or matviews (checked via pg_depend); the surviving ' +
    'table is a strict superset of its columns. The migration re-checks both ' +
    'preconditions at run time and raises rather than dropping if either has changed. ' +
    'Adding a tenant column to the shadow instead would have left two protected tables ' +
    'and no way to tell which one was real.',
};

// Statements that can destroy data. DROP INDEX and DROP POLICY are deliberately
// NOT included: they are recoverable and are routinely used in an idempotent
// drop-then-recreate pattern (see 20260903000000_add_breakdown_reports, which
// does DROP POLICY IF EXISTS immediately before CREATE POLICY).
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i, what: 'DROP TABLE' },
  { re: /\bDROP\s+SCHEMA\b/i, what: 'DROP SCHEMA' },
  { re: /\bDROP\s+DATABASE\b/i, what: 'DROP DATABASE' },
  { re: /\bTRUNCATE\b/i, what: 'TRUNCATE' },
  { re: /\bDROP\s+COLUMN\b/i, what: 'DROP COLUMN' },
];

/**
 * Remove SQL comments so commented-out or merely *described* DROPs don't trip
 * the check. Without this the guard fires on its own documentation — several
 * migrations in this repo discuss DROP statements in their header comments.
 * Quote-aware so a `--` inside a string literal is left alone.
 */
function stripComments(sql) {
  let out = '';
  let inLine = false;
  let inBlock = false;
  let quote = null;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      else out += ' ';
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; out += '  '; i++; }
      else out += c === '\n' ? c : ' ';
      continue;
    }
    if (quote) {
      out += c;
      if (c === quote && sql[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === '-' && next === '-') { inLine = true; out += '  '; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; out += '  '; i++; continue; }
    out += c;
  }
  return out;
}

function findMigrations(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'migration.sql');
    if (fs.existsSync(file)) found.push({ name: entry.name, file });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const root = path.join(process.cwd(), 'prisma', 'migrations');
  const migrations = findMigrations(root);

  console.log('🔍 Scanning migrations for destructive SQL...\n');
  console.log(`Checking ${migrations.length} migrations...\n`);

  const violations = [];
  let allowed = 0;

  for (const { name, file } of migrations) {
    const raw = fs.readFileSync(file, 'utf8');
    const sql = stripComments(raw);
    const lines = sql.split('\n');

    const hits = [];
    lines.forEach((line, idx) => {
      for (const { re, what } of DESTRUCTIVE) {
        if (re.test(line)) hits.push({ line: idx + 1, what, text: line.trim().slice(0, 100) });
      }
    });

    if (hits.length === 0) continue;

    if (ALLOWLIST[name]) { allowed++; continue; }
    violations.push({ name, file, hits });
  }

  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total migrations:      ${migrations.length}`);
  console.log(`Allowlisted:           ${allowed}`);
  console.log(`❌ Violations:         ${violations.length}`);
  console.log('━'.repeat(60));

  if (violations.length === 0) {
    console.log('\n✅ No unapproved destructive SQL in migrations.\n');
    return 0;
  }

  console.log('\nDESTRUCTIVE SQL FOUND:\n');
  for (const v of violations) {
    console.log(`❌ ${v.name}`);
    for (const h of v.hits.slice(0, 10)) {
      console.log(`   line ${h.line}: ${h.what}`);
      console.log(`     ${h.text}`);
    }
    if (v.hits.length > 10) console.log(`   ...and ${v.hits.length - 10} more`);
    console.log('');
  }

  console.log('━'.repeat(60));
  console.log('If Prisma generated this for you, DO NOT COMMIT IT.');
  console.log('');
  console.log('prisma/schema.prisma does not model large parts of the live');
  console.log('database, so `prisma migrate dev` will happily produce a');
  console.log('migration that drops 174 real tables. Hand-write an additive');
  console.log('migration instead — see');
  console.log('prisma/migrations/20260903000000_add_breakdown_reports for the');
  console.log('pattern (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).');
  console.log('');
  console.log('If the deletion really is intended, add the migration to');
  console.log('ALLOWLIST in scripts/check-destructive-migrations.js with a');
  console.log('reason, so it gets reviewed as a deliberate data deletion.');
  console.log('━'.repeat(60));
  return 1;
}

process.exit(main());
