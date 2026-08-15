// scripts/apply-pending-migrations.cjs
// One-off helper to apply the R6 + R10 migrations directly via SQL.
// Used because the dev DB has a pre-existing broken migration
// (`20260812100000_data_model_evolution`) that prisma migrate deploy
// can't get past. Re-run with `node scripts/apply-pending-migrations.cjs`
// if those two migrations get rolled back.

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const r6 = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'migrations', '20260813100000_trip_schedule_state_machine', 'migration.sql'),
      'utf8',
    );
    const r10 = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'migrations', '20260813110000_bulk_import_idempotency', 'migration.sql'),
      'utf8',
    );
    console.log('--- Applying R6 trip_schedule_state_machine ---');
    await c.query(r6);
    console.log('R6 OK');
    console.log('--- Applying R10 bulk_import_idempotency ---');
    await c.query(r10);
    console.log('R10 OK');
  } catch (err) {
    console.error('Migration apply failed:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
