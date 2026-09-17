#!/usr/bin/env node
// scripts/fresh-install-migrate.cjs
//
// Reliable migration runner for provisioning a NEW environment (a genuinely
// empty database) — staging, DR, or a new client deployment.
//
// Safety & Security Hardening:
// 1. Unified Target Selection:
//    Resolves DIRECT_URL / DATABASE_URL consistently and synchronizes both for
//    all subprocess invocations and internal PrismaClient instances.
// 2. Unambiguous Failure Extraction & Strict 20-Step Classification:
//    Parses the exact failing migration name, PG error code, and error message
//    from Prisma's structured error block. Prevents false matches on earlier
//    migrations in stdout. Cross-checks against _prisma_migrations.
// 3. Preconditions & Freshness Guards:
//    Requires explicit --fresh-install or CONFIRM_FRESH_INSTALL=1.
//    Inspects all 7 managed schemas and _prisma_migrations.
//    Employs PostgreSQL advisory locks (pg_try_advisory_lock).
// 4. Post-Flight Verification:
//    Executes 19-step schema manifest verification, runtime role privilege audit
//    (rejecting superuser/bypassrls), and deterministic dual-tenant RLS isolation probe.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { verifyFreshInstallPostflight } = require('./verify-fresh-install-postflight.cjs');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'FRESH_DATABASE_SETUP.md');
const PRISMA_BIN = require.resolve('prisma/build/index.js');
const MANAGED_SCHEMAS = ['public', 'finance', 'ai', 'workforce', 'fleet', 'operations', 'spatial'];
const ADVISORY_LOCK_ID = 8839210;

// Critical infrastructure & security errors that MUST NEVER trigger a migration resolve
const FORBIDDEN_ERROR_PATTERNS = [
  /permission denied/i,
  /must be owner of/i,
  /password authentication failed/i,
  /connection refused/i,
  /ECONNREFUSED/i,
  /P1000/i, // Authentication failed
  /P1001/i, // Can't reach database server
  /P1002/i, // Database server timed out
  /P1003/i, // Database does not exist
  /FATAL:/i,
];

// Valid underlying PostgreSQL error signatures that correspond to historical schema replay gaps.
const EXPECTED_GAP_SIGNATURES = [
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /table .* does not exist/i,
  /schema .* does not exist/i,
  /type .* already exists/i,
  /relation .* already exists/i,
  /table .* already exists/i,
  /cannot use .* in column generation expression/i,
  /generation expression is not immutable/i,
  /cannot drop .* because other objects depend on it/i,
  /current transaction is aborted/i,
  /verification failed/i,
];

