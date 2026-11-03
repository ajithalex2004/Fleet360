#!/usr/bin/env node
/**
 * Read-only check: was the Driver Hub account takeover used?
 *
 * From 2026-10-27 (f55d2deb) until PR #249, POST /api/drivers and
 * PUT/PATCH /api/drivers/[id] matched an existing login by email, username,
 * employee id or mobile number across all tenants and overwrote its password.
 * Those routes wrote no audit log, but they left traces on the victim's
 * account: userType was set to 'DRIVER', updatedAt moved, and the attacker's
 * tenant got a membership for it.
 *
 * This prints:
 *   1. DRIVER-type accounts holding a non-driver role (admin, staff, ...) —
 *      the strongest sign. A real driver login holds a driver role only.
 *   2. DRIVER-type accounts that are members of more than one tenant.
 *   3. Drivers created or changed since the hole opened whose email belongs to
 *      a user outside that driver's tenant.
 *   4. Logins to accounts with an admin role since the hole opened, to check
 *      against who should have signed in.
 *
 * Read-only: one READ ONLY transaction in the platform context (needed to see
 * every tenant). Prints account emails; run it in your own terminal.
 *
 *   railway run --service fleet360-app --environment production node scripts/security/check-driver-account-takeover.mjs
 */
import { PrismaClient } from '@prisma/client';

const SINCE = process.env.TAKEOVER_SINCE || '2026-10-27';
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL or DATABASE_URL (railway run provides them).');
  process.exit(2);
}

const DRIVER_ROLE = `(UPPER(COALESCE(r.code, '')) = 'DRIVER' OR LOWER(COALESCE(r.name, '')) LIKE '%driver%')`;

const prisma = new PrismaClient({ datasources: { db: { url } } });

const show = (title, rows) => {
  console.log(`\n== ${title}: ${rows.length}`);
  for (const r of rows) console.log('  ' + JSON.stringify(r));
};

try {
  const results = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '*', true)`);

    const driverTypeWithOtherRoles = await tx.$queryRawUnsafe(
      `SELECT u.id, u.email, u.username, u."updatedAt" AS updated_at, u.last_login_at,
              json_agg(json_build_object('tenant', t.name, 'role', COALESCE(r.code, r.name))) AS memberships
         FROM "User" u
         JOIN user_tenants ut ON ut.user_id = u.id
         LEFT JOIN tenants t ON t.id = ut.tenant_id
         LEFT JOIN roles r ON r.id = ut.role_id
        WHERE UPPER(COALESCE(u."userType", '')) = 'DRIVER'
          AND EXISTS (
            SELECT 1 FROM user_tenants ut2 LEFT JOIN roles r ON r.id = ut2.role_id
             WHERE ut2.user_id = u.id AND NOT ${DRIVER_ROLE}
          )
        GROUP BY u.id
        ORDER BY u."updatedAt" DESC`,
    );

    const driverTypeMultiTenant = await tx.$queryRawUnsafe(
      `SELECT u.id, u.email, u.username, u."updatedAt" AS updated_at, COUNT(DISTINCT ut.tenant_id)::int AS tenants,
              json_agg(DISTINCT t.name) AS tenant_names
         FROM "User" u
         JOIN user_tenants ut ON ut.user_id = u.id
         LEFT JOIN tenants t ON t.id = ut.tenant_id
        WHERE UPPER(COALESCE(u."userType", '')) = 'DRIVER'
        GROUP BY u.id
       HAVING COUNT(DISTINCT ut.tenant_id) > 1
        ORDER BY u."updatedAt" DESC`,
    );

    const driversWithOutsideEmail = await tx.$queryRawUnsafe(
      `SELECT d.id AS driver_id, d.name AS driver_name, td.name AS driver_tenant, d.email,
              d.created_at, d.updated_at, u.id AS user_id
         FROM drivers d
         JOIN "User" u ON LOWER(u.email) = LOWER(d.email)
         LEFT JOIN tenants td ON td.id::text = d.tenant_id::text
        WHERE d.email IS NOT NULL
          AND GREATEST(d.created_at, COALESCE(d.updated_at, d.created_at)) >= $1::timestamptz
          AND EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = u.id AND ut.tenant_id::text <> d.tenant_id::text)
        ORDER BY d.updated_at DESC NULLS LAST`,
      SINCE,
    );

    const adminLogins = await tx.$queryRawUnsafe(
      `SELECT u.id, u.email, u.username, u.last_login_at, u."userType" AS user_type,
              json_agg(DISTINCT COALESCE(r.code, r.name)) AS roles
         FROM "User" u
         JOIN user_tenants ut ON ut.user_id = u.id
         LEFT JOIN roles r ON r.id = ut.role_id
        WHERE u.last_login_at >= $1::timestamptz
          AND (UPPER(COALESCE(r.code, '')) LIKE '%ADMIN%' OR LOWER(COALESCE(r.name, '')) LIKE '%admin%')
        GROUP BY u.id
        ORDER BY u.last_login_at DESC`,
      SINCE,
    );

    return { driverTypeWithOtherRoles, driverTypeMultiTenant, driversWithOutsideEmail, adminLogins };
  });

  console.log(`Driver Hub takeover check (read-only), since ${SINCE}`);
  show('1. DRIVER-type accounts that also hold a non-driver role (investigate each)', results.driverTypeWithOtherRoles);
  show('2. DRIVER-type accounts in more than one tenant', results.driverTypeMultiTenant);
  show('3. Drivers changed since then whose email belongs to a user of another tenant', results.driversWithOutsideEmail);
  show('4. Admin-role logins since then (check they were expected)', results.adminLogins);
  console.log(
    '\nIf 1–3 show an account that is not a real driver: reset its password, review its sessions and audit log, ' +
      'and remove any membership it should not have.',
  );
} catch (err) {
  console.error('Check failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
