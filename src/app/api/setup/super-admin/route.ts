export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/setup/super-admin
 *
 * One-time, fail-closed initial platform Super Admin bootstrap endpoint.
 *
 * Security invariants (M1-P0-2):
 *  1. Unauthenticated callers can NEVER enumerate whether a Super Admin exists:
 *     GET requires a verified SUPER_ADMIN session (403 otherwise).
 *  2. All GET and POST attempts are protected by BOTH a per-IP (rightmost
 *     trusted proxy hop) AND a global IP-independent rate limit (15 / 15m).
 *     Throttled 429 hits log to stderr without hitting PostgreSQL (prevents
 *     audit_logs DB flooding).
 *  3. Production bootstrap fails closed unless:
 *       - SETUP_BOOTSTRAP_ENABLED === 'true'
 *       - SETUP_SECRET is configured and at least 32 characters long
 *       - SETUP_BOOTSTRAP_EXPIRES_AT (if set) is valid, in the future, and
 *         at most 24 hours from now in production.
 *  4. Single-use & permanently disabled post-bootstrap: once ANY SUPER_ADMIN
 *     role assignment exists (active or deactivated, verified under
 *     withPlatformAdmin + fail-closed pg_advisory_xact_lock), bootstrap replay
 *     is permanently rejected with 410 Gone — even with a valid SETUP_SECRET.
 *     Deactivating a Super Admin can never re-arm bootstrap.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, type TxClient } from '@/lib/rls';
import { secretsEqual } from '@/lib/secure-compare';
import { validatePassword, validatePasswordPolicy, DEFAULT_PASSWORD_POLICY } from '@/lib/password-policy';
import { getVerifiedRequestSession } from '@/lib/tenant-session';
import {
  BOOTSTRAP_ADVISORY_LOCK_KEY,
  getSetupRateLimiters,
  trustedClientIp,
  validateBootstrapConfig,
} from '@/lib/auth/setup-bootstrap';
import { logAudit } from '@/lib/audit';

const PLATFORM_TENANT_DOMAIN = 'xl-ai-platform.internal';
const PLATFORM_TENANT_NAME   = 'Fleet360 — Platform';
const MAX_SECRET_INPUT_LENGTH = 512;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function checkSetupRateLimits(
  req: NextRequest,
  method: 'get' | 'post',
): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number; scope: 'per_ip' | 'global' }> {
  const ip = trustedClientIp(req);
  const { perIp, global: globalLimiter } = getSetupRateLimiters();

  const ipRes = await perIp.check(`setup:super-admin:${method}:${ip}`);
  if (!ipRes.allowed) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((ipRes.resetMs - Date.now()) / 1000)),
      scope: 'per_ip',
    };
  }
  const globalRes = await globalLimiter.check(`setup:super-admin:global:${method}`);
  if (!globalRes.allowed) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((globalRes.resetMs - Date.now()) / 1000)),
      scope: 'global',
    };
  }
  return { allowed: true };
}