// Exact target object bindings for documented historical schema replay gaps.
// Binds each resolvable migration to its specific missing target object and expected PG error codes.
const DOCUMENTED_GAPS = {
  '20260815140000_tenant_001_leasing_rental_isolation': {
    targetObject: 'rental_rate_quotes',
    expectedCodes: ['42P01'],
    expectedSignatures: [
      /relation "(?:public\.)?rental_rate_quotes" does not exist/i,
      /table "(?:public\.)?rental_rate_quotes" does not exist/i,
      /rental_rate_quotes/i,
    ],
  },
  '20260816000000_route_consolidation_phase2_schema': {
    targetObject: 'bus_routes / route_passengers',
    expectedCodes: ['42P01'],
    expectedSignatures: [
      /relation "(?:public\.)?bus_routes" does not exist/i,
      /relation "(?:public\.)?route_passengers" does not exist/i,
      /bus_routes/i,
      /route_passengers/i,
    ],
  },
  '20260818100000_fleet_routing_foundation': {
    targetObject: 'route_passengers / bus_routes',
    expectedCodes: ['42P01'],
    expectedSignatures: [
      /relation "(?:public\.)?route_passengers" does not exist/i,
      /relation "(?:public\.)?bus_routes" does not exist/i,
      /table "(?:public\.)?route_passengers" does not exist/i,
      /table "(?:public\.)?bus_routes" does not exist/i,
      /route_passengers/i,
      /bus_routes/i,
    ],
  },
  '20260821000000_vehicle_route_zone_tagging': {
    targetObject: 'spatial.places',
    expectedCodes: ['42P01', '3F000'],
    expectedSignatures: [/places/i, /zone_id/i, /spatial/i],
  },
  '20260824000000_add_tenant_constraints_and_indexes': {
    targetObject: 'customers / trip_passengers / work_orders / WorkOrder',
    expectedCodes: ['42P01', '42703'],
    expectedSignatures: [/customers/i, /trip_passengers/i, /work_orders/i, /WorkOrder/i],
  },
  '20260904000000_add_tenant_id_to_lease_rental_children': {
    targetObject: 'rental_payment_transactions',
    expectedCodes: ['42P01', '42703'],
    expectedSignatures: [/rental_/i, /tenant_id/i, /lease_/i],
  },
  '20260905000000_adopt_route_optimisation_results': {
    targetObject: 'route_optimisation_results',
    expectedCodes: ['42P01', '42703'],
    expectedSignatures: [/route_optimisation_results/i],
  },
  '20260909000000_per_tenant_rental_agreement_numbers': {
    targetObject: 'rental_agreements',
    expectedCodes: ['42P01', '42703'],
    expectedSignatures: [/rental_agreements/i, /tenant_id/i],
  },
  '20260910000000_remove_null_tenant_escape': {
    targetObject: 'rental_rate_quotes / rental_agreements',
    expectedCodes: ['42P01', '42703', 'P0001'],
    expectedSignatures: [/rental_rate_quotes/i, /rental_agreements/i, /verification failed/i, /tenant/i],
  },
  '20260910000003_login_attempts_platform_only': {
    targetObject: 'auth_login_attempts',
    expectedCodes: ['42P01', 'P0001'],
    expectedSignatures: [/auth_login_attempts/i, /verification failed/i, /tenant/i],
  },
  '20260910000004_enable_rls_seven_tables': {
    targetObject: 'trip_schedules',
    expectedCodes: ['42P01', 'P0001'],
    expectedSignatures: [/trip_schedules/i, /verification failed/i, /tenant/i, /RLS/i, /WorkOrder/i],
  },
  '20260910000005_resolve_finance_payments_shadow': {
    targetObject: 'finance_payments shadow resolution / verification',
    expectedCodes: ['P0001', '42P01'],
    expectedSignatures: [/unqualified finance_payments resolves to/i, /finance_payments/i, /verification failed/i],
  },
  '20260910000006_finance_schema_null_escape': {
    targetObject: 'finance schema / tables',
    expectedCodes: ['3F000', '42P01', 'P0001', '42703'],
    expectedSignatures: [
      /schema "finance" does not exist/i,
      /column "tenant_id" does not exist/i,
      /tenant_id/i,
      /finance/i,
      /verification failed/i,
    ],
  },
  '20260910000008_fleet_operations_null_escape': {
    targetObject: 'operations / fleet schema',
    expectedCodes: ['3F000', '42P01', 'P0001', '42703'],
    expectedSignatures: [
      /schema "operations" does not exist/i,
      /schema "fleet" does not exist/i,
      /relation "(operations|fleet)\./i,
      /column "tenant_id" does not exist/i,
      /tenant_id/i,
      /verification failed/i,
      /escape/i,
    ],
  },
  '20260910000009_backfill_bookings_hierarchy_tenant': {
    targetObject: 'logistics_shipment_orders / bookings.tenant_id',
    expectedCodes: ['42P01', '42703', 'P0001'],
    expectedSignatures: [/logistics_shipment_orders/i, /bookings/i, /customer_hierarchy/i, /tenant_id/i, /verification failed/i],
  },
  '20260910000010_grant_app_role_schema_access': {
    targetObject: 'fleet360_app / domain schemas',
    expectedCodes: ['3F000', '42501', 'P0001', '42P01'],
    expectedSignatures: [/schema "(fleet|operations|finance|spatial|workforce|ai)" does not exist/i, /fleet360_app/i, /permission/i, /verification failed/i, /lacks USAGE/i],
  },
  '20260910000016_finance_deposits_recurring_tables_and_rls': {
    targetObject: 'finance_security_deposits column generation',
    expectedCodes: ['42P17', '0A000', '42P01', 'P0001'],
    expectedSignatures: [/generation expression/i, /CURRENT_DATE/i, /immutable/i, /finance_security_deposits/i, /verification failed/i],
  },
  '20260910000024_auth_security_tables_and_rls': {
    targetObject: 'password_reset_tokens / audit_logs / tenant_invitations / tenant_api_keys',
    expectedCodes: ['42P07', '42710', '42P01', '42703', 'P0001'],
    expectedSignatures: [
      /(?:relation|table|type)\s+"?(?:password_reset_tokens|audit_logs|tenant_api_keys|tenant_invitations)"?\s+already exists/i,
      /password_reset_tokens/i,
      /audit_logs/i,
      /tenant_api_keys/i,
      /tenant_invitations/i,
      /token_hash/i,
    ],
  },
  '20260911120000_lease_return_settlement_workflow': {
    targetObject: 'lease_vehicle_returns / lease_allocation_occurrences / finance_security_deposits',
    expectedCodes: ['42P01', '42703', 'P0001'],
    expectedSignatures: [
      /lease_vehicle_returns/i,
      /lease_return_settlements/i,
      /lease_allocation_occurrences/i,
      /finance_security_deposits/i,
      /leasing_handovers/i,
      /tenant_id/i,
      /verification failed/i,
    ],
  },
  '20260914140000_fresh_replay_rental_leasing_gap': {
    targetObject: 'rental_rate_quotes / rental_extensions.tenant_id',
    expectedCodes: ['42703', '42P01', 'P0001'],
    expectedSignatures: [
      /column "tenant_id"/i,
      /tenant_id/i,
      /rental_/i,
      /verification failed/i,
    ],
  },
};

/**
 * Unifies target database selection across CLI options and environment variables.
 */
