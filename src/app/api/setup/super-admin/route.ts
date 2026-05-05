/**
 * POST /api/setup/super-admin
 *
 * One-time endpoint to create (or reset) the platform Super Admin account.
 * Protected by SETUP_SECRET env variable — will be rejected without it.
 *
 * Body: { secret, email, password, firstName, lastName }
 *
 * What it does:
 *  1. Verifies the secret matches SETUP_SECRET in .env
 *  2. Creates a "XL AI Platform" tenant (or finds existing one) with plan=ENTERPRISE
 *  3. Creates the user (or finds existing by email)
 *  4. Sets password_hash on the user
 *  5. Ensures a SUPER_ADMIN role exists on the platform tenant
 *  6. Assigns the user to that tenant with SUPER_ADMIN role
 *
 * GET /api/setup/super-admin
 *  Returns whether a Super Admin account exists (safe — no credentials exposed).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

const PLATFORM_TENANT_DOMAIN = 'xl-ai-platform.internal';
const PLATFORM_TENANT_NAME   = 'XL AI Smart Mobility — Platform';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// ── GET — check if super admin exists (no credentials exposed) ─────────────────

export async function GET() {
  try {
    type Row = { count: string };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT COUNT(ut.id)::text AS count
       FROM user_tenants ut
       JOIN roles r ON r.id = ut.role_id
       WHERE r.code = 'SUPER_ADMIN' AND ut.is_active = true
       LIMIT 1`
    );
    const count = parseInt(rows[0]?.count ?? '0', 10);
    return NextResponse.json({
      superAdminExists: count > 0,
      message: count > 0
        ? 'A Super Admin account exists. Use the platform login to sign in.'
        : 'No Super Admin found. POST to this endpoint with your SETUP_SECRET to create one.',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── POST — create / reset super admin ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  const setupSecret = process.env.SETUP_SECRET;

  if (!setupSecret) {
    return NextResponse.json(
      { error: 'SETUP_SECRET is not configured in your .env file. Add it first.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const { secret, email, password, firstName = 'Platform', lastName = 'Admin' } = body as Record<string, string>;

  if (!secret || secret !== setupSecret) {
    return NextResponse.json({ error: 'Invalid setup secret.' }, { status: 403 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  try {
    // 1. Ensure platform tenant exists
    let tenant = await prisma.tenant.findFirst({ where: { domain: PLATFORM_TENANT_DOMAIN } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          id:           crypto.randomUUID(),
          name:         PLATFORM_TENANT_NAME,
          domain:       PLATFORM_TENANT_DOMAIN,
          plan:         'ENTERPRISE',
          isActive:     true,
          code:         'XLPLATFORM',
          contactEmail: email,
          contactName:  `${firstName} ${lastName}`,
        },
      });
    }

    // 2. Ensure SUPER_ADMIN role exists on the platform tenant
    let role = await prisma.role.findFirst({
      where: { code: 'SUPER_ADMIN', tenantId: tenant.id },
    });
    if (!role) {
      role = await prisma.role.create({
        data: {
          id:          crypto.randomUUID(),
          name:        'Super Admin',
          code:        'SUPER_ADMIN',
          tenantId:    tenant.id,
          isSystem:    true,
          description: 'Full platform-wide administrative access',
        },
      });
    }

    // 3. Find or create the user
    let user = await prisma.user.findUnique({ where: { email } });
    const userId = user?.id ?? crypto.randomUUID();

    if (!user) {
      user = await prisma.user.create({
        data: {
          id:        userId,
          username:  email,
          email,
          firstName,
          lastName,
          isActive:  true,
          updatedAt: new Date(),
        },
      });
    }

    // 4. Set password hash (tries both table name conventions)
    const passwordHash = hashPassword(password);
    const tableAttempts = [`UPDATE "User"`, `UPDATE users`];
    for (const tbl of tableAttempts) {
      try {
        await prisma.$executeRawUnsafe(
          `${tbl} SET password_hash = $1 WHERE id = $2`,
          passwordHash,
          user.id,
        );
        break;
      } catch { /* try next */ }
    }

    // 5. Upsert user-tenant assignment with SUPER_ADMIN role
    const existingUT = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });

    if (existingUT) {
      await prisma.userTenant.update({
        where: { id: existingUT.id },
        data:  { roleId: role.id, isActive: true },
      });
    } else {
      await prisma.userTenant.create({
        data: {
          id:       crypto.randomUUID(),
          userId:   user.id,
          tenantId: tenant.id,
          roleId:   role.id,
          isActive: true,
        },
      });
    }

    // 6. Ensure password_hash column exists
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    } catch { try { await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`); } catch { /* */ } }

    return NextResponse.json({
      ok:       true,
      message:  'Super Admin account created successfully.',
      tenantId: tenant.id,
      userId:   user.id,
      email,
      role:     'SUPER_ADMIN',
      loginAt:  '/login',
      note:     'Use this email + the password you provided to log in. Delete or disable this endpoint after first use.',
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[setup/super-admin]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
