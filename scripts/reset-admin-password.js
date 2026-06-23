/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * reset-admin-password.js
 * Run from the project root: node scripts/reset-admin-password.js
 *
 * Sets or resets the password for a given admin email.
 * Uses Prisma client (no extra dependencies needed).
 */

const crypto   = require('crypto');
const readline = require('readline');
const path     = require('path');

// ── Load env ─────────────────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });

delete process.env.FLEET360_DB;

if (!process.env.DATABASE_URL) {
  console.error('❌  DATABASE_URL not found in .env / .env.local');
  process.exit(1);
}

// ── Password hashing (matches /api/tenants/provision) ────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// ── Simple prompt (works cross-platform, no hidden input needed) ─────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function safeDatabaseLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ''}${parsed.host}${parsed.pathname}`;
  } catch {
    return '(invalid database url)';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Lazy-load Prisma so env is set first
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.log(`🔗  Connecting to database: ${safeDatabaseLabel(process.env.DATABASE_URL)}`);

    // List existing accounts
    const users = await prisma.$queryRawUnsafe(`
      SELECT u.id, u.email, u."firstName", u."lastName",
             t.name AS tenant, t.domain, r.code AS role,
             CASE WHEN u.password_hash IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_password
      FROM "User" u
      JOIN user_tenants ut ON ut.user_id = u.id
      JOIN tenants t       ON t.id = ut.tenant_id
      JOIN roles r         ON r.id = ut.role_id
      ORDER BY u."createdAt" DESC
      LIMIT 20
    `).catch(err => {
      console.log(`\n⚠️  Could not list tenant accounts (${err.message ?? err}). Continuing with password reset.`);
      return [];
    });

    if (!users || users.length === 0) {
      console.log('\n⚠️  No users with tenant access found.');
      console.log('   Complete onboarding first at /onboarding, then run this script.\n');
    } else {
      console.log('\n📋  Existing accounts:\n');
      users.forEach(u => {
        console.log(`  ${u.email}  |  ${u.tenant} (${u.domain})  |  ${u.role}  |  password: ${u.has_password}`);
      });
    }

    // Get target email
    const email = (await prompt('\nEnter email to set/reset password for: ')).toLowerCase();
    if (!email.includes('@')) { console.error('❌  Invalid email'); process.exit(1); }

    const userRows = await prisma.$queryRawUnsafe(
      `SELECT id, email FROM "User" WHERE lower(email) = lower($1) LIMIT 1`,
      email,
    );
    const userRow = userRows[0] ?? null;

    if (!userRow) {
      console.log(`\n⚠️  No user found with email "${email}".`);
      const doCreate = (await prompt('Create this user as SUPER_ADMIN? (y/N): ')).toLowerCase();
      if (doCreate !== 'y') { console.log('Aborted.'); process.exit(0); }

      // Pick tenant
      const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
      if (tenants.length === 0) { console.error('❌  No tenants found. Run /onboarding first.'); process.exit(1); }

      console.log('\nAvailable tenants:');
      tenants.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.domain})`));
      const idx = parseInt(await prompt('Select tenant number: '), 10) - 1;
      const tenant = tenants[idx];
      if (!tenant) { console.error('❌  Invalid selection'); process.exit(1); }

      const firstName = await prompt('First name: ');
      const lastName  = await prompt('Last name: ');
      const pw        = await prompt('New password (min 8 chars): ');
      if (pw.length < 8) { console.error('❌  Password too short'); process.exit(1); }

      const hash   = hashPassword(pw);
      const userId = crypto.randomUUID();

      // Ensure password_hash column exists
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`);

      // Create user
      await prisma.$executeRawUnsafe(`
        INSERT INTO "User" (id, username, email, "firstName", "lastName", "isActive", "updatedAt", password_hash)
        VALUES ($1, $2, $2, $3, $4, true, NOW(), $5)
      `, userId, email, firstName, lastName, hash);

      // Find or create SUPER_ADMIN role for this tenant
      let role = await prisma.role.findFirst({ where: { code: 'SUPER_ADMIN', tenantId: tenant.id } })
              ?? await prisma.role.findFirst({ where: { code: 'SUPER_ADMIN', tenantId: null } });

      if (!role) {
        role = await prisma.role.create({
          data: { id: crypto.randomUUID(), name: 'Super Administrator', code: 'SUPER_ADMIN', tenantId: tenant.id, isSystem: true },
        });
      }

      // Link user → tenant
      await prisma.userTenant.upsert({
        where:  { userId_tenantId: { userId, tenantId: tenant.id } },
        create: { id: crypto.randomUUID(), userId, tenantId: tenant.id, roleId: role.id, isActive: true },
        update: { isActive: true, roleId: role.id },
      });

      console.log(`\n✅  Created: ${email}  →  ${tenant.name}  (SUPER_ADMIN)`);

    } else {
      // Reset existing user's password
      const pw = await prompt('\nNew password (min 8 chars): ');
      if (pw.length < 8) { console.error('❌  Password too short'); process.exit(1); }
      const hash = hashPassword(pw);

      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`);
      await prisma.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hash, userRow.id);

      console.log(`\n✅  Password updated for ${email}`);
    }

    console.log('\n👉  Log in at: http://localhost:3000/login\n');

  } catch (err) {
    console.error('\n❌  Error:', err.message ?? err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