function resolveMigrationTarget(options = {}) {
  let targetUrl = options.databaseUrl;
  if (!targetUrl) {
    const urlArg = process.argv.find(arg => arg.startsWith('--database-url='));
    if (urlArg) {
      targetUrl = urlArg.slice('--database-url='.length).trim();
    }
  }
  if (!targetUrl) {
    targetUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  }
  if (!targetUrl) {
    throw new Error('Neither DIRECT_URL nor DATABASE_URL environment variable is set.');
  }

  // Validate URL syntax
  try {
    const parsed = new URL(targetUrl.replace(/^postgresql:\/\//, 'http://').replace(/^postgres:\/\//, 'http://'));
    if (!parsed.hostname) throw new Error('Missing hostname');
  } catch (err) {
    throw new Error(`Invalid PostgreSQL migration target URL: ${err.message}`);
  }

  return targetUrl;
}

function shouldHaltOnForbiddenError(output) {
  for (const forbidden of FORBIDDEN_ERROR_PATTERNS) {
    if (forbidden.test(output)) {
      return { isForbidden: true, matchedPattern: forbidden };
    }
  }
  return { isForbidden: false };
}

function hasExpectedGapSignature(output) {
  for (const sig of EXPECTED_GAP_SIGNATURES) {
    if (sig.test(output)) {
      return { hasSignature: true, matchedPattern: sig };
    }
  }
  return { hasSignature: false };
}

/**
 * Parses Prisma CLI stdout/stderr to extract the exact failing migration,
 * PostgreSQL error code, and underlying database error message.
 */
function extractFailureDetails(output) {
  // Extract the failure block (excluding earlier stdout)
  let errorBlock = output;
  const errIdx = output.search(/(?:Error:\s*P3018|Error:\s*ERROR|Database error|DbError|A migration failed to apply)/i);
  if (errIdx !== -1) {
    errorBlock = output.slice(errIdx);
  }

  // 1. Extract failing migration name(s)
  // Patterns for failing migration:
  // - with migration_name="<name>" (Prisma Rust schema-engine backtrace)
  // - Migration name: <name>
  // - The `<name>` migration started at ... failed
  // - Migration: <name>
  // - Failed to apply migration: `<name>`
  // - A migration failed to apply.*`<name>`
  const namePatterns = [
    /with\s+migration_name="([^"]+)"/i,
    /Migration name:\s*`?([0-9a-zA-Z_]+)`?/i,
    /The\s+`([0-9a-zA-Z_]+)`\s+migration\s+started\s+at\s+.*failed/i,
    /Migration:\s*`?([0-9a-zA-Z_]+)`?/i,
    /Failed to apply migration:?\s*`?([0-9a-zA-Z_]+)`?/i,
    /A migration failed to apply.*`([0-9a-zA-Z_]+)`/i,
  ];

  const foundNames = new Set();
  for (const p of namePatterns) {
    const globalP = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    let m;
    while ((m = globalP.exec(output)) !== null) {
      if (m[1] && m[1].trim() !== 'with') {
        foundNames.add(m[1].trim());
      }
    }
  }

  const applyingMatches = [...output.matchAll(/(?:Applying migration\s+`([0-9a-zA-Z_]+)`|Applying migration\s+(\d{14}_[0-9a-zA-Z_]+))/gi)];
  if (applyingMatches.length > 0) {
    const lastMatch = applyingMatches[applyingMatches.length - 1];
    const capturedName = (lastMatch[1] || lastMatch[2] || '').trim();
    if (capturedName && capturedName !== 'with') {
      foundNames.add(capturedName);
    }
  }

  const distinctNames = Array.from(foundNames);
  let failingMigration = null;
  let isAmbiguous = false;

  if (distinctNames.length === 1) {
    failingMigration = distinctNames[0];
  } else if (distinctNames.length > 1) {
    isAmbiguous = true;
  }

  // 2. Extract PostgreSQL error code
  let errorCode = null;
  const codeMatch =
    /Database error code:\s*([0-9A-Z]{5})/i.exec(errorBlock) ||
    /code:\s*"([0-9A-Z]{5})"/i.exec(errorBlock) ||
    /PostgreSQL error code:\s*([0-9A-Z]{5})/i.exec(errorBlock) ||
    /code:\s*SqlState\(E?([0-9A-Z]{5})\)/i.exec(errorBlock) ||
    /Database error code:\s*([0-9A-Z]{5})/i.exec(output) ||
    /code:\s*"([0-9A-Z]{5})"/i.exec(output) ||
    /PostgreSQL error code:\s*([0-9A-Z]{5})/i.exec(output) ||
    /code:\s*SqlState\(E?([0-9A-Z]{5})\)/i.exec(output);
  if (codeMatch && codeMatch[1]) {
    errorCode = codeMatch[1].trim().toUpperCase();
  } else if (/current transaction is aborted/i.test(output)) {
    errorCode = '25P02';
  }

  // 3. Extract database error message line/block
  let databaseErrorMessage = '';
  const msgMatch =
    /Database error:\s*\n?\s*(?:ERROR:\s*)?([^\n]+)/i.exec(errorBlock) ||
    /Error:\s*ERROR:\s*([^\n]+)/i.exec(errorBlock) ||
    /DbError\s*\{[^}]*message:\s*"([^"]+)"/i.exec(errorBlock) ||
    /ERROR:\s*([^\n]+)/i.exec(errorBlock) ||
    /Database error:\s*\n?\s*(?:ERROR:\s*)?([^\n]+)/i.exec(output) ||
    /Error:\s*ERROR:\s*([^\n]+)/i.exec(output) ||
    /DbError\s*\{[^}]*message:\s*"([^"]+)"/i.exec(output) ||
    /ERROR:\s*([^\n]+)/i.exec(output);
  if (msgMatch && msgMatch[1]) {
    databaseErrorMessage = msgMatch[1].trim();
  }

  return {
    failingMigration,
    errorCode,
    databaseErrorMessage,
    errorBlock,
    isAmbiguous,
    distinctNames,
  };
}

