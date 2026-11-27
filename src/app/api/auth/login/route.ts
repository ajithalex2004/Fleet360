export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Authenticates a user with email + password, signs an xl-session cookie.
 * Works for any tenant the user belongs to (picks the first active one,
 * or the one matching ?tenantId query param).
 */

import { NextRequest, NextResponse } from 'next/server';
import { residencySessionClaim } from '@/lib/data-residency';
import crypto from 'crypto';
import { isDbConnectionError, prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { matchDriverProfileForUser } from '@/lib/drivers/driver-login-user';
import { signSession } from '@/lib/tenant-session';
import { signJwtForBackend } from '@/lib/auth/jwt';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';
import { getEffectiveRole } from '@/lib/permissions/effective-role';
import { effectivePermissions } from '@/lib/authz/session-permissions';
import { tenantModulesFor } from '@/lib/module-policies';
import { logAudit } from '@/lib/audit';
import { trustedClientIp } from '@/lib/auth/setup-bootstrap';
import {
  consumeLoginAttempt,
  consumeAliasAccountAttempt,
  consumeMfaAttempt,
  checkMfaThrottle,
  releaseLoginIpSlotOnSuccess,
  clearLoginFailures,
} from '@/lib/auth/auth-rate-limit';

// ── Password verification (matches the PBKDF2 format used in /api/tenants/provision) ──

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const GENERIC_INVALID_CREDENTIALS = { error: 'Unauthorized', message: 'Invalid email or password' };

// Pre-computed 100k-iteration PBKDF2 dummy digest used to equalize timing on
// unknown, disabled, or passwordless accounts (anti-enumeration).
const DUMMY_PASSWORD_STORED =
  '00000000000000000000000000000000:' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000';

async function verifySinglePassword(plaintext: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derivedBuf = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(plaintext, salt, 100_000, 64, 'sha512', (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const b = Buffer.from(hash, 'hex');
    if (derivedBuf.length !== b.length) return false;
    return crypto.timingSafeEqual(derivedBuf, b);
  } catch {
    return false;
  }
}

async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const candidates = stored.split('|');
  for (const candidate of candidates) {
    if (await verifySinglePassword(plaintext, candidate.trim())) {
      return true;
    }
  }
  return false;
}

const COOKIE_NAME = 'xl-session';

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: 'Bad Request', message: 'Invalid request body' },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid JSON body' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const email = typeof body.email === 'string' ? body.email : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    const preferredTenantId = typeof body.tenantId === 'string' ? body.tenantId : undefined;
    const mfaCode = typeof body.mfaCode === 'string' ? body.mfaCode : undefined;
    const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode : undefined;

    const ipAddress = trustedClientIp(request);
    const userAgent = request.headers.get('user-agent') || '';
    const normalizedIdent = email ? email.toLowerCase().trim() : '';

    if (!normalizedIdent || !password) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Email and password are required' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Password is too long' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // Atomic increment-before-verify defeats concurrent burst (TOCTOU) attacks.
    const rateCheck = await consumeLoginAttempt(ipAddress, normalizedIdent);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too Many Requests', message: `Too many failed login attempts. Please retry after ${rateCheck.retryAfterSec}s.` },
        { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rateCheck.retryAfterSec) } },
      );
    }

    // 1. Find the user by email, username, employeeId, or driver email prefix
    let user = await prisma.user.findUnique({ where: { email: normalizedIdent } });
    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: normalizedIdent, mode: 'insensitive' } },
            { username: { equals: normalizedIdent, mode: 'insensitive' } },
            { employeeId: { equals: normalizedIdent, mode: 'insensitive' } },
            ...(!normalizedIdent.includes('@')
              ? [{ email: { startsWith: `${normalizedIdent}@`, mode: 'insensitive' as const } }]
              : []),
          ],
        },
      });
    }
    if (!user) {
      await verifySinglePassword(password, DUMMY_PASSWORD_STORED);
      void logAudit({
        entityType: 'User',
        action: 'LOGIN_FAILED',
        details: 'Invalid email or password (user not found)',
        userEmail: normalizedIdent,
        ipAddress,
        userAgent,
      });
      // Same message & status for not found, disabled, passwordless, and wrong password
      return NextResponse.json(GENERIC_INVALID_CREDENTIALS, { status: 401, headers: NO_STORE_HEADERS });
    }

    const canonicalIdent = user.email ? user.email.toLowerCase().trim() : normalizedIdent;
    if (canonicalIdent !== normalizedIdent) {
      const canonicalCheck = await consumeAliasAccountAttempt(ipAddress, canonicalIdent);
      if (!canonicalCheck.allowed) {
        return NextResponse.json(
          { error: 'Too Many Requests', message: `Too many failed login attempts. Please retry after ${canonicalCheck.retryAfterSec}s.` },
          { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(canonicalCheck.retryAfterSec) } },
        );
      }
    }

    if (!user.isActive) {
      await verifySinglePassword(password, DUMMY_PASSWORD_STORED);
      void logAudit({
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        details: 'Account disabled',
        userEmail: user.email,
        ipAddress,
        userAgent,
      });
      return NextResponse.json(GENERIC_INVALID_CREDENTIALS, { status: 401, headers: NO_STORE_HEADERS });
    }

    // 2. Fetch password hash via raw SQL (column added outside Prisma schema).
    // Use the $queryRaw template tag (safer parameterisation) instead of
    // $queryRawUnsafe — works reliably across Prisma 5.10–5.22, where the
    // unsafe variant could fail with 'e.map is not a function' under certain
    // engine versions.
    const rows = await prisma.$queryRaw<{ password_hash: string | null }[]>`
      SELECT password_hash FROM "User" WHERE id = ${user.id}
    `;
    const passwordHash = rows[0]?.password_hash ?? null;

    if (!passwordHash) {
      await verifySinglePassword(password, DUMMY_PASSWORD_STORED);
      void logAudit({
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        details: 'No password set for account',
        userEmail: user.email,
        ipAddress,
        userAgent,
      });
      return NextResponse.json(GENERIC_INVALID_CREDENTIALS, { status: 401, headers: NO_STORE_HEADERS });
    }

    if (!(await verifyPassword(password, passwordHash))) {
      void logAudit({
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        details: 'Incorrect password',
        userEmail: user.email,
        ipAddress,
        userAgent,
      });
      return NextResponse.json(GENERIC_INVALID_CREDENTIALS, { status: 401, headers: NO_STORE_HEADERS });
    }

    // 2.5 MFA gate (after password verification)
    const mfaRows = await prisma.$queryRawUnsafe<{
      mfa_enabled: boolean; mfa_secret: string | null; mfa_recovery_codes: string[] | null;
    }[]>(
      `SELECT mfa_enabled, mfa_secret, mfa_recovery_codes FROM "User" WHERE id = $1`,
      user.id,
    );
    const mfaRow = mfaRows[0];
    if (mfaRow?.mfa_enabled) {
      const code = mfaCode ? mfaCode.trim() : '';
      const rec  = recoveryCode ? recoveryCode.trim() : '';
      if (!code && !rec) {
        // Step-1 MFA challenge prompt: return 429 if already MFA-locked; otherwise
        // release the per-IP slot so legitimate NAT office users don't accumulate ipOnly.
        const mfaThrottle = await checkMfaThrottle(user.id);
        if (!mfaThrottle.allowed) {
          return NextResponse.json(
            {
              error: 'Too Many Requests',
              mfaRequired: true,
              message: `Too many failed verification attempts. Please retry after ${mfaThrottle.retryAfterSec}s.`,
            },
            { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(mfaThrottle.retryAfterSec) } },
          );
        }
        await releaseLoginIpSlotOnSuccess(ipAddress);
        return NextResponse.json(
          { error: 'MFA required', mfaRequired: true, message: 'Enter your authenticator code.' },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }

      // Atomic per-user MFA increment-before-verify across all IPs (defeats parallel bursts).
      const mfaAttempt = await consumeMfaAttempt(user.id);
      if (!mfaAttempt.allowed) {
        return NextResponse.json(
          {
            error: 'Too Many Requests',
            mfaRequired: true,
            message: `Too many failed verification attempts. Please retry after ${mfaAttempt.retryAfterSec}s.`,
          },
          { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(mfaAttempt.retryAfterSec) } },
        );
      }

      let ok = false;
      let consumedHash: string | null = null;
      if (code && mfaRow.mfa_secret && verifyTotp(mfaRow.mfa_secret, code)) {
        ok = true;
      } else if (rec) {
        const stored = Array.isArray(mfaRow.mfa_recovery_codes) ? mfaRow.mfa_recovery_codes : [];
        consumedHash = verifyRecoveryCode(rec, stored);
        if (consumedHash) ok = true;
      }
      if (!ok) {
        void logAudit({
          entityType: 'User',
          entityId: user.id,
          action: 'LOGIN_FAILED',
          details: 'Invalid authenticator or recovery code',
          userEmail: user.email,
          ipAddress,
          userAgent,
        });
        return NextResponse.json(
          { error: 'Unauthorized', mfaRequired: true, message: 'Invalid authenticator or recovery code.' },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }
      // Atomic single-use recovery code consumption: prevents concurrent replay.
      if (consumedHash) {
        const affected = await prisma.$executeRawUnsafe(
          `UPDATE "User"
              SET mfa_recovery_codes = COALESCE(
                    (SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(mfa_recovery_codes) AS elem WHERE elem <> $1),
                    '[]'::jsonb
                  ),
                  "updatedAt" = NOW()
            WHERE id = $2
              AND mfa_recovery_codes IS NOT NULL
              AND mfa_recovery_codes @> jsonb_build_array($1::text)`,
          consumedHash, user.id,
        );
        if (Number(affected) !== 1) {
          void logAudit({
            entityType: 'User',
            entityId: user.id,
            action: 'LOGIN_FAILED',
            details: 'Recovery code replay rejected',
            userEmail: user.email,
            ipAddress,
            userAgent,
          });
          return NextResponse.json(
            { error: 'Unauthorized', mfaRequired: true, message: 'Invalid authenticator or recovery code.' },
            { status: 401, headers: NO_STORE_HEADERS },
          );
        }
      }
    }

    // 3. Find an active UserTenant record for this user.
    //
    // withPlatformAdmin because login is what ESTABLISHES the tenant context —
    // there is none yet to scope by, and user_tenants is RLS-protected. Left
    // unscoped this returns nothing once the app connects as a role that
    // doesn't bypass RLS, and every login fails with "No active tenant
    // access". The security boundary is the password check above and the
    // isActive filter here, not RLS.
    const userTenants = await withPlatformAdmin(prisma, (tx) => tx.userTenant.findMany({
      where: { userId: user.id, isActive: true },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            code: true,
            plan: true,
            isActive: true,
            defaultLanguage: true,
            dataResidency: true,
            modules: { where: { isEnabled: true }, select: { module: true } },
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            code: true,
            permissions: { include: { permission: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }));

    if (userTenants.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'No active tenant access found for this account.' },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    // Prefer the requested tenantId, otherwise take the first active one
    const userTenant = preferredTenantId
      ? (userTenants.find(ut => ut.tenantId === preferredTenantId) ?? userTenants[0])
      : userTenants[0];

    if (!userTenant.tenant.isActive) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'This tenant account is inactive.' },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    // The effective permissions (tenant override, custom role, or the code
    // catalogue for a system role): signed into the session for the
    // authorization policy and returned to the UI, so both see the same set.
    // A failure grants nothing rather than falling back to a guess.
    // The membership's module access then narrows them (access-mask.ts).
    let effectiveRole: Awaited<ReturnType<typeof getEffectiveRole>> = null;
    let permissions: string[] = [];
    try {
      ({ effectiveRole, permissions } = await withPlatformAdmin(prisma, async (tx) => {
        const role = await getEffectiveRole(tx as never, user.id, userTenant.tenantId);
        return { effectiveRole: role, permissions: await effectivePermissions(tx as never, user.id, userTenant.tenantId, role) };
      }));
    } catch (e) {
      console.error('[auth/login] effective-role resolution failed; signing in with no permissions:', e);
    }

    // 4. Sign session cookie (include role + residency + shared sid so middleware can inject
    //    x-user-role / x-data-residency / x-session-id and logout revokes all paired tokens atomically)
    const sessionId = crypto.randomUUID();
    const plan = userTenant.tenant.plan ?? 'TRIAL';
    const residencyClaims = residencySessionClaim(userTenant.tenant.dataResidency);
    const token = await signSession({
      userId:   user.id,
      tenantId: userTenant.tenantId,
      plan,
      role:     userTenant.role.code,
      permissions,
      sid:      sessionId,
      // Residency claim from the tenant record, whatever the plan: middleware
      // refuses tenants whose region this deployment does not serve.
      ...residencyClaims,
    });

    // 4a. Resolve linked Driver profile in this tenant (for Driver App sessions where
    //     User.id and Driver.id may differ when provisioned separately).
    let driverSessionToken: string | null = null;
    let linkedDriverId: string | null = null;
    try {
      // Only a DRIVER-type account, by id, exact email or employee id
      // (src/lib/drivers/driver-login-user.ts). Matching by name or username
      // gave a staff user who shared a driver's name a session as that driver.
      const matchedDriverId = await withPlatformAdmin(prisma, (tx) =>
        matchDriverProfileForUser(tx, userTenant.tenantId, user),
      );
      if (matchedDriverId) {
        linkedDriverId = matchedDriverId;
        driverSessionToken = await signSession({
          userId: linkedDriverId,
          tenantId: userTenant.tenantId,
          plan: 'DRIVER',
          role: 'DRIVER',
          permissions: [],
          sid: sessionId,
          ttlMs: 24 * 60 * 60 * 1000,
          ...residencyClaims,
        });
      }
    } catch {
      // Non-fatal if driver lookup fails
    }

    // 4b. Sign a JWT for the Go backend (Authorization: Bearer <token>).
    // Paired via the same `sid` (`jti`) as `xl-session` so single-device logout
    // durably invalidates both Next.js and Go tokens simultaneously.
    let backendToken: string | null = null;
    try {
      backendToken = await signJwtForBackend({
        userId:   user.id,
        tenantId: userTenant.tenantId,
        role:     userTenant.role.code,
        // Go enforces the same permissions (backend/authz).
        permissions,
        plan,
        sid:      sessionId,
      });
    } catch (err) {
      console.warn('[auth/login] backend JWT sign failed (Go-backend features unavailable):', err);
    }

    // 5. Build response
    const responseBody = {
      ok: true,
      user: {
        id:        user.id,
        driverId:  linkedDriverId,
        username:  user.username,
        email:     user.email,
        firstName: user.firstName,
        lastName:  user.lastName,
        roleCode:  effectiveRole?.code        ?? userTenant.role.code,
        roleName:  effectiveRole?.name        ?? userTenant.role.name,
        // Surfaced so the client can show "you have a custom override for
        // this tenant" without re-fetching. null when the effective role
        // is the same as the assigned role.
        effectiveRoleId:    effectiveRole?.id ?? null,
        isTenantOverride:   effectiveRole?.isOverride ?? false,
        originalRoleCode:   userTenant.role.code,
      },
      tenant: {
        id:   userTenant.tenant.id,
        name: userTenant.tenant.name,
        code: userTenant.tenant.code,
        plan,
        defaultLanguage: userTenant.tenant.defaultLanguage ?? 'en',
        // Module policies (default / per tenant / tier) applied to the stored switches.
        enabledModules: await tenantModulesFor(
          userTenant.tenant.modules.filter(m => (m as { isEnabled?: boolean | null }).isEnabled !== false).map(m => m.module),
          plan,
        ),
      },
      permissions: [...new Set(permissions)],
      // Return all tenants so the client can show a tenant-switcher if needed
      availableTenants: userTenants.map(ut => ({
        id:   ut.tenant.id,
        name: ut.tenant.name,
        code: ut.tenant.code,
      })),
      // Bearer JWT for the Go backend. Browser stashes this in
      // localStorage and attaches as `Authorization: Bearer <token>` on
      // calls to http://<go-host>:8080/api/v1/*. Null when JWT_SECRET is
      // unconfigured — clients should handle the absence by skipping
      // Go-backend calls gracefully.
      backendToken,
      sessionToken: token,
      driverSessionToken,
    };

    // Log successful sign in & update last_login_at
    void logAudit({
      tenantId: userTenant.tenantId,
      tenantName: userTenant.tenant.name,
      entityType: 'User',
      entityId: user.id,
      userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
      userEmail: user.email,
      userRole: userTenant.role.code,
      action: 'LOGIN',
      details: 'Successful sign-in',
      ipAddress,
      userAgent,
      loginTime: new Date(),
    });
    void prisma.$executeRaw`UPDATE "User" SET last_login_at = NOW() WHERE id = ${user.id}`.catch(() => {});

    const response = NextResponse.json(responseBody, { status: 200, headers: NO_STORE_HEADERS });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   86_400, // 24 hours
      path:     '/',
    });
    // Set xl-driver-session when a linked Driver profile exists in this tenant,
    // or clear any stale driver session cookie from a previous login.
    if (driverSessionToken) {
      response.cookies.set('xl-driver-session', driverSessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure:   process.env.NODE_ENV === 'production',
        maxAge:   86_400,
        path:     '/',
      });
    } else {
      response.cookies.set('xl-driver-session', '', {
        httpOnly: true,
        sameSite: 'lax',
        secure:   process.env.NODE_ENV === 'production',
        maxAge:   0,
        path:     '/',
      });
    }
    response.cookies.set('xl-driver-vehicle-id', '', {
      httpOnly: false,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   0,
      path:     '/',
    });

    await clearLoginFailures(ipAddress, normalizedIdent, user.id);
    if (canonicalIdent !== normalizedIdent) {
      await clearLoginFailures(ipAddress, canonicalIdent, user.id);
    }
    await releaseLoginIpSlotOnSuccess(ipAddress);
    return response;
  } catch (err) {
    console.error('[auth/login]', err);
    if (isDbConnectionError(err)) {
      return NextResponse.json(
        {
          error: 'Service Unavailable',
          message: 'Database connection unavailable. Please check Neon/network connectivity and try again.',
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Login failed. Please try again.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
