const { spawnSync } = require('child_process');
require('dotenv').config();

const phase0Url = process.env.PHASE0_DATABASE_URL;
if (!phase0Url) {
  console.error('❌ PHASE0_DATABASE_URL is not set in .env');
  process.exit(1);
}

console.log('🚀 Running Complete Phase 1 Behavioral Isolation Suite as fleet360_app...\n');

const testFiles = [
  'tests/unit/tenant-bootstrap-handler.test.ts',
  'tests/unit/trip-incident-schema.test.ts',
  'tests/integration/pool-context-isolation.test.ts',
  'tests/integration/tenant-isolation-rls.test.ts',
];

const res = spawnSync('npx', ['vitest', 'run', '--no-file-parallelism', ...testFiles], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: phase0Url,
    DB_CONNECT_TIMEOUT_MS: '30000',
    DB_CONNECT_RETRIES: '6',
    DB_OPERATION_RETRIES: '3',
    DB_CONNECT_RETRY_BASE_DELAY_MS: '1500',
  },
  shell: true,
});

process.exit(res.status ?? 0);
