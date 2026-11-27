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
import { signJwtForBackend } from '@/lib/auth/jwt';
import { revokeSession } from '@/lib/session-blocklist';
import {
  buildRevocationTokenKeys,
  markRevocationTokensSynced,
  revokeSessionTokensDurable,
  scheduleRevocationRedisSync,
} from '@/lib/auth/durable-session-revocation';
import { performSessionLogout } from '@/lib/auth/logout-revocation';
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

    // Look up the UserTenant record, include tenant + role, AND verify the
    // caller's session has not been durably revoked in PostgreSQL (prevents
    // re-minting a fresh session from a logged-out cookie after a Redis flush).
    //
    // Runs under withPlatformAdmin because this route ESTABLISHES the tenant
    // session — there is no tenant context yet to scope by, and user_tenants
    // is RLS-protected. Without it this lookup returns nothing once the app
    // connects as a role that doesn't bypass RLS, and every login fails.
    // Same reasoning as api/admin/session. The security boundary here is the
    // membership check below, not RLS.
    const tokenKeys = token ? await buildRevocationTokenKeys(token, session.sid) : [];
    const sessionLookup = await withPlatformAdmin(prisma, async (tx) => {
      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        const revRows = await tx.$queryRawUnsafe<Array<{ revoked?: boolean }>>(
          `SELECT (
             (cardinality($1::text[]) > 0 AND EXISTS (
               SELECT 1 FROM public.revoked_session_tokens
                WHERE token_key = ANY($1::text[])
                  AND tenant_id = $2
                  AND expires_at > now()
             ))
             OR EXISTS (
               SELECT 1 FROM public.session_revocations
                WHERE not_before > $4::timestamptz
                  AND ((user_id = $3 AND tenant_id IS NULL)
                    OR (tenant_id = $2 AND user_id IS NULL)
                    OR (user_id = $3 AND tenant_id = $2))
             )
           ) AS revoked`,
          tokenKeys,
          session.tenantId,
          session.userId,
          new Date(typeof session.issuedAt === 'number' && Number.isFinite(session.issuedAt) && session.issuedAt > 0 ? session.issuedAt : 0),
        );
        if (Array.isArray(revRows) && revRows[0]?.revoked === true) {
          return { revoked: true as const, userTenant: null };
        }
      } else if (process.env.NODE_ENV === 'production') {
        return { revoked: true as const, userTenant: null };
      }

      const ut = await tx.userTenant.findUnique({
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
      });
      return { revoked: false as const, userTenant: ut };
    });

    if (sessionLookup.revoked) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Session has been revoked' },
        { status: 401 },
      );
    }

    const userTenant = sessionLookup.userTenant;

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
    const permissions = session.impersonatedBy ? undefined : await sessionPermissionsFor(userId, tenantId);
    // Preserve paired sid/jti on same-tenant refresh; rotate and revoke old sid on tenant switch.
    const newSid =
      tenantId === session.tenantId && session.sid
        ? session.sid
        : globalThis.crypto.randomUUID();

    // Sign the session token (include role and paired sid). Not for an
    // impersonation session (see above): it keeps the cookie it has.
    const newToken = session.impersonatedBy ? null : await signSession({
      userId,
      tenantId,
      plan,
      role: userTenant.role.code,
      permissions,
      sid: newSid,
      ...(await residencyClaimForTenant(tenantId)),
    });

    // When switching tenants, durably revoke the superseded session + paired
    // Go JWT (`session.sid`) so the pre-switch credentials cannot survive logout
    // of the newly issued session.
    if (newToken && token && tenantId !== session.tenantId) {
      const oldExpMs =
        typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now()
          ? session.expiresAt
          : Date.now() + 24 * 60 * 60 * 1000;
      const oldKeys = await buildRevocationTokenKeys(token, session.sid);
      const oldExpDate = new Date(oldExpMs);
      const revRes = await revokeSessionTokensDurable(
        oldKeys.map((tokenKey) => ({
          tokenKey,
          userId: session.userId,
          tenantId: session.tenantId,
          expiresAt: oldExpDate,
          reason: 'tenant-switch',
        })),
      );
      if (revRes.ok) {
        const rRes = await revokeSession(token, oldExpMs, session.sid).catch(() => ({ ok: false as const, persisted: 'failed' as const }));
        if (rRes.ok && rRes.persisted === 'redis') {
          void markRevocationTokensSynced(oldKeys);
        } else if (!rRes.ok) {
          scheduleRevocationRedisSync();
        }
      }
    }

    // Issue a paired Go backend JWT carrying the exact same `jti = newSid` so
    // `xl_backend_token` stays paired with the new `xl-session` after tenant switch.
    let backendToken: string | undefined;
    if (newToken && process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
      backendToken = await signJwtForBackend({
        userId,
        tenantId,
        role: userTenant.role.code,
        permissions,
        plan,
        sid: newSid,
      }).catch(() => undefined);
    }

    // Build response payload
    // Module policies (default / per tenant / tier) applied to the stored switches.
    const enabledModules = await tenantModulesFor(
      userTenant.tenant.modules.filter(m => m.isEnabled).map(m => m.module),
      plan,
    );

    const responseBody = {
      ok: true,
      ...(backendToken ? { backendToken } : {}),
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

// ── DELETE — Destroy & revoke session (unified with POST /api/auth/logout) ────

export async function DELETE(request: NextRequest) {
  return performSessionLogout(request);
}