/**
 * Evaluates migration deploy output against documented gap requirements.
 */
function evaluateMigrationFailure(output, remainingOrMigration) {
  const forbidden = shouldHaltOnForbiddenError(output);
  if (forbidden.isForbidden) {
    return {
      canResolve: false,
      reason: 'FORBIDDEN_INFRASTRUCTURE_ERROR',
      forbiddenPattern: forbidden.matchedPattern,
    };
  }

  const { failingMigration, errorCode, databaseErrorMessage, errorBlock, isAmbiguous, distinctNames } = extractFailureDetails(output);

  if (isAmbiguous) {
    return {
      canResolve: false,
      reason: 'AMBIGUOUS_MIGRATION_NAMES',
      conflictingNames: distinctNames,
      details: `Failure output contains conflicting migration names: ${distinctNames.join(', ')}`,
    };
  }

  if (!failingMigration) {
    return {
      canResolve: false,
      reason: 'CANNOT_DETERMINE_FAILED_MIGRATION',
    };
  }

  // 1. Mandatory error code assertion
  if (!errorCode) {
    return {
      canResolve: false,
      reason: 'MISSING_ERROR_CODE',
      migrationName: failingMigration,
      details: 'Failure report did not contain a valid PostgreSQL error code (required for resolution).',
    };
  }

  // 2. Reject 25P02
  if (errorCode === '25P02') {
    return {
      canResolve: false,
      reason: 'ABORTED_TRANSACTION_CODE_ONLY',
      migrationName: failingMigration,
      actualCode: '25P02',
      details: 'Error 25P02 (current transaction is aborted) is a secondary symptom; resolution requires the original root PostgreSQL error code.',
    };
  }

  const candidateNames = Array.isArray(remainingOrMigration)
    ? remainingOrMigration
    : [remainingOrMigration];

  const idx = candidateNames.indexOf(failingMigration);
  if (idx === -1) {
    return {
      canResolve: false,
      reason: 'UNKNOWN_MIGRATION',
      migrationName: failingMigration,
    };
  }

  // Verify generic signature against the error block (not the whole log)
  const expectedSig = hasExpectedGapSignature(errorBlock);
  if (!expectedSig.hasSignature) {
    return {
      canResolve: false,
      reason: 'UNEXPECTED_ERROR_SIGNATURE',
      migrationName: failingMigration,
      errorCode,
      details: databaseErrorMessage,
    };
  }

  // Check specific gap definition in DOCUMENTED_GAPS
  const gapMeta = DOCUMENTED_GAPS[failingMigration];
  if (!gapMeta) {
    return {
      canResolve: false,
      reason: 'UNDOCUMENTED_MIGRATION',
      migrationName: failingMigration,
    };
  }

  // 3. Strict code match
  if (!gapMeta.expectedCodes || !gapMeta.expectedCodes.includes(errorCode)) {
    return {
      canResolve: false,
      reason: 'UNEXPECTED_ERROR_CODE',
      migrationName: failingMigration,
      actualCode: errorCode,
      expectedCodes: gapMeta.expectedCodes || [],
    };
  }

  // 4. Enforce target object match strictly against the extracted database error message and error block
  // (NEVER against the migration name itself, to prevent /operations/ matching 20260910000008_fleet_operations_null_escape)
  const sanitizedErrorBlock = errorBlock
    .split('\n')
    .filter(line => !/migration_name|Migration name|Applying migration/i.test(line))
    .join('\n');
  const targetCheckString = `${databaseErrorMessage}\n${sanitizedErrorBlock}`;
  const matchesTargetObject = gapMeta.expectedSignatures.some(sig => sig.test(targetCheckString));
  if (!matchesTargetObject) {
    return {
      canResolve: false,
      reason: 'UNEXPECTED_ERROR_SIGNATURE',
      migrationName: failingMigration,
      expectedTargetObject: gapMeta.targetObject,
      details: targetCheckString,
      actualCode: errorCode,
      expectedCodes: gapMeta.expectedCodes,
    };
  }

  return {
    canResolve: true,
    reason: 'MATCHED_EXPECTED_GAP',
    migrationName: failingMigration,
    index: idx,
    matchedSignature: expectedSig.matchedPattern,
    targetObject: gapMeta.targetObject,
    errorCode,
  };
}