async function auditSetupAttempt(
  req: NextRequest,
  action: 'DENIED' | 'CREATE' | 'VIEW',
  details: string,
  actor?: { userId?: string; userRole?: string; userEmail?: string; tenantId?: string; entityId?: string },
): Promise<void> {
  try {
    await logAudit({
      tenantId: actor?.tenantId,
      userId: actor?.userId,
      userRole: actor?.userRole ?? 'ANONYMOUS',
      userEmail: actor?.userEmail,
      entityType: 'SuperAdminSetup',
      entityId: actor?.entityId,
      action,
      details,
      ipAddress: trustedClientIp(req),
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
  } catch (err) {
    console.error('[setup/super-admin] failed to write audit log:', err);
  }
}

/**
 * Count ANY SUPER_ADMIN assignment ever created (active or deactivated) so
 * deactivating the sole Super Admin can NEVER re-arm public bootstrap.
 */
async function countHistoricalSuperAdmins(tx: TxClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(ut.id)::text AS count
     FROM user_tenants ut
     JOIN roles r ON r.id = ut.role_id
     WHERE r.code = 'SUPER_ADMIN'`,
  );
  return parseInt(rows[0]?.count ?? '0', 10) || 0;
}

// ── GET — platform-admin-only bootstrap status check (never public) ──────────

export async function GET(req: NextRequest) {
  const rate = await checkSetupRateLimits(req, 'get');
  if (!rate.allowed) {
    // Log to stderr without hitting PostgreSQL so throttled floods cannot saturate DB/audit_logs.
    console.warn(`[setup/super-admin GET] rate limit exceeded (${rate.scope}) ip=${trustedClientIp(req)}`);
    return NextResponse.json(
      { error: 'Too Many Requests' },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  const session = await getVerifiedRequestSession(req);
  if (!session || session.role !== 'SUPER_ADMIN') {
    await auditSetupAttempt(
      req,
      'DENIED',
      'Unauthenticated or non-SUPER_ADMIN GET /api/setup/super-admin refused',
      session ? { userId: session.userId, userRole: session.role, tenantId: session.tenantId } : undefined,
    );
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  try {
    const count = await withPlatformAdmin(prisma, (tx) => countHistoricalSuperAdmins(tx));
    await auditSetupAttempt(
      req,
      'VIEW',
      `SUPER_ADMIN inspected bootstrap status (bootstrapComplete=${count > 0})`,
      { userId: session.userId, userRole: session.role, tenantId: session.tenantId },
    );
    return NextResponse.json(
      {
        bootstrapComplete: count > 0,
        setupEndpointDisabled: count > 0,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('[setup/super-admin GET]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// ── POST — one-time initial Super Admin creation (permanently disabled once created) ─

export async function POST(request: NextRequest) {
  const rate = await checkSetupRateLimits(request, 'post');
  if (!rate.allowed) {
    // Log to stderr without hitting PostgreSQL so throttled floods cannot saturate DB/audit_logs.
    console.warn(`[setup/super-admin POST] rate limit exceeded (${rate.scope}) ip=${trustedClientIp(request)}`);
    return NextResponse.json(
      { error: 'Too Many Requests' },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterSec) } },
    );
  }

  const configCheck = validateBootstrapConfig();
  if (!configCheck.ok) {
    await auditSetupAttempt(request, 'DENIED', `Bootstrap refused (fail-closed): ${configCheck.reason}`);
    return NextResponse.json(
      { error: 'Platform setup bootstrap is disabled.' },
      { status: configCheck.status, headers: NO_STORE_HEADERS },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    await auditSetupAttempt(request, 'DENIED', 'Malformed JSON body supplied to POST /api/setup/super-admin');
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    await auditSetupAttempt(request, 'DENIED', 'Non-object JSON payload supplied to POST /api/setup/super-admin');
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const record = parsedBody as Record<string, unknown>;
  const secret = typeof record.secret === 'string' && record.secret.length <= MAX_SECRET_INPUT_LENGTH
    ? record.secret
    : null;

  if (!secretsEqual(secret, configCheck.secret)) {
    await auditSetupAttempt(request, 'DENIED', 'Invalid bootstrap secret supplied to POST /api/setup/super-admin');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  const firstName = typeof record.firstName === 'string' && record.firstName.trim()
    ? record.firstName.trim().slice(0, 100)
    : 'Platform';
  const lastName = typeof record.lastName === 'string' && record.lastName.trim()
    ? record.lastName.trim().slice(0, 100)
    : 'Admin';

  if (!email || !password) {
    await auditSetupAttempt(request, 'DENIED', 'Missing email or password on POST /api/setup/super-admin');
    return NextResponse.json(
      { error: 'email and password are required.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const pwPolicy = validatePasswordPolicy(password);
  if (!pwPolicy.ok) {
    await auditSetupAttempt(request, 'DENIED', 'Bootstrap password failed policy check', { userEmail: email });
    return NextResponse.json(
      { error: 'Password must meet policy: ' + pwPolicy.error },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const fullPwCheck = validatePassword(password, { email }, DEFAULT_PASSWORD_POLICY);
  if (!fullPwCheck.ok) {
    await auditSetupAttempt(request, 'DENIED', 'Bootstrap password failed complexity check', { userEmail: email });
    return NextResponse.json(
      { error: 'Password must meet policy', errors: fullPwCheck.errors },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const outcome = await withPlatformAdmin(prisma, async (tx) => {
      // Serialize concurrent bootstrap attempts fail-closed (no swallowed lock errors).
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock($1::bigint)`,
        BOOTSTRAP_ADVISORY_LOCK_KEY,
      );

      const existingSuperAdmins = await countHistoricalSuperAdmins(tx);
      if (existingSuperAdmins > 0) {
        return { kind: 'already_bootstrapped' as const };
      }

      // 1. Ensure platform tenant exists
      let tenant = await tx.tenant.findFirst({ where: { domain: PLATFORM_TENANT_DOMAIN } });
      if (!tenant) {
        tenant = await tx.tenant.create({
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

      // 2. Ensure global SUPER_ADMIN role exists (tenantId MUST be null)
      let role = await tx.role.findFirst({
        where: { code: 'SUPER_ADMIN', tenantId: null },
      });
      if (!role) {
        role = await tx.role.create({
          data: {
            id:          crypto.randomUUID(),
            name:        'Super Admin',
            code:        'SUPER_ADMIN',
            tenantId:    null,
            isSystem:    true,
            description: 'Full platform-wide administrative access',
          },
        });
      }

      // 3. Refuse overwriting an existing user account during initial bootstrap
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        return { kind: 'user_exists' as const };
      }

      const userId = crypto.randomUUID();
      const user = await tx.user.create({
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

      // 4. Persist password hash atomically inside the same transaction
      const passwordHash = hashPassword(password);
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
        passwordHash,
        user.id,
      );

      // 5. Assign SUPER_ADMIN role on the platform tenant
      await tx.userTenant.create({
        data: {
          id:       crypto.randomUUID(),
          userId:   user.id,
          tenantId: tenant.id,
          roleId:   role.id,
          isActive: true,
        },
      });

      return { kind: 'created' as const, tenantId: tenant.id, userId: user.id };
    });

    if (outcome.kind === 'already_bootstrapped') {
      await auditSetupAttempt(
        request,
        'DENIED',
        'Bootstrap replay rejected: a SUPER_ADMIN has already been bootstrapped',
        { userEmail: email },
      );
      return NextResponse.json(
        { error: 'Initial platform setup is already complete and permanently disabled.' },
        { status: 410, headers: NO_STORE_HEADERS },
      );
    }

    if (outcome.kind === 'user_exists') {
      await auditSetupAttempt(
        request,
        'DENIED',
        'Bootstrap refused: target email already exists and cannot be overwritten',
        { userEmail: email },
      );
      return NextResponse.json(
        { error: 'Bootstrap cannot overwrite an existing account.' },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    await auditSetupAttempt(
      request,
      'CREATE',
      `Initial platform SUPER_ADMIN bootstrapped (${email}). Unset SETUP_SECRET and SETUP_BOOTSTRAP_ENABLED immediately.`,
      { tenantId: outcome.tenantId, userId: outcome.userId, userRole: 'SUPER_ADMIN', userEmail: email, entityId: outcome.userId },
    );

    return NextResponse.json(
      {
        ok:       true,
        message:  'Initial Super Admin account created. Bootstrap is now permanently disabled; unset SETUP_SECRET and SETUP_BOOTSTRAP_ENABLED.',
        tenantId: outcome.tenantId,
        userId:   outcome.userId,
        email,
        role:     'SUPER_ADMIN',
        loginAt:  '/login',
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error('[setup/super-admin POST]', err);
    await auditSetupAttempt(request, 'DENIED', 'Bootstrap attempt failed with internal error', { userEmail: email });
    return NextResponse.json(
      { error: 'Super Admin bootstrap failed.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
