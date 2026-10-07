#!/usr/bin/env node
/**
 * scripts/check-no-runtime-ddl.mjs
 *
 * CI ratchet: blocks new runtime-DDL functions from entering the codebase
 * while the existing 36 violations are cleaned up incrementally.
 *
 * WHAT IT DETECTS
 * ───────────────
 * Functions that create or alter database schema at HTTP-request time:
 *   async function ensureTable(...)
 *   async function ensureTables(...)
 *   async function ensureXxxTable(s)(...)   e.g. ensureTripTables
 *   async function ensureTableAndSeed(...)
 *   async function bootstrap(...)     ← only inside src/app/api/
 *
 * The ensureXxxTable(s) form exists because a naming-exact version of this
 * check (matching only literal "ensureTable"/"ensureTables") missed
 * src/app/api/school-bus/trips/route.ts's `ensureTripTables` — a runtime-DDL
 * function exported and called from 4 other routes, invisible to the old
 * regex for as long as those files existed. Migrated in
 * prisma/migrations/20260910000022; the pattern below is now permissive of
 * an arbitrary infix so the same class of miss doesn't recur.
 *
 * HOW THE RATCHET WORKS
 * ─────────────────────
 * KNOWN_VIOLATIONS lists every file that already has one of these patterns.
 * • A file NOT in the list that now contains the pattern  → ✗ CI fails.
 * • A file in the list that no longer has the pattern     → ✓ passes with a
 *   "remove from allowlist" reminder so the list shrinks over time.
 * • Adding a new file to KNOWN_VIOLATIONS in a PR        → the diff makes
 *   the intent visible and reviewers must reject it.
 *
 * WHEN YOU CLEAN UP A FILE
 * ────────────────────────
 * Delete its path from KNOWN_VIOLATIONS below, then run:
 *   node scripts/check-no-runtime-ddl.mjs
 * to confirm the count drops.
 *
 * SECOND CHECK: EXECUTABLE DDL (2026-10-07, architecture audit A9)
 * ────────────────────────────────────────────────────────────────
 * The name patterns above passed with "0 violations" while nine modules
 * still created tables at request time through provisionSchemaOnce(), whose
 * functions are named ensureXxxSchema. So the guard also looks for the DDL
 * itself — CREATE/ALTER/DROP TABLE, INDEX, SCHEMA, TYPE, … — on non-comment
 * lines of src/. Every file that has it today is listed in REVIEWED_DDL_FILES
 * with the reason it may; any other file fails. Comments are skipped; a DDL
 * string that is never executed still counts (review it and list it, or
 * reword it).
 *
 * NOTE: Uses only Node.js built-in fs APIs — no grep, fully cross-platform.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exit } from 'node:process';

// ── Allowlist — every path that already has a runtime-DDL function ──────────
// Frozen on 2026-08-10.  Remove entries as each file is migrated.
//
// The 35 files that were here before were all migrated together on
// 2026-09-04: their CREATE TABLE / ALTER TABLE / CREATE INDEX statements
// moved into prisma/migrations/20260910000013 through .../20260910000021,
// and every table that carries (or now carries) a tenant_id column got a
// tenant_isolation RLS policy. See those migration files for the full
// rationale, including how the school_bus_trips / school_bus_students /
// sustainability_settings schema-race conflicts were resolved.
//
// Discovered 2026-09-04 when the regex below was broadened to close the
// ensureTripTables gap: 22 more files used some ensureXxxTable(s)-style
// name the old exact-match regex couldn't see. 16 of those 22 (isolated,
// single-purpose tables) were migrated the same day into
// prisma/migrations/20260910000023 through .../20260910000030.
//
// sso.ts and workflow-db.ts were migrated 2026-09-04 into
// prisma/migrations/20260910000031 and .../20260910000032 respectively.
// sso.ts got the full treatment (RLS added to tenant_sso_configs, plus a
// fix to admin/tenants/[id]/sso/route.ts's domain-conflict check, which
// used the bare prisma client instead of withPlatformAdmin and would have
// silently stopped seeing any rows once FORCE ROW LEVEL SECURITY landed).
// workflow-db.ts got DDL-only: every query in that file uses the bare
// prisma client, never a tenant-scoped transaction, so RLS would make the
// whole approval-workflow engine return zero rows. Its real tenant-
// isolation gap (listWorkflows() returns every tenant's rows when no
// tenantId filter is passed) is deliberately NOT fixed here — flagged as
// its own planned effort, starting with a full caller inventory across
// workflow-db.ts's ~19 exported functions before any signature changes.
// One confirmed-exploitable finding from that inventory WAS fixed
// immediately: admin/workflow-instances/route.ts called
// getAllWorkflowInstances()/getAllPendingStepInstances() with no tenant
// filter at all, so any authenticated user of any tenant could read
// every tenant's pending approvals. Both now require a tenantId.
//
// The 3-file service-config engine (schema.ts, rules-schema.ts,
// scopes-schema.ts) was migrated 2026-09-04 into
// prisma/migrations/20260910000033. DDL-only, same reasoning as
// workflow-db.ts: every query across all three files uses the bare
// prisma client, never a tenant-scoped transaction, so RLS would break
// the whole engine. Checked for a workflow-instances-style confirmed
// leak before migrating — found none: the one route exercising this
// path (types/[id]/rules/[category]/route.ts) already validates tenant
// ownership via ownsType()/getScope() before touching rules data.
//
// The last entry, logistics/domain.ts, was migrated 2026-09-04 into
// prisma/migrations/20260910000034 — 27 tables + 2 columns + ~40 indexes,
// all already carrying tenant_id at creation time. DDL-only, no RLS: 0
// uses of withTenantRls/withPlatformAdmin across the file's 216 raw SQL
// calls (same bare-prisma-client reasoning as workflow-db.ts and the
// service-config engine). Its second, unrelated DDL function,
// ensureFinanceJournalPostingTables, was already a no-op stub — those
// tables were migrated separately in 20260809000000 — so it was deleted
// outright. Spot-checked several exported functions with an optional/
// nullable tenantId parameter (fetchShipmentById, listShipmentOrders) for
// a workflow-instances-style confirmed leak; found none — every current
// caller supplies a concrete tenantId. A full caller audit of all ~60
// exported functions was not attempted and would be its own effort if
// ever needed.
//
// The allowlist is now empty — every file that once ran DDL at request
// time has been migrated.
const KNOWN_VIOLATIONS = new Set([]);

// ── Files reviewed to contain executable DDL (second check) ─────────────────
// Production never runs the provisionSchemaOnce DDL (src/lib/db/schema-init.ts:
// runtimeDdlAllowed); it serves fresh local databases, and readiness reports
// any missing object. The rest are follow-ups to move into migrations.
const REVIEWED_DDL_FILES = new Map([
  // provisionSchemaOnce modules (checked by src/lib/db/schema-registry.ts)
  ['src/lib/agents/schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/assets/ble-hw-schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/assets/schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/assets/spm-schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/dispatch/schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/fleet/hos-schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/fleet/schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/logistics/geofence-schema.ts', 'provisionSchemaOnce: local-only DDL'],
  ['src/lib/logistics/route-optimizer-schema.ts', 'provisionSchemaOnce: local-only DDL'],
  // Follow-ups: move into migrations, then delete the DDL and the entry.
  ['src/lib/ensure-columns.ts', 'FOLLOW-UP: addMissingColumns helper (billing, MFA, tenant provisioning)'],
  ['src/lib/billing.ts', 'FOLLOW-UP: ensureBillingColumns adds Stripe columns/indexes'],
  ['src/app/api/setup/super-admin/route.ts', 'FOLLOW-UP: one-time setup adds User.password_hash'],
  ['src/app/api/admin/migrate/fleet-phase1/route.ts', 'FOLLOW-UP: platform-admin manual migration endpoint'],
  ['src/app/api/admin/migrate/indexes/route.ts', 'FOLLOW-UP: platform-admin manual index endpoint'],
  ['src/app/api/admin/migrate/rac-phase1/route.ts', 'FOLLOW-UP: platform-admin manual migration endpoint'],
]);

const DDL = /\b(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SCHEMA|TYPE|SEQUENCE|EXTENSION|(?:OR\s+REPLACE\s+)?(?:FUNCTION|VIEW|TRIGGER))|ALTER\s+(?:TABLE|TYPE|SCHEMA)|DROP\s+(?:TABLE|INDEX|SCHEMA|TYPE))\b/;

/** Whether `content` has a DDL statement on a line that is not a comment. */
function hasExecutableDdl(content) {
  let inBlock = false;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('/*')) inBlock = true;
    const comment = inBlock || t.startsWith('//') || t.startsWith('*');
    if (t.includes('*/')) inBlock = false;
    if (!comment && DDL.test(line)) return true;
  }
  return false;
}