function loadKnownResolveChain(docPath = DOC_PATH) {
  if (!fs.existsSync(docPath)) {
    console.warn(
      `Warning: ${path.relative(process.cwd(), docPath)} not found — running ` +
        `a plain "migrate deploy" with no known resolve steps.`
    );
    return [];
  }
  const text = fs.readFileSync(docPath, 'utf8');
  const fenceMatch = text.match(/## Full resolve chain[\s\S]*?```bash([\s\S]*?)```/);
  if (!fenceMatch) {
    console.warn(
      `Warning: could not find the "Full resolve chain" code block in ` +
        `${path.relative(process.cwd(), docPath)} — running a plain "migrate ` +
        `deploy" with no known resolve steps.`
    );
    return [];
  }
  const block = fenceMatch[1];
  const names = [];
  const lineRe = /^npx prisma migrate resolve --applied (\S+)\s*$/gm;
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Builds an effective migration state from _prisma_migrations attempt history.
 * Accounts for retried, resolved, rolled back, and unresolved attempts.
 */
function buildEffectiveMigrationState(recordedMigrations) {
  const sorted = [...(recordedMigrations || [])].sort((a, b) => {
    const tA = a.started_at ? new Date(a.started_at).getTime() : 0;
    const tB = b.started_at ? new Date(b.started_at).getTime() : 0;
    return tA - tB;
  });

  const migrationMap = new Map();

  for (const record of sorted) {
    const name = record.migration_name;
    if (!migrationMap.has(name)) {
      migrationMap.set(name, {
        migrationName: name,
        attempts: [],
        isCompleted: false,
        isRolledBack: false,
        isUnresolved: false,
        effectiveChecksum: null,
      });
    }
    const entry = migrationMap.get(name);
    entry.attempts.push(record);

    if (record.finished_at !== null) {
      entry.isCompleted = true;
      entry.isUnresolved = false;
      entry.effectiveChecksum = record.checksum || entry.effectiveChecksum;
    } else if (record.rolled_back_at !== null) {
      if (!entry.isCompleted) {
        entry.isRolledBack = true;
      }
    } else {
      if (!entry.isCompleted) {
        entry.isUnresolved = true;
      }
    }
  }

  const uniqueMigrations = Array.from(migrationMap.values());
  const completedMigrations = uniqueMigrations.filter(m => m.isCompleted);
  const unresolvedMigrations = uniqueMigrations.filter(m => m.isUnresolved);

  return {
    uniqueMigrations,
    completedMigrations,
    unresolvedMigrations,
  };
}

/**
 * Validates resumption state against migrations on disk and Prisma attempt history.
 */
function validateResumptionState(recordedMigrations, resumeFromMigration, migrationsDir = path.join(__dirname, '../prisma/migrations')) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at ${migrationsDir}`);
  }

  const diskEntries = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(migrationsDir, d.name, 'migration.sql')))
    .map(d => d.name)
    .sort();

  if (!diskEntries.includes(resumeFromMigration)) {
    throw new Error(`Resume migration "${resumeFromMigration}" does not exist on disk.`);
  }

  const { completedMigrations, unresolvedMigrations } = buildEffectiveMigrationState(recordedMigrations);

  // 1. Verify ordered prefix on disk for all completed migrations
  if (completedMigrations.length > diskEntries.length) {
    throw new Error(
      `Database has ${completedMigrations.length} completed migrations, but only ${diskEntries.length} exist on disk.`
    );
  }

  const crypto = require('crypto');

  for (let i = 0; i < completedMigrations.length; i++) {
    const completedName = completedMigrations[i].migrationName;
    const diskName = diskEntries[i];
    if (completedName !== diskName) {
      throw new Error(
        `Migration sequence divergence at index ${i}: database has completed "${completedName}", but disk has "${diskName}".`
      );
    }

    // 2. Verify SHA256 checksum (handling CRLF/LF line-endings)
    const recordedChecksum = completedMigrations[i].effectiveChecksum;
    if (recordedChecksum) {
      const sqlPath = path.join(migrationsDir, diskName, 'migration.sql');
      const fileBytes = fs.readFileSync(sqlPath);
      const rawHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
      const normalizedHash = crypto.createHash('sha256').update(
        Buffer.from(fileBytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
      ).digest('hex');

      if (recordedChecksum !== rawHash && recordedChecksum !== normalizedHash) {
        throw new Error(
          `Checksum mismatch for migration "${diskName}": database recorded "${recordedChecksum}", ` +
          `computed from disk raw="${rawHash}", normalized="${normalizedHash}".`
        );
      }
    }
  }

  // 3. Define resume point semantics consistently:
  // Case A: Interrupted at active unapplied migration -> resumeFromMigration MUST match the single active unapplied migration
  // Case B: Interrupted after completion -> resumeFromMigration MUST match the last completed migration
  if (unresolvedMigrations.length > 1) {
    throw new Error(
      `Ambiguous database state: found ${unresolvedMigrations.length} unresolved migration attempts ` +
      `(${unresolvedMigrations.map(m => m.migrationName).join(', ')}). Manual operator intervention required.`
    );
  }

  if (unresolvedMigrations.length === 1) {
    const activeName = unresolvedMigrations[0].migrationName;
    if (resumeFromMigration !== activeName) {
      throw new Error(
        `Invalid resume point "${resumeFromMigration}". Database has an active unresolved migration attempt ` +
        `for "${activeName}". The resume point must be the immediate failed migration: "${activeName}".`
      );
    }
  } else {
    // No active unapplied migration: must resume after the last completed migration
    const lastCompleted = completedMigrations.length > 0 ? completedMigrations[completedMigrations.length - 1].migrationName : null;
    if (resumeFromMigration !== lastCompleted) {
      throw new Error(
        `Invalid resume point "${resumeFromMigration}". Database has no active failed attempts; ` +
        `the resume point must match the last completed migration: "${lastCompleted || 'none'}".`
      );
    }
  }

  return true;
}

/**
 * Checks database preconditions, freshness, and advisory locking.
 */
async function verifyDatabasePreconditions(options = {}) {
  const targetUrl = resolveMigrationTarget(options);

  // Intent guard: require explicit --fresh-install or CONFIRM_FRESH_INSTALL=1 unless resuming
  let resumeFromMigration = options.resumeBootstrapFrom;
  if (!resumeFromMigration) {
    const resumeArg = process.argv.find(arg => arg.startsWith('--resume-bootstrap-from='));
    if (resumeArg) {
      resumeFromMigration = resumeArg.slice('--resume-bootstrap-from='.length).trim();
    }
  }

  const hasFreshIntent =
    options.freshInstallIntent !== undefined
      ? Boolean(options.freshInstallIntent)
      : (process.argv.includes('--fresh-install') || process.env.CONFIRM_FRESH_INSTALL === '1');

  if (!hasFreshIntent && !resumeFromMigration) {
    const msg =
      '✗ Error: Fresh database bootstrap requires explicit confirmation.\n' +
      '  Pass --fresh-install flag or set CONFIRM_FRESH_INSTALL=1.\n' +
      '  To resume an interrupted bootstrap, pass --resume-bootstrap-from=<migration_name>.';
    console.error(msg);
    if (options.throwOnError) {
      throw new Error('Fresh install requires explicit confirmation (--fresh-install or CONFIRM_FRESH_INSTALL=1).');
    }
    process.exit(1);
  }

  console.log('Verifying database connectivity, preconditions, and locks…');
  const prisma = options.prismaClient || new PrismaClient({ datasources: { db: { url: targetUrl } } });

  try {
    const [ident] = await prisma.$queryRaw`SELECT current_user, current_database(), version()`;
    console.log(`✓ Connected to PostgreSQL as user "${ident.current_user}" on database "${ident.current_database}".`);

    // Acquire PostgreSQL advisory lock using non-blocking pg_try_advisory_lock
    try {
      const [lockResult] = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) AS acquired`;
      if (lockResult && !lockResult.acquired) {
        throw new Error('Another fresh-install bootstrap process is currently running on this database (advisory lock held).');
      }
      console.log('✓ Advisory lock acquired (exclusive bootstrap session).');
    } catch (err) {
      console.error(`✗ Advisory lock check failed: ${err.message}`);
      if (options.throwOnError) throw err;
      process.exit(1);
    }

    // Inspect _prisma_migrations
    let migrationCount = 0;
    let migrationsTableExists = true;
    let recordedMigrations = [];

    try {
      const records = await prisma.$queryRaw`
        SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
        FROM "_prisma_migrations"
        ORDER BY started_at ASC
      `;
      recordedMigrations = records || [];
      const finished = recordedMigrations.filter(r => r.finished_at !== null);
      migrationCount = finished.length;
      console.log(`  Database status: ${migrationCount} completed migration(s) recorded in _prisma_migrations.`);
    } catch (err) {
      const errMsg = err.message || '';
      const errCode = err.code;
      const isMissingTable =
        errCode === '42P01' ||
        /relation "_prisma_migrations" does not exist/i.test(errMsg) ||
        /table "_prisma_migrations" does not exist/i.test(errMsg);

      if (!isMissingTable) {
        console.error(`✗ Error querying _prisma_migrations (fail-closed, code: ${errCode || 'none'}):`, errMsg);
        if (options.throwOnError) throw err;
        process.exit(1);
      }

      migrationsTableExists = false;
      console.log('  Database status: Fresh empty database (_prisma_migrations table does not exist yet).');
    }

    // Inspect all 7 managed schemas for existing database objects across:
    // tables, views, foreign tables, matviews, sequences, functions, and user types
    const appTables = await prisma.$queryRaw`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = ANY(${MANAGED_SCHEMAS})
        AND table_name != '_prisma_migrations'
    `;
    const appMatviews = await prisma.$queryRaw`
      SELECT schemaname AS table_schema, matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type
      FROM pg_matviews
      WHERE schemaname = ANY(${MANAGED_SCHEMAS})
    `;
    const appSequences = await prisma.$queryRaw`
      SELECT sequence_schema AS table_schema, sequence_name AS table_name, 'SEQUENCE' AS table_type
      FROM information_schema.sequences
      WHERE sequence_schema = ANY(${MANAGED_SCHEMAS})
    `;
    const appRoutines = await prisma.$queryRaw`
      SELECT routine_schema AS table_schema, routine_name AS table_name, 'FUNCTION' AS table_type
      FROM information_schema.routines
      WHERE routine_schema = ANY(${MANAGED_SCHEMAS})
    `;
    const appTypes = await prisma.$queryRaw`
      SELECT n.nspname AS table_schema, t.typname AS table_name, 'TYPE' AS table_type
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = ANY(${MANAGED_SCHEMAS})
        AND t.typtype = 'e'
    `;

    const totalAppObjects = [
      ...(appTables || []),
      ...(appMatviews || []),
      ...(appSequences || []),
      ...(appRoutines || []),
      ...(appTypes || []),
    ];
    const appObjectCount = totalAppObjects.length;

    if ((!migrationsTableExists || migrationCount === 0) && appObjectCount > 0) {
      const sampleObjects = totalAppObjects
        .slice(0, 5)
        .map(o => `${o.table_schema}.${o.table_name} (${o.table_type})`)
        .join(', ');
      const msg =
        `✗ Error: Database is not empty. Found ${appObjectCount} application object(s) across managed schemas ` +
        `(${MANAGED_SCHEMAS.join(', ')}), but _prisma_migrations is ${migrationsTableExists ? 'empty' : 'missing'}.\n` +
        `  Sample objects: ${sampleObjects}\n` +
        '  This indicates an unmanaged or manually initialized database. Halting execution.';
      console.error(msg);
      if (options.throwOnError) {
        throw new Error(`Database is not empty (${appObjectCount} application objects found in managed schemas).`);
      }
      process.exit(1);
    }

    if (migrationCount > 0) {
      if (!resumeFromMigration) {
        const msg =
          `✗ Error: Database is not fresh. Found ${migrationCount} applied migration(s) in _prisma_migrations.\n` +
          '  fresh-install-migrate is intended ONLY for fresh database installations.\n' +
          '  To resume an interrupted bootstrap, specify --resume-bootstrap-from=<migration_name>.';
        console.error(msg);
        if (options.throwOnError) {
          throw new Error(`Database is not fresh (${migrationCount} migrations found) without resume point.`);
        }
        process.exit(1);
      }

      // Rigorous resumption state validation (prefix, checksums, immediate failure point)
      validateResumptionState(recordedMigrations, resumeFromMigration, options.migrationsDir);
      console.log(`✓ Resuming bootstrap after verified migration: "${resumeFromMigration}".`);
    }

    return {
      currentUser: ident.current_user,
      database: ident.current_database,
      migrationCount,
      resumeFromMigration,
      targetUrl,
    };
  } catch (err) {
    console.error('✗ Database connectivity / precondition check failed:', err.message);
    if (options.throwOnError) throw err;
    process.exit(1);
  } finally {
    if (!options.prismaClient) {
      await prisma.$disconnect();
    }
  }
}

