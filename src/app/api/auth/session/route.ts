/**
 * POST /api/auth/session  — Exchange userId + tenantId for an xl-session cookie
 * DELETE /api/auth/session — Clear the xl-session cookie (sign out)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signSession } from '@/lib/tenant-session';

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
    const body = await request.json();
    const { userId, tenantId } = body as { userId?: string; tenantId?: string };

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'userId and tenantId are required' },
        { status: 400 }
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

    // Sign the session token (include role)
    const token = await signSession({ userId, tenantId, plan, role: userTenant.role.code });

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
    };

    const response = NextResponse.json(responseBody, { status: 200 });
    response.cookies.set(COOKIE_NAME, token, sessionCookieOptions(86_400));

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