// ── Detection patterns ────────────────────────────────────────────────────────
// Matches lines declaring runtime-DDL functions anywhere in src/.
// bootstrap is only checked inside src/app/api/ to avoid false positives.
const PATTERNS = [
  /\basync function \w*[Ee]nsure\w*[Tt]ables?\b/,
  /\basync function ensureTableAndSeed\b/,
];
const API_ONLY_PATTERNS = [
  /\basync function bootstrap\b/,
];

// ── Walk src/ ─────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'out']);

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      yield full;
    }
  }
}

/** Return true if the file content contains any of the given patterns. */
function hasPattern(content, patterns) {
  return patterns.some(re => re.test(content));
}

// ── Scan ──────────────────────────────────────────────────────────────────────
const srcDir = join(root, 'src');
const apiDir = join(root, 'src', 'app', 'api');

/** Normalise an absolute path to a repo-relative POSIX path for Set lookups. */
function toRel(abs) {
  return relative(root, abs).replace(/\\/g, '/');
}

const foundFiles = new Set();
const ddlFiles = new Set();

for (const abs of walk(srcDir)) {
  const content = readFileSync(abs, 'utf8');
  const isInApi = abs.startsWith(apiDir);

  const matched =
    hasPattern(content, PATTERNS) ||
    (isInApi && hasPattern(content, API_ONLY_PATTERNS));

  if (matched) foundFiles.add(toRel(abs));
  if (hasExecutableDdl(content)) ddlFiles.add(toRel(abs));
}