/**
 * Runs `prisma migrate deploy` with unified connection parameters.
 */
function tryDeploy(label, targetUrl) {
  console.log(`\n--- prisma migrate deploy (${label}) ---`);
  try {
    const out = execFileSync(process.execPath, [PRISMA_BIN, 'migrate', 'deploy'], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
        DIRECT_URL: targetUrl,
      },
    });
    process.stdout.write(out);
    return { ok: true, output: out };
  } catch (err) {
    const out = `${err.stdout || ''}\n${err.stderr || ''}`;
    process.stdout.write(out);
    return { ok: false, output: out };
  }
}

/**
 * Resolves a migration as applied with unified connection parameters.
 */
function resolveMigration(name, targetUrl) {
  console.log(`\nApplying verified workaround for documented gap: "${name}" (marking resolved, not run)…`);
  try {
    execFileSync(process.execPath, [PRISMA_BIN, 'migrate', 'resolve', '--applied', name], {
      encoding: 'utf8',
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: targetUrl,
        DIRECT_URL: targetUrl,
      },
    });
  } catch (err) {
    console.error(`\n✗ Error: "migrate resolve --applied ${name}" failed — halting execution.`);
    process.exit(1);
  }
}

/**
 * Release advisory lock.
 */
async function releaseAdvisoryLock(prisma) {
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
    console.log('✓ Advisory lock released.');
  } catch (err) {
    // Ignore unlock errors during teardown
  }
}

