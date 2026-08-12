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
 *   async function ensureTableAndSeed(...)
 *   async function bootstrap(...)     ← only inside src/app/api/
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
const KNOWN_VIOLATIONS = new Set([
  'src/app/api/admin/dispatch-stats/route.ts',
  'src/app/api/admin/nav-permissions/route.ts',
  'src/app/api/admin/platform-settings/route.ts',
  'src/app/api/ambulance/calls/route.ts',
  'src/app/api/branch-staff/route.ts',
  'src/app/api/carrier-portal/app/loads/[id]/documents/route.ts',
  'src/app/api/esign/send/route.ts',
  'src/app/api/finance/deposits/route.ts',
  'src/app/api/finance/recurring-invoices/route.ts',
  'src/app/api/finance/reminder-schedules/route.ts',
  'src/app/api/incidents/[id]/notes/route.ts',
  'src/app/api/leasing/amendments/route.ts',
  'src/app/api/leasing/handover/route.ts',
  'src/app/api/leasing/transfers/route.ts',
  'src/app/api/logistics/quotes/route.ts',
  'src/app/api/logistics/shipments/[id]/documents/route.ts',
  'src/app/api/logistics/shipments/[id]/documents/[docId]/route.ts',
  'src/app/api/logistics/shipments/[id]/manifest/route.ts',
  'src/app/api/rental/branches/route.ts',
  'src/app/api/rental/documents/route.ts',
  'src/app/api/rental/insurance/route.ts',
  'src/app/api/rental/transfers/route.ts',
  'src/app/api/school-bus/allocations/route.ts',
  'src/app/api/school-bus/attendance/route.ts',
  'src/app/api/school-bus/attendants/route.ts',
  'src/app/api/school-bus/driver-scores/route.ts',
  'src/app/api/school-bus/fleet-positions/route.ts',
  'src/app/api/school-bus/schedules/route.ts',
  'src/app/api/school-bus/stops/route.ts',
  'src/app/api/school-bus/students/route.ts',
  'src/app/api/school-bus/trips/seed/route.ts',
  'src/app/api/sustainability/dashboard/route.ts',
  'src/app/api/sustainability/settings/route.ts',
  'src/app/api/tenant-subscriptions/route.ts',
  'src/app/api/tenants/pre-verify-domain/route.ts',
  'src/app/api/whatsapp/templates/route.ts',
]);

// ── Detection patterns ────────────────────────────────────────────────────────
// Matches lines declaring runtime-DDL functions anywhere in src/.
// bootstrap is only checked inside src/app/api/ to avoid false positives.
const PATTERNS = [
  /\basync function ensureTables?\b/,
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
