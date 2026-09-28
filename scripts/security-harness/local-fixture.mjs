#!/usr/bin/env node
/**
 * Local rehearsal fixture for the security harness: two tenants, one user
 * per role in each, and a few records, in a LOCAL database. Refuses any
 * database that is not on localhost.
 *
 *   HARNESS_FIXTURE_DATABASE_URL=postgresql://owner@localhost:5432/fleet360 \
 *   HARNESS_FIXTURE_PASSWORD=<a local password> \
 *   node scripts/security-harness/local-fixture.mjs > harness.accounts.json
 *
 * Prints the accounts file for run.mjs; every account's password is read
 * from HARNESS_PASSWORD (set it to the same value when running the harness).
 * For staging, create the tenants and users in the admin console instead.
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const url = process.env.HARNESS_FIXTURE_DATABASE_URL;
const password = process.env.HARNESS_FIXTURE_PASSWORD;
if (!url || !password) {
  console.error('set HARNESS_FIXTURE_DATABASE_URL (owner, local) and HARNESS_FIXTURE_PASSWORD');
  process.exit(2);
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`refusing: ${host} is not a local database`);
  process.exit(2);
}

const TENANTS = {
  A: { id: '11111111-1111-4111-8111-111111111111', name: 'Harness Tenant A', code: 'HARNESS-A' },
  B: { id: '22222222-2222-4222-8222-222222222222', name: 'Harness Tenant B', code: 'HARNESS-B' },
};
const ROLES = {
  A: ['TENANT_ADMIN', 'FLEET_MANAGER', 'VIEWER'],
  B: ['TENANT_ADMIN'],
};
const MODULES = ['fleet', 'maintenance', 'driver-mgmt', 'leasing', 'rental', 'logistics', 'dispatch', 'bus-ops', 'finance', 'reports'];

const hashPassword = (plain) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.pbkdf2Sync(plain, salt, 100_000, 64, 'sha512').toString('hex')}`;
};

const prisma = new PrismaClient({ datasources: { db: { url } } });
const accounts = { tenants: {} };
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', true)`);
    // Columns the app adds at runtime (ensurePasswordHashColumn, ensureMfaColumns, …)
    // are missing from a freshly migrated database; add them as the owner.
    for (const ddl of [
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS module_access JSONB`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_secret TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS pending_mfa_secret TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`,
    ]) await tx.$executeRawUnsafe(ddl);
    for (const [key, t] of Object.entries(TENANTS)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, code, plan, is_active) VALUES ($1, $2, $3, 'PROFESSIONAL', true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true`, t.id, t.name, t.code);
      for (const m of MODULES) {
        await tx.$executeRawUnsafe(
          `INSERT INTO tenant_modules (id, tenant_id, module, is_enabled)
           SELECT gen_random_uuid()::text, $1, $2, true
            WHERE NOT EXISTS (SELECT 1 FROM tenant_modules WHERE tenant_id = $1 AND module = $2)`, t.id, m);
      }
      accounts.tenants[key] = { id: t.id, accounts: [] };
      for (const role of ROLES[key]) {
        const [r] = await tx.$queryRawUnsafe(
          `INSERT INTO roles (id, tenant_id, name, code, is_system) VALUES (gen_random_uuid()::text, NULL, $1, $1, true)
           ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, role)
          .catch(async () => tx.$queryRawUnsafe(`SELECT id FROM roles WHERE tenant_id IS NULL AND code = $1`, role));
        const email = `harness-${key.toLowerCase()}-${role.toLowerCase().replace(/_/g, '-')}@example.test`;
        const userId = `harness-${key.toLowerCase()}-${role.toLowerCase()}`;
        await tx.$executeRawUnsafe(
          `INSERT INTO "User" (id, username, email, "updatedAt", is_active) VALUES ($1, $1, $2, now(), true)
           ON CONFLICT (id) DO NOTHING`, userId, email);
        await tx.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(password), userId);
        await tx.$executeRawUnsafe(
          `INSERT INTO user_tenants (id, user_id, tenant_id, role_id, is_active) VALUES (gen_random_uuid()::text, $1, $2, $3, true)
           ON CONFLICT (user_id, tenant_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true`, userId, t.id, r.id);
        accounts.tenants[key].accounts.push({ role, email, passwordEnv: 'HARNESS_PASSWORD' });
      }
      for (let i = 1; i <= 2; i++) {
        await tx.$executeRawUnsafe(
          `INSERT INTO vehicles (id, tenant_id, make, model, license_plate) VALUES ($1, $2, 'Harness', 'Probe', $3)
           ON CONFLICT (id) DO NOTHING`, `harness-veh-${key.toLowerCase()}-${i}`, t.id, `HARNESS-${key}-${i}`);
      }
    }
  });
  process.stdout.write(`${JSON.stringify(accounts, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
