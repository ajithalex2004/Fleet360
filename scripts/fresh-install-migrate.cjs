#!/usr/bin/env node
// scripts/fresh-install-migrate.cjs
//
// Reliable migration runner for provisioning a NEW environment (a genuinely
// empty database) — staging, DR, or a new client deployment.
//
// Safety & Security Hardening:
// 1. Verifies database connectivity and assertions before running any migration.
// 2. Strict error classification: immediately halts and fails closed if
//    permission-denied, auth failure, connection timeout, or fatal infrastructure
//    errors occur. Never issues `resolve --applied` on permission errors.
// 3. Requires explicit expected-failure signatures (e.g. relation does not exist,
//    type already exists) matching the documented gap before resolving.
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

// Valid PostgreSQL/Prisma error signatures that correspond to historical schema replay gaps
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
  /P3006/i, // Migration failed to apply cleanly to the database
  /P3018/i, // Migration failed to apply
];

function loadKnownResolveChain() {
  if (!fs.existsSync(DOC_PATH)) {
    console.warn(
      `Warning: ${path.relative(process.cwd(), DOC_PATH)} not found — running ` +
        `a plain "migrate deploy" with no known resolve steps.`
    );
    return [];
  }
  const text = fs.readFileSync(DOC_PATH, 'utf8');
  const fenceMatch = text.match(/## Full resolve chain[\s\S]*?```bash([\s\S]*?)```/);
  if (!fenceMatch) {
    console.warn(
      `Warning: could not find the "Full resolve chain" code block in ` +
        `${path.relative(process.cwd(), DOC_PATH)} — running a plain "migrate ` +
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

async function verifyDatabasePreconditions() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('✗ Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  console.log('Verifying database connectivity and preconditions…');
  const prisma = new PrismaClient();
  try {
    const [ident] = await prisma.$queryRaw`SELECT current_user, current_database(), version()`;
    console.log(`✓ Connected to PostgreSQL as user "${ident.current_user}" on database "${ident.current_database}".`);

    // Check if _prisma_migrations exists and has existing records
    try {
      const migrations = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
      `;
      const count = migrations[0]?.count ?? 0;
      console.log(`  Database status: ${count} migration(s) currently recorded in _prisma_migrations.`);
    } catch (tblErr) {
      console.log('  Database status: Fresh empty database (_prisma_migrations table does not exist yet).');
    }
  } catch (err) {
    console.error('✗ Database connectivity / precondition check failed:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  } finally {
    await prisma.$disconnect();
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

    // ── Critical Safety Guard: Halt on Infrastructure / Permission / Auth Errors ──
    for (const forbidden of FORBIDDEN_ERROR_PATTERNS) {
      if (forbidden.test(result.output)) {
        console.error(
          '\n✗ FATAL INFRASTRUCTURE / PERMISSION ERROR DETECTED:\n' +
            `  The database migration stopped on an unresolvable error matching pattern ${forbidden}.\n` +
            '  The migration runner will NEVER mark a migration as applied when a permission denied, ' +
            'authentication, or connection error occurs.\n' +
            '  Halting immediately.'
        );
        process.exit(1);
      }
    }

    // Identify which migration failed
    const idx = remaining.findIndex(name => result.output.includes(name));
    if (idx === -1) {
      console.error(
        '\n✗ migrate deploy failed on a migration that is not in the documented ' +
          `resolve chain (${path.relative(process.cwd(), DOC_PATH)}).\n` +
          '  Read the error above — it names the failing migration and the underlying database error.\n' +
          '  Do not blindly resolve past it. Investigate first, confirm against the schema, write a ' +
          'corrective migration, update the documentation, and then re-run.'
      );
      process.exit(1);
    }

    // ── Guard: Require Expected Error Signature ──
    const hasExpectedSignature = EXPECTED_GAP_SIGNATURES.some(sig => sig.test(result.output));
    if (!hasExpectedSignature) {
      const failingName = remaining[idx];
      console.error(
        `\n✗ Migration "${failingName}" failed with an UNEXPECTED error signature.\n` +
          '  Although this migration is listed in the known resolve chain, the actual database error ' +
          'does not match any expected historical schema replay gap (such as missing relation or existing type).\n' +
          '  Halting immediately to prevent improper resolution.'
      );
      process.exit(1);
    }

    const name = remaining[idx];
    remaining.splice(0, idx + 1); // remove this one and any preceding migrations
    resolveMigration(name);
    attempt += 1;
  }
}

main().catch(err => {
  console.error('Unexpected runner error:', err);
  process.exit(1);
});
