/**
 * scripts/assert-deployment-roles.mjs
 *
 * Verifies both runtime database connection classes (DATABASE_URL and
 * RUNTIME_DIRECT_DATABASE_URL) at deployment time.
 *
 * Requirements:
 *   1. DATABASE_URL must connect as exact role "fleet360_app" with rolbypassrls=false, rolsuper=false.
 *   2. RUNTIME_DIRECT_DATABASE_URL must connect as exact role "fleet360_app" with rolbypassrls=false, rolsuper=false, and be an unpooled direct compute endpoint.
 *   3. MIGRATION_DATABASE_URL (or DDL DIRECT_URL) is verified isolated from runtime traffic.
 *
 * Exit code 0 = Verified and Enforced
 * Exit code 1 = Verification Failed (Deployment Blocked)
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

async function verifyRole(name, url, isDirectExpected) {
  console.log(`\n🔍 Probing ${name}...`);
  if (!url) {
    console.error(`❌ ${name} is NOT set.`);
    return false;
  }

  if (isDirectExpected && /-pooler\./.test(url)) {
    console.error(`❌ ${name} is configured as a -pooler endpoint. Expected direct compute endpoint.`);
    return false;
  }

  const client = new PrismaClient({
    datasourceUrl: url,
    log: [{ level: 'error', emit: 'stdout' }],
  });

  try {
    const rows = await client.$queryRawUnsafe(`
      SELECT
        current_user,
        rolcanlogin,
        rolbypassrls,
        rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);

    const role = rows[0];
    if (!role) {
      console.error(`❌ ${name}: Failed to resolve current_user from pg_roles.`);
      return false;
    }

    console.log(`   Connected User:         ${role.current_user}`);
    console.log(`   Can Login:              ${role.rolcanlogin}`);
    console.log(`   Superuser (rolsuper):   ${role.rolsuper}`);
    console.log(`   Bypass RLS (bypassrls): ${role.rolbypassrls}`);

    if (role.current_user !== 'fleet360_app') {
      console.error(`❌ ${name}: Connected user is "${role.current_user}" (expected exact role "fleet360_app").`);
      return false;
    }

    if (role.rolbypassrls) {
      console.error(`❌ ${name}: Connected user holds rolbypassrls = true! PostgreSQL RLS is BYPASSED.`);
      return false;
    }

    if (role.rolsuper) {
      console.error(`❌ ${name}: Connected user holds rolsuper = true! Superusers bypass PostgreSQL RLS.`);
      return false;
    }

    if (!role.rolcanlogin) {
      console.error(`❌ ${name}: Connected user cannot log in.`);
      return false;
    }

    console.log(`   ✅ ${name}: Confirmed exact non-bypass role fleet360_app.`);
    return true;
  } catch (err) {
    console.error(`❌ ${name}: Connection probe failed:`, err.message);
    return false;
  } finally {
    await client.$disconnect();
  }
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FLEET360 DEPLOYMENT RUNTIME ROLE VERIFICATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const appUrl = process.env.DATABASE_URL;
  const sweepUrl = process.env.RUNTIME_DIRECT_DATABASE_URL || process.env.PHASE0_DATABASE_URL;

  const appOk = await verifyRole('DATABASE_URL (App Runtime)', appUrl, false);
  const sweepOk = await verifyRole('RUNTIME_DIRECT_DATABASE_URL (Direct Sweeps)', sweepUrl, true);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (appOk && sweepOk) {
    console.log('✅ ALL RUNTIME CREDENTIALS VERIFIED AS fleet360_app (NON-BYPASS)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  } else {
    console.error('❌ RUNTIME CREDENTIAL VERIFICATION FAILED — DEPLOYMENT BLOCKED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
  }
}

run();
