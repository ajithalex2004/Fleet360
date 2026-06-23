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
import { signJwtForBackend } from '@/lib/auth/jwt';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { verifyTotp, verifyRecoveryCode } from '@/lib/totp';

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

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Email and password are required' },
        { status: 400 },
      );
    }

    // 1. Find the user by email
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      // Same message for both "not found" and "wrong password" to prevent user enumeration
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    if (!user.isActive) {
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
      return NextResponse.json(
        { error: 'Unauthorized', message: 'No password set for this account. Please contact your administrator.' },
        { status: 401 },
      );
    }

    if (!verifyPassword(password, passwordHash)) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid email or password' },
        { status: 401 },
      );
    }

    // 2.5 MFA gate (after password verification)
    await ensureMfaColumns();
    const mfaRows = await prisma.$queryRawUnsafe<{
      mfa_enabled: boolean; mfa_secret: string | null; mfa_recovery_codes: string[] | null;
    }[]>(
      `SELECT mfa_enabled, mfa_secret, mfa_recovery_codes FROM "User" WHERE id = $1`,
      user.id,
    );
    const mfaRow = mfaRows[0];
    if (mfaRow?.mfa_enabled) {
      const code = mfaCode ? String(mfaCode).trim() : '';
      const rec  = recoveryCode ? String(recoveryCode).trim() : '';
      if (!code && !rec) {
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
      return NextResponse.json(
        { error: 'Forbidden', message: 'This tenant account is inactive.' },
        { status: 403 },
      );
    }

    // 4. Sign session cookie (include role so middleware can inject x-user-role)
    const plan = userTenant.tenant.plan ?? 'TRIAL';
    const token = await signSession({
      userId:   user.id,
      tenantId: userTenant.tenantId,
      plan,
      role:     userTenant.role.code,
    });

    // 4b. Sign a JWT for the Go backend (Authorization: Bearer <token>).
    // This is independent of the xl-session cookie above — that cookie is
    // for the Next.js side (HMAC-signed JSON, ~Edge-runtime-friendly),
    // while the JWT below is the standard HS256-signed format the Go
    // backend validates via golang-jwt/jwt (backend/auth/jwt.go).
    // Missing JWT_SECRET is non-fatal for login itself — the user can
    // still use Next.js-side features that don't hit the Go backend. We
    // log the failure but don't 500 the login.
    let backendToken: string | null = null;
    try {
      backendToken = await signJwtForBackend({
        userId:   user.id,
        tenantId: userTenant.tenantId,
        role:     userTenant.role.code,
      });
    } catch (err) {
      console.warn('[auth/login] backend JWT sign failed (Go-backend features unavailable):', err);
    }

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