// ── Evaluate the DDL check ──────────────────────────────────────────────────
const unreviewedDdl = [...ddlFiles].filter((f) => !REVIEWED_DDL_FILES.has(f)).sort();
const staleDdl = [...REVIEWED_DDL_FILES.keys()].filter((f) => !ddlFiles.has(f));
if (unreviewedDdl.length > 0) {
  console.error('\n✗  runtime-DDL guard FAILED — DDL in file(s) not reviewed for it:\n');
  for (const f of unreviewedDdl) {
    console.error(`   ${f}`);
    console.error('   ↳ Put CREATE/ALTER/DROP in a Prisma migration (prisma/migrations/), not application code.\n');
  }
}
if (staleDdl.length > 0) {
  console.log('\n  These files no longer contain DDL — remove them from REVIEWED_DDL_FILES:');
  for (const f of staleDdl) console.log(`    - '${f}'`);
}

// ── Evaluate ──────────────────────────────────────────────────────────────────
let hasNewViolation = false;
const staleEntries = new Set(KNOWN_VIOLATIONS);

for (const rel of foundFiles) {
  staleEntries.delete(rel); // still present → not stale

  if (!KNOWN_VIOLATIONS.has(rel)) {
    if (!hasNewViolation) {
      console.error('\n✗  runtime-DDL guard FAILED — new violation(s) detected:\n');
    }
    hasNewViolation = true;
    console.error(`   ${rel}`);
    console.error('   ↳ Move the DDL into a Prisma migration and delete the function.');
    console.error('   ↳ See prisma/migrations/ for examples.\n');
  }
}

// ── Report stale allowlist entries ───────────────────────────────────────────
if (staleEntries.size > 0) {
  console.log(
    '\n  These files were cleaned up — remove them from KNOWN_VIOLATIONS in this script:'
  );
  for (const f of staleEntries) {
    console.log(`    - '${f}'`);
  }
  console.log('');
}

// ── Summary ───────────────────────────────────────────────────────────────────
const remaining = foundFiles.size;

if (unreviewedDdl.length > 0) exit(1);

if (hasNewViolation) {
  console.error(
    `\n  ${remaining} runtime-DDL function(s) found; ${KNOWN_VIOLATIONS.size} are allowed.`
  );
  console.error(
    '  Do not add new ensureTable / ensureTables / bootstrap / ensureTableAndSeed functions.\n'
  );
  exit(1);
}

if (staleEntries.size > 0) {
  console.log(
    `✓  runtime-DDL guard passed — ${remaining} known violation(s) remain` +
      ` (${staleEntries.size} cleaned up since last update — shrink the allowlist!).`
  );
} else {
  console.log(`✓  runtime-DDL guard passed — ${remaining} known violation(s) remain.`);
}
console.log(`   executable DDL: ${ddlFiles.size} reviewed file(s) (${[...REVIEWED_DDL_FILES.values()].filter((r) => r.startsWith('FOLLOW-UP')).length} follow-ups to move into migrations).`);
