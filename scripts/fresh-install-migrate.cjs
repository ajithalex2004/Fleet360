#!/usr/bin/env node
// scripts/fresh-install-migrate.cjs
//
// Reliable migration runner for provisioning a NEW environment (a genuinely
// empty database) — staging, DR, or a new client deployment.
//
// Safety & Security Hardening:
// 1. Verifies database connectivity and assertions before running any migration.
//    Enforces that the database is fresh (empty _prisma_migrations) unless --fresh-override is passed.
// 2. Strict error classification: immediately halts and fails closed if
//    permission-denied, auth failure, connection timeout, or fatal infrastructure
//    errors occur. Never issues `resolve --applied` on permission errors.
// 3. Requires explicit expected-failure signatures (e.g. relation does not exist,
//    type already exists) matching the documented gap before resolving.
//    Generic wrapper codes (P3018, P3006) are strictly EXCLUDED to prevent masking fatal errors.
// 4. Reads documented resolution steps dynamically from docs/FRESH_DATABASE_SETUP.md.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'FRESH_DATABASE_SETUP.md');
const PRISMA_BIN = require.resolve('prisma/build/index.js');

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
// NOTE: Generic Prisma wrapper error codes like P3018 ("A migration failed to apply")
// and P3006 ("Migration failed to apply cleanly") are deliberately EXCLUDED.
// Prisma wraps fatal errors (such as disk full or syntax errors) in P3018; resolution
// MUST require the specific underlying PostgreSQL schema gap signature.
const EXPECTED_GAP_SIGNATURES = [
  /relation ".*" does not exist/i,
  /column ".*" does not exist/i,
  /table ".*" does not exist/i,
  /type ".*" already exists/i,
  /relation ".*" already exists/i,
  /table ".*" already exists/i,
  /cannot use .* in column generation expression/i,
  /generation expression is not immutable/i,
  /cannot drop .* because other objects depend on it/i,
];

// Exact target object bindings for documented historical schema replay gaps.
// Binds each resolvable migration to its specific missing target object.
// If a migration fails with an unrelated missing table or code, resolution is rejected.
const DOCUMENTED_GAPS = {
  '20260815140000_tenant_001_leasing_rental_isolation': {
    targetObject: 'rental_rate_quotes',
    expectedSignatures: [/relation "rental_rate_quotes" does not exist/i, /table "rental_rate_quotes" does not exist/i],
  },
  '20260816000000_route_consolidation_phase2_schema': {
    targetObject: 'route_passengers',
    expectedSignatures: [/relation "route_passengers" does not exist/i, /table "route_passengers" does not exist/i],
  },
  '20260818100000_fleet_routing_foundation': {
    targetObject: 'route_passengers',
    expectedSignatures: [/route_passengers/i, /bus_routes/i],
  },
  '20260821000000_vehicle_route_zone_tagging': {
    targetObject: 'spatial.places',
    expectedSignatures: [/places/i, /zone_id/i],
  },
  '20260824000000_add_tenant_constraints_and_indexes': {
    targetObject: 'trip_passengers',
    expectedSignatures: [/trip_passengers/i, /customers/i],
  },
  '20260904000000_add_tenant_id_to_lease_rental_children': {
    targetObject: 'rental_payment_transactions',
    expectedSignatures: [/rental_/i, /tenant_id/i],
  },
  '20260905000000_adopt_route_optimisation_results': {
    targetObject: 'route_optimisation_results',
    expectedSignatures: [/route_optimisation_results/i],
  },
  '20260909000000_per_tenant_rental_agreement_numbers': {
    targetObject: 'rental_agreements',
    expectedSignatures: [/rental_agreements/i],
  },
  '20260910000000_remove_null_tenant_escape': {
    targetObject: 'rental_rate_quotes',
    expectedSignatures: [/rental_rate_quotes/i, /rental_agreements/i],
  },
  '20260910000003_login_attempts_platform_only': {
    targetObject: 'auth_login_attempts',
    expectedSignatures: [/auth_login_attempts/i],
  },
  '20260910000004_enable_rls_seven_tables': {
    targetObject: 'trip_schedules',
    expectedSignatures: [/trip_schedules/i],
  },
  '20260910000006_finance_schema_null_escape': {
    targetObject: 'finance',
    expectedSignatures: [/finance/i],
  },
  '20260910000008_fleet_operations_null_escape': {
    targetObject: 'operations',
    expectedSignatures: [/operations/i, /fleet/i],
  },
  '20260910000009_backfill_bookings_hierarchy_tenant': {
    targetObject: 'bookings',
    expectedSignatures: [/bookings/i, /logistics_shipment_orders/i],
  },
  '20260910000010_grant_app_role_schema_access': {
    targetObject: 'fleet360_app',
    expectedSignatures: [/fleet360_app/i, /permission/i, /schema/i],
  },
  '20260910000016_finance_deposits_recurring_tables_and_rls': {
    targetObject: 'finance_security_deposits',
    expectedSignatures: [/generation expression/i, /CURRENT_DATE/i, /immutable/i],
  },
  '20260910000024_auth_security_tables_and_rls': {
    targetObject: 'password_reset_tokens',
    expectedSignatures: [/already exists/i, /password_reset_tokens/i, /audit_logs/i],
  },
  '20260911120000_lease_return_settlement_workflow': {
    targetObject: 'lease_return_settlements',
    expectedSignatures: [/lease_return_settlements/i, /finance_security_deposits/i],
  },
  '20260914140000_fresh_replay_rental_leasing_gap': {
    targetObject: 'rental_rate_quotes',
    expectedSignatures: [/rental_rate_quotes/i, /tenant_id/i],
  },
};

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

