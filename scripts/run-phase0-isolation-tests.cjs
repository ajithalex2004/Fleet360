const { spawnSync } = require('child_process');
require('dotenv').config();

const phase0Url = process.env.PHASE0_DATABASE_URL;
if (!phase0Url) {
  console.error('❌ PHASE0_DATABASE_URL is not set in .env');
  process.exit(1);
}

// The suite creates and deletes tenants: never against production. Point
// PHASE0_DATABASE_URL at a dedicated test database (e.g. a Neon branch).
const { hosts: protectedHosts } = require('../tests/protected-database-hosts.json');
let phase0Host = '';
try { phase0Host = new URL(phase0Url).hostname; } catch { /* reported below */ }
if (!phase0Host || protectedHosts.some((h) => phase0Host.includes(h))) {
  console.error(`❌ PHASE0_DATABASE_URL points at ${phase0Host || 'an unparseable URL'}, the production database.`);
  console.error('   The isolation suite writes test tenants; point PHASE0_DATABASE_URL at a dedicated test database (e.g. a Neon branch).');
  process.exit(1);
}

console.log('🚀 Running Complete Phase 1 Behavioral Isolation Suite as fleet360_app...\n');

const testFiles = [
  'tests/unit/prisma-sweep.test.ts',
  'tests/unit/tenant-bootstrap-handler.test.ts',
  'tests/unit/trip-incident-schema.test.ts',
  'tests/integration/pool-context-isolation.test.ts',
  'tests/integration/tenant-isolation-rls.test.ts',
  'tests/integration/activation-matrix.test.ts',
  'tests/integration/staging-lifecycle-matrix.test.ts',
];

const res = spawnSync('npx', ['vitest', 'run', '--no-file-parallelism', ...testFiles], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // tests/db-guard.ts uses TEST_DATABASE_URL and keeps a remote one only on opt-in.
    TEST_DATABASE_URL: phase0Url,
    ALLOW_REMOTE_TEST_DATABASE: '1',
    DATABASE_URL: phase0Url,
    RUNTIME_DIRECT_DATABASE_URL: phase0Url,
    DB_CONNECT_TIMEOUT_MS: '30000',
    DB_CONNECT_RETRIES: '6',
    DB_OPERATION_RETRIES: '3',
    DB_CONNECT_RETRY_BASE_DELAY_MS: '1500',
  },
  shell: true,
});

process.exit(res.status ?? 0);