async function main() {
  const targetUrl = resolveMigrationTarget();
  // Synchronize process env
  process.env.DATABASE_URL = targetUrl;
  process.env.DIRECT_URL = targetUrl;

  const prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  try {
    await verifyDatabasePreconditions({ targetUrl, prismaClient: prisma });

    const knownChain = loadKnownResolveChain();
    console.log(
      `Loaded ${knownChain.length} known resolve step(s) from ` +
        `${path.relative(process.cwd(), DOC_PATH)}.`
    );

    const remaining = [...knownChain];
    let attempt = 1;

    for (;;) {
      const result = tryDeploy(`attempt ${attempt}`, targetUrl);
      if (result.ok) {
        console.log('\n✓ Migration deployment complete. Executing post-flight verification…');
        await verifyFreshInstallPostflight({ databaseUrl: targetUrl, prismaClient: prisma });
        console.log('\n✓ All migrations applied and post-flight verification passed. Environment is ready.');
        await releaseAdvisoryLock(prisma);
        return;
      }

      // Corroborate failure against _prisma_migrations (fail-closed if unreadable or absent)
      let activeRecord = null;
      try {
        const unresolvedRecords = await prisma.$queryRaw`
          SELECT migration_name, logs, started_at, finished_at, rolled_back_at, checksum
          FROM "_prisma_migrations"
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
          ORDER BY started_at ASC
        `;
        if (!unresolvedRecords || unresolvedRecords.length === 0) {
          console.error(
            '\n✗ FATAL: Database failure corroboration failed. No active unapplied record found in _prisma_migrations ' +
            'to corroborate CLI failure output. Halting immediately (fail-closed).'
          );
          await releaseAdvisoryLock(prisma);
          process.exit(1);
        }
        if (unresolvedRecords.length > 1) {
          console.error(
            `\n✗ FATAL: Database failure corroboration failed. Found ${unresolvedRecords.length} unresolved migration attempts ` +
            `in _prisma_migrations (${unresolvedRecords.map(r => r.migration_name).join(', ')}). Halting on state ambiguity.`
          );
          await releaseAdvisoryLock(prisma);
          process.exit(1);
        }
        activeRecord = unresolvedRecords[0];
      } catch (err) {
        console.error('\n✗ FATAL: Failed to query _prisma_migrations for failure corroboration (fail-closed):', err.message);
        await releaseAdvisoryLock(prisma);
        process.exit(1);
      }

      const combinedOutput = `${result.output}\nMigration name: ${activeRecord.migration_name}\n${activeRecord.logs || ''}`;

      const evaluation = evaluateMigrationFailure(combinedOutput, remaining);

      if (!evaluation.canResolve) {
        if (evaluation.reason === 'FORBIDDEN_INFRASTRUCTURE_ERROR') {
          console.error(
            '\n✗ FATAL INFRASTRUCTURE / PERMISSION ERROR DETECTED:\n' +
              `  Pattern: ${evaluation.forbiddenPattern}\n` +
              '  The migration runner will NEVER mark a migration as applied when a permission, ' +
              'authentication, or connection error occurs.\n' +
              '  Halting immediately.'
          );
        } else if (evaluation.reason === 'UNKNOWN_MIGRATION') {
          console.error(
            `\n✗ migrate deploy failed on migration "${evaluation.migrationName}", which is not in the documented ` +
              `resolve chain (${path.relative(process.cwd(), DOC_PATH)}).\n` +
              '  Halting execution.'
          );
        } else if (evaluation.reason === 'UNEXPECTED_ERROR_SIGNATURE' || evaluation.reason === 'UNEXPECTED_ERROR_CODE') {
          console.error(
            `\n✗ Migration "${evaluation.migrationName}" failed with an UNEXPECTED error signature or code.\n` +
              `  Code: ${evaluation.actualCode || 'unknown'}, Expected codes: ${(evaluation.expectedCodes || []).join(', ') || 'N/A'}\n` +
              `  Expected object: ${evaluation.expectedTargetObject || 'N/A'}\n` +
              `  Details: ${evaluation.details || 'N/A'}\n` +
              '  Halting immediately to prevent improper resolution.'
          );
        } else if (evaluation.reason === 'MISSING_ERROR_CODE') {
          console.error(
            `\n✗ Migration "${evaluation.migrationName}" failure report is MISSING a PostgreSQL error code.\n` +
              '  Resolution requires an authentic PostgreSQL error code. Halting immediately.'
          );
        } else if (evaluation.reason === 'ABORTED_TRANSACTION_CODE_ONLY') {
          console.error(
            `\n✗ Migration "${evaluation.migrationName}" reported ONLY 25P02 (transaction aborted).\n` +
              '  Resolution requires the root causal error code rather than the aborted transaction symptom. Halting immediately.'
          );
        } else if (evaluation.reason === 'AMBIGUOUS_MIGRATION_NAMES') {
          console.error(
            `\n✗ Failure report contains ambiguous/conflicting migration names: ${(evaluation.conflictingNames || []).join(', ')}.\n` +
              '  Halting immediately.'
          );
        } else {
          console.error(`\n✗ Migration failure could not be resolved: reason=${evaluation.reason}`);
        }
        await releaseAdvisoryLock(prisma);
        process.exit(1);
      }

      // Cross-check with DB: verify that active failed record in _prisma_migrations matches
      if (activeRecord.migration_name !== evaluation.migrationName) {
        console.error(
          `✗ FATAL: Active unapplied database migration "${activeRecord.migration_name}" ` +
            `does not match evaluated failure "${evaluation.migrationName}". Halting.`
        );
        await releaseAdvisoryLock(prisma);
        process.exit(1);
      }

      const name = evaluation.migrationName;
      remaining.splice(0, evaluation.index + 1);
      resolveMigration(name, targetUrl);
      attempt += 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('Unexpected runner error:', err);
    process.exit(1);
  });
}

module.exports = {
  FORBIDDEN_ERROR_PATTERNS,
  EXPECTED_GAP_SIGNATURES,
  DOCUMENTED_GAPS,
  MANAGED_SCHEMAS,
  resolveMigrationTarget,
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  extractFailureDetails,
  evaluateMigrationFailure,
  verifyDatabasePreconditions,
  buildEffectiveMigrationState,
  validateResumptionState,
  loadKnownResolveChain,
  DOC_PATH,
};
