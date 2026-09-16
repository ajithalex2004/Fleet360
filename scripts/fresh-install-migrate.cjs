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

  return {
    canResolve: true,
    reason: 'MATCHED_EXPECTED_GAP',
    migrationName: matchingMigration,
    index: idx,
    matchedSignature: expectedSig.matchedPattern,
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

  const freshOverride =
    options.freshOverride ??
    (process.argv.includes('--fresh-override') ||
      process.env.FORCE_FRESH_MIGRATION === '1');

  console.log('Verifying database connectivity and preconditions…');
  const prisma = options.prismaClient || new PrismaClient();
  try {
    const [ident] = await prisma.$queryRaw`SELECT current_user, current_database(), version()`;
    console.log(`✓ Connected to PostgreSQL as user "${ident.current_user}" on database "${ident.current_database}".`);

    // Check if _prisma_migrations exists and has existing records
    let migrationCount = 0;
    try {
      const migrations = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;
      migrationCount = migrations[0]?.count ?? 0;
      console.log(`  Database status: ${migrationCount} migration(s) currently recorded in _prisma_migrations.`);
    } catch {
      console.log('  Database status: Fresh empty database (_prisma_migrations table does not exist yet).');
    }

    if (migrationCount > 0 && !freshOverride) {
      const msg =
        `✗ Error: Database is not fresh. Found ${migrationCount} applied migration(s) in _prisma_migrations.\n` +
        '  fresh-install-migrate is intended ONLY for fresh database installations.\n' +
        '  Pass --fresh-override or set FORCE_FRESH_MIGRATION=1 if you explicitly intend to run against a non-fresh database.';
      console.error(msg);
      if (options.throwOnError) {
        throw new Error(`Database is not fresh (${migrationCount} migrations found) without override.`);
      }
      process.exit(1);
    }

    return { currentUser: ident.current_user, database: ident.current_database, migrationCount };
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
  shouldHaltOnForbiddenError,
  hasExpectedGapSignature,
  evaluateMigrationFailure,
  verifyDatabasePreconditions,
  loadKnownResolveChain,
  DOC_PATH,
};