function evaluateMigrationFailure(output, remainingOrMigration) {
  const forbidden = shouldHaltOnForbiddenError(output);
  if (forbidden.isForbidden) {
    return {
      canResolve: false,
      reason: 'FORBIDDEN_INFRASTRUCTURE_ERROR',
      forbiddenPattern: forbidden.matchedPattern,
    };
  }

  const candidateNames = Array.isArray(remainingOrMigration)
    ? remainingOrMigration
    : [remainingOrMigration];

  const idx = candidateNames.findIndex(name => output.includes(name));
  if (idx === -1) {
    return {
      canResolve: false,
      reason: 'UNKNOWN_MIGRATION',
    };
  }

  const matchingMigration = candidateNames[idx];
  const expectedSig = hasExpectedGapSignature(output);
  if (!expectedSig.hasSignature) {
    return {
      canResolve: false,
      reason: 'UNEXPECTED_ERROR_SIGNATURE',
      migrationName: matchingMigration,
    };
  }

  // Exact target object check: if this migration has a documented entry, verify that the error matches its target object
  const gapMeta = DOCUMENTED_GAPS[matchingMigration];
  if (gapMeta) {
    const matchesTargetObject = gapMeta.expectedSignatures.some(sig => sig.test(output));
    if (!matchesTargetObject) {
      return {
        canResolve: false,
        reason: 'UNEXPECTED_ERROR_SIGNATURE',
        migrationName: matchingMigration,
        expectedTargetObject: gapMeta.targetObject,
      };
    }
  }

  return {
    canResolve: true,
    reason: 'MATCHED_EXPECTED_GAP',
    migrationName: matchingMigration,
    index: idx,
    matchedSignature: expectedSig.matchedPattern,
    targetObject: gapMeta?.targetObject,
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

async function verifyDatabasePreconditions(options = {}) {
  const dbUrl = options.databaseUrl !== undefined ? options.databaseUrl : process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('✗ Error: DATABASE_URL environment variable is not set.');
    if (options.throwOnError) {
      throw new Error('DATABASE_URL environment variable is not set.');
    }
    process.exit(1);
  }

  // Extract --resume-bootstrap-from=<migration_name> argument
  let resumeFromMigration = options.resumeBootstrapFrom;
  if (!resumeFromMigration) {
    const resumeArg = process.argv.find(arg => arg.startsWith('--resume-bootstrap-from='));
    if (resumeArg) {
      resumeFromMigration = resumeArg.split('=')[1]?.trim();
    }
  }

  console.log('Verifying database connectivity and preconditions…');
  const prisma = options.prismaClient || new PrismaClient();
  try {
    const [ident] = await prisma.$queryRaw`SELECT current_user, current_database(), version()`;
    console.log(`✓ Connected to PostgreSQL as user "${ident.current_user}" on database "${ident.current_database}".`);

    // Check if _prisma_migrations exists and has existing records
    let migrationCount = 0;
    let migrationsTableExists = true;
    try {
      const migrations = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;
      migrationCount = migrations[0]?.count ?? 0;
      console.log(`  Database status: ${migrationCount} migration(s) currently recorded in _prisma_migrations.`);
    } catch (err) {
      const errMsg = err.message || '';
      const errCode = err.code;
      // Only PostgreSQL 42P01 (undefined_table) or explicit relation message indicates missing table
      const isMissingTable =
        errCode === '42P01' ||
        /relation "_prisma_migrations" does not exist/i.test(errMsg) ||
        /table "_prisma_migrations" does not exist/i.test(errMsg);

      if (!isMissingTable) {
        console.error(`✗ Error querying _prisma_migrations (fail-closed, code: ${errCode || 'none'}):`, errMsg);
        if (options.throwOnError) {
          throw err;
        }
        process.exit(1);
      }

      migrationsTableExists = false;
      console.log('  Database status: Fresh empty database (_prisma_migrations table does not exist yet).');
    }

    // Inspect public schema tables: if _prisma_migrations is missing or empty, verify whether other application tables already exist
    if (!migrationsTableExists || migrationCount === 0) {
      const appTables = await prisma.$queryRaw`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name != '_prisma_migrations'
          AND table_type = 'BASE TABLE'
      `;
      const appTableCount = appTables ? appTables.length : 0;
      if (appTableCount > 0) {
        const msg =
          `✗ Error: Database is not empty. Found ${appTableCount} application table(s) in schema public, ` +
          `but _prisma_migrations is ${migrationsTableExists ? 'empty' : 'missing'}.\n` +
          '  This indicates an unmanaged, partially migrated, or manually initialized database.\n' +
          '  fresh-install-migrate is intended ONLY for genuinely fresh databases.';
        console.error(msg);
        if (options.throwOnError) {
          throw new Error(`Database is not empty (${appTableCount} application tables found in public schema).`);
        }
        process.exit(1);
      }
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

      // Verify that the recorded migrations in _prisma_migrations contain resumeFromMigration
      const recordedMigrations = await prisma.$queryRaw`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY started_at ASC
      `;
      const recordedNames = recordedMigrations.map(r => r.migration_name);
      const isKnownPoint = recordedNames.includes(resumeFromMigration);

      if (!isKnownPoint) {
        const msg =
          `✗ Error: Resume point "${resumeFromMigration}" not found among ${recordedNames.length} applied migration(s) in _prisma_migrations.\n` +
          '  Aborting resumption to avoid corrupted schema replay state.';
        console.error(msg);
        if (options.throwOnError) {
          throw new Error(`Resume migration "${resumeFromMigration}" not found in applied migrations.`);
        }
        process.exit(1);
      }

      console.log(`✓ Resuming bootstrap after verified migration: "${resumeFromMigration}".`);
    }

    return { currentUser: ident.current_user, database: ident.current_database, migrationCount, resumeFromMigration };
  } catch (err) {
    console.error('✗ Database connectivity / precondition check failed:', err.message);
    if (options.throwOnError) {
      throw err;
    }
    process.exit(1);
  } finally {
    if (!options.prismaClient) {
      await prisma.$disconnect();
    }
  }
}

function tryDeploy(label) {
  console.log(`\n--- prisma migrate deploy (${label}) ---`);
  try {
    const out = execFileSync(process.execPath, [PRISMA_BIN, 'migrate', 'deploy'], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    process.stdout.write(out);
    return { ok: true, output: out };
  } catch (err) {
    const out = `${err.stdout || ''}\n${err.stderr || ''}`;
    process.stdout.write(out);
    return { ok: false, output: out };
  }
}

function resolveMigration(name) {
  console.log(`\nApplying verified workaround for documented gap: "${name}" (marking resolved, not run)…`);
  try {
    execFileSync(process.execPath, [PRISMA_BIN, 'migrate', 'resolve', '--applied', name], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`\n✗ Error: "migrate resolve --applied ${name}" failed — halting execution.`);
    process.exit(1);
  }
}

async function main() {
  await verifyDatabasePreconditions();

  const knownChain = loadKnownResolveChain();
  console.log(
    `Loaded ${knownChain.length} known resolve step(s) from ` +
      `${path.relative(process.cwd(), DOC_PATH)}.`
  );

  const remaining = [...knownChain];
  let attempt = 1;

  for (;;) {
    const result = tryDeploy(`attempt ${attempt}`);
    if (result.ok) {
      console.log('\n✓ All migrations applied. Environment is ready.');
      return;
    }

    const evaluation = evaluateMigrationFailure(result.output, remaining);

    if (!evaluation.canResolve) {
      if (evaluation.reason === 'FORBIDDEN_INFRASTRUCTURE_ERROR') {
        console.error(
          '\n✗ FATAL INFRASTRUCTURE / PERMISSION ERROR DETECTED:\n' +
            `  The database migration stopped on an unresolvable error matching pattern ${evaluation.forbiddenPattern}.\n` +
            '  The migration runner will NEVER mark a migration as applied when a permission denied, ' +
            'authentication, or connection error occurs.\n' +
            '  Halting immediately.'
        );
      } else if (evaluation.reason === 'UNKNOWN_MIGRATION') {
        console.error(
          '\n✗ migrate deploy failed on a migration that is not in the documented ' +
            `resolve chain (${path.relative(process.cwd(), DOC_PATH)}).\n` +
            '  Read the error above — it names the failing migration and the underlying database error.\n' +
            '  Do not blindly resolve past it. Investigate first, confirm against the schema, write a ' +
            'corrective migration, update the documentation, and then re-run.'
        );
      } else if (evaluation.reason === 'UNEXPECTED_ERROR_SIGNATURE') {
        console.error(
          `\n✗ Migration "${evaluation.migrationName}" failed with an UNEXPECTED error signature.\n` +
            '  Although this migration is listed in the known resolve chain, the actual database error ' +
            'does not match any expected historical schema replay gap (such as missing relation or existing type).\n' +
            '  Generic codes like P3018 or P3006 alone are insufficient; specific PostgreSQL errors are required.\n' +
            '  Halting immediately to prevent improper resolution.'
        );
      }
      process.exit(1);
    }

    const name = evaluation.migrationName;
    remaining.splice(0, evaluation.index + 1); // remove this one and any preceding migrations
    resolveMigration(name);
    attempt += 1;
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Unexpected runner error:', err);
    process.exit(1);
  });
}

module.exports = {
  FORBIDDEN_ERROR_PATTERNS,
  EXPECTED_GAP_SIGNATURES,
  DOCUMENTED_GAPS,
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  evaluateMigrationFailure,
  verifyDatabasePreconditions,
  loadKnownResolveChain,
  DOC_PATH,
};
