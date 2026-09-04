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
// Discovered 2026-09-04 when the regex below was broadened to close the
// ensureTripTables gap (see WHAT IT DETECTS above): all 22 of these use
// some ensureXxxTable(s)-style name the old exact-match regex couldn't see.
// None of these were touched by that day's 35-file migration — they are
// newly-visible pre-existing debt, not new violations, and are listed here
// under the same ratchet the original 35 used. Not yet migrated.
const KNOWN_VIOLATIONS = new Set([
  'src/app/api/agents/ecosystem/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/bus-ops/route-types/route.ts',
  'src/app/api/finance/invoices/[id]/route.ts',
  'src/app/api/school-bus/capacity-check/route.ts',
  'src/lib/api-keys.ts',
  'src/lib/audit.ts',
  'src/lib/bus-ops/telemetry-settings.ts',
  'src/lib/invitations.ts',
  'src/lib/leasing/payment-schema.ts',
  'src/lib/leasing/self-service-schema.ts',
  'src/lib/leasing-portal/schema.ts',
  'src/lib/logistics/domain.ts',
  'src/lib/school-bus-notify.ts',
  'src/lib/service-config/rules-schema.ts',
  'src/lib/service-config/schema.ts',
  'src/lib/service-config/scopes-schema.ts',
  'src/lib/service-tickets/access.ts',
  'src/lib/service-tickets/schema.ts',
  'src/lib/shipper-portal/schema.ts',
  'src/lib/sso.ts',
  'src/lib/workflow-db.ts',
]);

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

for (const abs of walk(srcDir)) {
  const content = readFileSync(abs, 'utf8');
  const isInApi = abs.startsWith(apiDir);

  const matched =
    hasPattern(content, PATTERNS) ||
    (isInApi && hasPattern(content, API_ONLY_PATTERNS));

  if (matched) foundFiles.add(toRel(abs));
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
