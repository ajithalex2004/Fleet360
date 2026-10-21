export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/session  — Re-issue the caller's own xl-session, optionally
 *                           for another tenant they belong to (tenant switch)
 * DELETE /api/auth/session — Clear the xl-session cookie (sign out)
 *
 * This path is public in the middleware (auth-route-policies.ts), so the
 * handler is its own authentication: it requires a valid xl-session and only
 * re-issues it for the user that session belongs to. It used to sign a
 * session for whatever { userId, tenantId } the body named, with no
 * credential at all — any caller who knew a user's id became that user,
 * SUPER_ADMIN included. Signing in as someone else is
 * POST /api/admin/impersonate (SUPER_ADMIN only, audited, short-lived).
 */

import { sessionPermissionsFor } from '@/lib/authz/session-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { residencyClaimForTenant } from '@/lib/db-router';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { signSession, verifySession } from '@/lib/tenant-session';
import { tenantModulesFor } from '@/lib/module-policies';
// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_NAME = 'xl-session';

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge,
    path: '/',
  };
}

// ── POST — Create session ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'JSON body with userId and tenantId is required' },
        { status: 400 }
      );
    }

    const { userId, tenantId } = body as { userId?: string; tenantId?: string };

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'userId and tenantId are required' },
        { status: 400 }
      );
    }

    // The credential: the caller's own verified session. Revoked, expired
    // and forged tokens all verify as null.
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Sign in first' },
        { status: 401 }
      );
    }
    if (userId !== session.userId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'A session can only be re-issued for its own user. Use impersonation to act as another user.' },
        { status: 403 }
      );
    }
    // An impersonation session keeps its short lifetime and its
    // impersonatedBy marker: re-signing it here would drop both. It stays in
    // the tenant it was issued for.
    if (session.impersonatedBy && tenantId !== session.tenantId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Stop impersonating before switching tenant' },
        { status: 403 }
      );
    }

    // Look up the UserTenant record and include tenant + role.
    //
    // Runs under withPlatformAdmin because this route ESTABLISHES the tenant
    // session — there is no tenant context yet to scope by, and user_tenants
    // is RLS-protected. Without it this lookup returns nothing once the app
    // connects as a role that doesn't bypass RLS, and every login fails.
    // Same reasoning as api/admin/session. The security boundary here is the
    // membership check below, not RLS.
    const userTenant = await withPlatformAdmin(prisma, (tx) => tx.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: {
        tenant: {
          include: { modules: true },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
          },
        },
        role: {
          select: { id: true, name: true, code: true },
        },
      },
    }));

    if (!userTenant) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'User not found in this tenant' },
        { status: 401 }
      );
    }

    if (!userTenant.isActive) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'User is inactive in this tenant' },
        { status: 403 }
      );
    }

    if (!userTenant.tenant.isActive) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Tenant account is inactive' },
        { status: 403 }
      );
    }

    if (!userTenant.user.isActive) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'User account is disabled' },
        { status: 403 }
      );
    }

    const plan = userTenant.tenant.plan ?? 'TRIAL';

    // Sign the session token (include role). Not for an impersonation
    // session (see above): it keeps the cookie it has.
    const newToken = session.impersonatedBy ? null : await signSession({
      userId, tenantId, plan, role: userTenant.role.code,
      permissions: await sessionPermissionsFor(userId, tenantId),
      ...(await residencyClaimForTenant(tenantId)),
    });

    // Build response payload
    // Module policies (default / per tenant / tier) applied to the stored switches.
    const enabledModules = await tenantModulesFor(
      userTenant.tenant.modules.filter(m => m.isEnabled).map(m => m.module),
      plan,
    );

    const responseBody = {
      ok: true,
      user: {
        id: userTenant.user.id,
        username: userTenant.user.username,
        email: userTenant.user.email,
        firstName: userTenant.user.firstName,
        lastName: userTenant.user.lastName,
        roleCode: userTenant.role.code,
        roleName: userTenant.role.name,
      },
      tenant: {
        id: userTenant.tenant.id,
        name: userTenant.tenant.name,
        code: userTenant.tenant.code,
        plan,
        domain: userTenant.tenant.domain,
        enabledModules,
      },
    };

    const response = NextResponse.json(responseBody, { status: 200 });
    if (newToken) response.cookies.set(COOKIE_NAME, newToken, sessionCookieOptions(86_400));

    return response;
  } catch (err) {
    console.error('[auth/session POST]', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create session' },
      { status: 500 }
    );
  }
}

// ── DELETE — Destroy session ──────────────────────────────────────────────────

export async function DELETE(_request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(COOKIE_NAME, '', sessionCookieOptions(0));
  return response;
}
