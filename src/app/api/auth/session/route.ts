/**
 * POST /api/auth/session  — Exchange userId + tenantId for an xl-session cookie
 * DELETE /api/auth/session — Clear the xl-session cookie (sign out)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signSession, verifySession } from '@/lib/tenant-session';
import { newSessionId, registerSession, revokeSession } from '@/lib/session-registry';
import { customerContextForUser } from '@/lib/corporate-customer-identity';

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
    const existingToken = request.cookies.get(COOKIE_NAME)?.value;
    const existingSession = existingToken ? await verifySession(existingToken) : null;
    if (!existingSession) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Existing session required' },
        { status: 401 }
      );
    }

    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Request body is required' },
        { status: 400 }
      );
    }

    const body = JSON.parse(rawBody);
    const { userId, tenantId } = body as { userId?: string; tenantId?: string };

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'userId and tenantId are required' },
        { status: 400 }
      );
    }

    const isSuperAdmin = existingSession.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && existingSession.userId !== userId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Cannot create a session for another user' },
        { status: 403 }
      );
    }

    // Look up the UserTenant record and include tenant + role
    const userTenant = await prisma.userTenant.findUnique({
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
    const customerContext = await customerContextForUser(tenantId, userId).catch(() => null);

    // Sign the session token (include role)
    const sessionId = newSessionId();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const token = await signSession({
      sessionId,
      userId,
      tenantId,
      ...(customerContext ? { customerId: customerContext.customerId, customerRole: customerContext.role } : {}),
      plan,
      role: userTenant.role.code,
    });
    await registerSession({
      id: sessionId,
      userId,
      tenantId,
      plan,
      role: userTenant.role.code,
      expiresAt,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip'),
      userAgent: request.headers.get('user-agent'),
    });
    if (existingSession.sessionId) {
      await revokeSession(existingSession.sessionId, existingSession.userId, 'session-switched');
    }

    // Build response payload
    const enabledModules = userTenant.tenant.modules
      .filter(m => m.isEnabled)
      .map(m => m.module);

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
      customer: customerContext,
    };

    const response = NextResponse.json(responseBody, { status: 200 });
    response.cookies.set(COOKIE_NAME, token, sessionCookieOptions(86_400));

    return response;
  } catch (err) {
    console.error('[auth/session POST]', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create session', detail: msg },
      { status: 500 }
    );
  }
}

// ── DELETE — Destroy session ──────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (session?.sessionId) {
    await revokeSession(session.sessionId, session.userId, 'logout');
  }
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(COOKIE_NAME, '', sessionCookieOptions(0));
  return response;
}
