/**
 * POST /api/auth/login
 * Authenticates a user with email + password, signs an xl-session cookie.
 * Works for any tenant the user belongs to (picks the first active one,
 * or the one matching ?tenantId query param).
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { signSession } from '@/lib/tenant-session';
import { newSessionId, registerSession } from '@/lib/session-registry';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';
import { resolveMfaRequirement } from '@/lib/mfa-policy';
import { getActiveAccountLockout, recordLoginAttempt } from '@/lib/auth-security';
import { customerContextForUser } from '@/lib/corporate-customer-identity';

// ── Password verification (matches the PBKDF2 format used in /api/tenants/provision) ──

function verifyPassword(plaintext: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.pbkdf2Sync(plaintext, salt, 100_000, 64, 'sha512').toString('hex');
    // Constant-time comparison
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(hash,    'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const COOKIE_NAME = 'xl-session';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, tenantId: preferredTenantId, mfaCode, recoveryCode } = body as {
      email?: string;
      password?: string;
      tenantId?: string;
      mfaCode?: string;
      recoveryCode?: string;
    };
    const normalizedEmail = email?.toLowerCase().trim();
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip');
    const userAgent = request.headers.get('user-agent');

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Email and password are required' },
        { status: 400 },
      );
    }
    const activeLockout = await getActiveAccountLockout(normalizedEmail!, preferredTenantId);
    if (activeLockout) {
      return NextResponse.json(
        {
          error: 'Account locked',
          message: 'Too many failed sign-in attempts. Try again later or contact your administrator.',
          lockedUntil: activeLockout,
        },
        { status: 423 },
      );
    }

    // 1. Find the user by email
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail! } });
    if (!user) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: preferredTenantId ?? null,
        success: false,
        failureReason: 'USER_NOT_FOUND',
        ipAddress,
        userAgent,
      });
      // Same message for both "not found" and "wrong password" to prevent user enumeration
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    if (!user.isActive) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: preferredTenantId ?? null,
        userId: user.id,
        success: false,
        failureReason: 'USER_INACTIVE',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'Forbidden', message: 'Your account has been disabled. Contact your administrator.' },
        { status: 403 },
      );
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
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: preferredTenantId ?? null,
        userId: user.id,
        success: false,
        failureReason: 'PASSWORD_NOT_SET',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'Unauthorized', message: 'No password set for this account. Please contact your administrator.' },
        { status: 401 },
      );
    }

    if (!verifyPassword(password, passwordHash)) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: preferredTenantId ?? null,
        userId: user.id,
        success: false,
        failureReason: 'BAD_PASSWORD',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    // 2.5 MFA gate (after password verification)
    const mfaRows = await prisma.$queryRawUnsafe<{
      mfa_enabled: boolean; mfa_secret: string | null; mfa_recovery_codes: string[] | null;
    }[]>(
      `SELECT mfa_enabled, mfa_secret, mfa_recovery_codes FROM "User" WHERE id = $1`,
      user.id,
    ).catch(() => [{ mfa_enabled: false, mfa_secret: null, mfa_recovery_codes: null }]);
    const mfaRow = mfaRows[0];
    if (mfaRow?.mfa_enabled) {
      const code = mfaCode ? String(mfaCode).trim() : '';
      const rec  = recoveryCode ? String(recoveryCode).trim() : '';
      if (!code && !rec) {
        await recordLoginAttempt({
          email: normalizedEmail!,
          tenantId: preferredTenantId ?? null,
          userId: user.id,
          success: false,
          failureReason: 'MFA_REQUIRED',
          ipAddress,
          userAgent,
        });
        return NextResponse.json(
          { error: 'MFA required', mfaRequired: true, message: 'Enter your authenticator code.' },
          { status: 401 },
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
        await recordLoginAttempt({
          email: normalizedEmail!,
          tenantId: preferredTenantId ?? null,
          userId: user.id,
          success: false,
          failureReason: 'BAD_MFA',
          ipAddress,
          userAgent,
        });
        return NextResponse.json(
          { error: 'Unauthorized', mfaRequired: true, message: 'Invalid authenticator or recovery code.' },
          { status: 401 },
        );
      }
      // Recovery code consumed → remove it from the list (single-use).
      if (consumedHash) {
        const remaining = (mfaRow.mfa_recovery_codes ?? []).filter(h => h !== consumedHash);
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET mfa_recovery_codes = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
          JSON.stringify(remaining), user.id,
        );
      }
    }

    // 3. Find an active UserTenant record for this user
    const userTenants = await prisma.userTenant.findMany({
      where: { userId: user.id, isActive: true },
      include: {
        tenant: { select: { id: true, name: true, code: true, plan: true, isActive: true } },
        role:   { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (userTenants.length === 0) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: preferredTenantId ?? null,
        userId: user.id,
        success: false,
        failureReason: 'NO_TENANT_ACCESS',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'Forbidden', message: 'No active tenant access found for this account.' },
        { status: 403 },
      );
    }

    // Prefer the requested tenantId, otherwise take the first active one
    const userTenant = preferredTenantId
      ? (userTenants.find(ut => ut.tenantId === preferredTenantId) ?? userTenants[0])
      : userTenants[0];

    if (!userTenant.tenant.isActive) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: userTenant.tenantId,
        userId: user.id,
        success: false,
        failureReason: 'TENANT_INACTIVE',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        { error: 'Forbidden', message: 'This tenant account is inactive.' },
        { status: 403 },
      );
    }

    const mfaRequirement = await resolveMfaRequirement({
      tenantId: userTenant.tenantId,
      roleCode: userTenant.role.code,
      userCreatedAt: user.createdAt,
    });
    if (mfaRequirement.required && !mfaRow?.mfa_enabled) {
      await recordLoginAttempt({
        email: normalizedEmail!,
        tenantId: userTenant.tenantId,
        userId: user.id,
        success: false,
        failureReason: 'MFA_ENROLLMENT_REQUIRED',
        ipAddress,
        userAgent,
      });
      return NextResponse.json(
        {
          error: 'MFA enrollment required',
          mfaEnrollmentRequired: true,
          message: 'Your administrator requires MFA before signing in. Contact an administrator or complete MFA setup from an active session.',
        },
        { status: 403 },
      );
    }

    // 4. Sign session cookie (include role so middleware can inject x-user-role)
    const plan = userTenant.tenant.plan ?? 'TRIAL';
    const customerContext = await customerContextForUser(userTenant.tenantId, user.id).catch(() => null);
    const sessionId = newSessionId();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const token = await signSession({
      sessionId,
      userId:   user.id,
      tenantId: userTenant.tenantId,
      ...(customerContext ? { customerId: customerContext.customerId, customerRole: customerContext.role } : {}),
      plan,
      role:     userTenant.role.code,
    });
    await registerSession({
      id: sessionId,
      userId: user.id,
      tenantId: userTenant.tenantId,
      plan,
      role: userTenant.role.code,
      expiresAt,
      ipAddress,
      userAgent,
    });
    await recordLoginAttempt({
      email: normalizedEmail!,
      tenantId: userTenant.tenantId,
      userId: user.id,
      success: true,
      ipAddress,
      userAgent,
    });

    // 5. Build response
    const responseBody = {
      ok: true,
      user: {
        id:        user.id,
        email:     user.email,
        firstName: user.firstName,
        lastName:  user.lastName,
        roleCode:  userTenant.role.code,
        roleName:  userTenant.role.name,
      },
      tenant: {
        id:   userTenant.tenant.id,
        name: userTenant.tenant.name,
        code: userTenant.tenant.code,
        plan,
      },
      customer: customerContext,
      // Return all tenants so the client can show a tenant-switcher if needed
      availableTenants: userTenants.map(ut => ({
        id:   ut.tenant.id,
        name: ut.tenant.name,
        code: ut.tenant.code,
      })),
    };

    const response = NextResponse.json(responseBody, { status: 200 });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
      maxAge:   86_400, // 24 hours
      path:     '/',
    });

    return response;
  } catch (err) {
    console.error('[auth/login]', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Login failed. Please try again.' },
      { status: 500 },
    );
  }
}
