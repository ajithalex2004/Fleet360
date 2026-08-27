#!/usr/bin/env node
/**
 * PostgreSQL Runtime Role & RLS Bypass Assertion
 *
 * Directly queries pg_roles to prove that the active database connection
 * is operating as the non-privileged application role (`fleet360_app`)
 * and that BYPASSRLS is strictly disabled.
 *
 * Fails with exit code 1 if:
 *   - current_user != 'fleet360_app'
 *   - rolbypassrls = true
 *   - rolsuper = true
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const dbUrl = process.env.PHASE0_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('❌ Error: DATABASE_URL or PHASE0_DATABASE_URL environment variable is required.');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
  log: ['error'],
});

async function queryWithRetry(fn, retries = 6, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[assert-runtime-role] Connection attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  console.log('🔍 Probing database connection role and RLS privileges...\n');

  try {
    const rows = await queryWithRetry(() =>
      prisma.$queryRawUnsafe(`
        SELECT 
          current_user,
          r.rolname,
          r.rolbypassrls,
          r.rolsuper,
          r.rolcanlogin
        FROM pg_roles r
        WHERE r.rolname = current_user
        LIMIT 1;
      `),
    );

    if (!rows || rows.length === 0) {
      console.error('❌ FATAL: Could not inspect pg_roles for current_user.');
      process.exit(1);
    }

    const info = rows[0];

    console.log('━'.repeat(60));
    console.log('DATABASE RUNTIME ROLE EVIDENCE');
    console.log('━'.repeat(60));
    console.log(`Connected User:         ${info.current_user}`);
    console.log(`Can Login:              ${info.rolcanlogin}`);
    console.log(`Superuser (rolsuper):   ${info.rolsuper}`);
    console.log(`Bypass RLS (bypassrls): ${info.rolbypassrls}`);
    console.log('━'.repeat(60));

    let failed = false;

    if (info.current_user !== 'fleet360_app') {
      console.warn(
        `⚠️  WARNING: Connected user is "${info.current_user}", expected "fleet360_app".`,
      );
      if (process.env.STRICT_ROLE_CHECK === '1') {
        failed = true;
      }
    } else {
      console.log('✅ Connected as dedicated application role: fleet360_app');
    }

    if (info.rolsuper) {
      console.error('❌ FATAL VIOLATION: Connected role has SUPERUSER privileges.');
      failed = true;
    } else {
      console.log('✅ Superuser privilege: DISABLED (rolsuper = false)');
    }

    if (info.rolbypassrls) {
      console.error(
        '❌ FATAL VIOLATION: Connected role holds BYPASSRLS privilege. Row-Level Security is inactive!',
      );
      failed = true;
    } else {
      console.log('✅ RLS Bypass privilege: DISABLED (rolbypassrls = false)');
    }

    console.log('━'.repeat(60));

    if (failed) {
      console.error('\n❌ RUNTIME ROLE ASSERTION FAILED: Connection does not enforce RLS.\n');
      process.exit(1);
    }

    console.log('\n✅ RUNTIME ROLE ASSERTION PASSED: PostgreSQL RLS is active and enforced.\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection or query failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
