/**
 * POST /api/auth/invitation/accept
 * Public.
 * Body for new user:      { token, password, firstName, lastName }
 * Body for existing user: { token, password }   (existing user verifies password)
 *
 * On success: marks invitation used, creates UserTenant (or User+UserTenant),
 * sets the xl-session cookie, returns user/tenant for the client redirect.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ensureInvitationTable, hashInvitationToken } from '@/lib/invitations';
import {
  hashPassword, verifyPassword, validatePassword, DEFAULT_PASSWORD_POLICY,
} from '@/lib/password-policy';
import { signSession } from '@/lib/tenant-session';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const COOKIE_NAME = 'xl-session';

export async function POST(req: NextRequest) {
  let body: { token?: string; password?: string; firstName?: string; lastName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const token     = String(body.token ?? '').trim();
  const password  = String(body.password ?? '');
  const firstName = String(body.firstName ?? '').trim();
  const lastName  = String(body.lastName ?? '').trim();

  if (!token || token.length < 32) {
    return NextResponse.json({ ok: false, error: 'Invalid invitation link.' }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 });
  }

  await ensureInvitationTable();
  const tokenHash = hashInvitationToken(token);

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; tenant_id: string; email: string; role_id: string;
    expires_at: string; used_at: string | null; revoked: boolean;
  }>>(
    `SELECT id::text, tenant_id, email, role_id, expires_at::text, used_at::text, revoked
     FROM tenant_invitations
     WHERE token_hash = $1
     LIMIT 1`,
    tokenHash,
  ).catch(() => []);

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Invitation not found.' }, { status: 404 });
  }
  const inv = rows[0];
  if (inv.used_at) return NextResponse.json({ ok: false, error: 'Invitation already accepted.' }, { status: 400 });
  if (inv.revoked) return NextResponse.json({ ok: false, error: 'Invitation revoked.' }, { status: 400 });
  if (new Date(inv.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: 'Invitation expired.' }, { status: 400 });
  }

  // Confirm tenant + role still exist and are valid.
  const [tenant, role] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: inv.tenant_id }, select: { id: true, name: true, plan: true, isActive: true } }),
    prisma.role.findUnique({ where: { id: inv.role_id }, select: { id: true, code: true } }),
  ]);
  if (!tenant || !tenant.isActive) {
    return NextResponse.json({ ok: false, error: 'Organisation is no longer active.' }, { status: 400 });
  }
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role is no longer available.' }, { status: 400 });
  }

  try {
    // Path A: existing user — verify their password, add a new UserTenant.
    const existing = await prisma.user.findUnique({ where: { email: inv.email } });
    if (existing) {
      const pwRows = await prisma.$queryRawUnsafe<{ password_hash: string | null }[]>(
        `SELECT password_hash FROM "User" WHERE id = $1`, existing.id,
      );
      const stored = pwRows[0]?.password_hash ?? null;
      if (!stored || !verifyPassword(password, stored)) {
        return NextResponse.json({ ok: false, error: 'Wrong password for the existing account.' }, { status: 401 });
      }
      if (!existing.isActive) {
        return NextResponse.json({ ok: false, error: 'Existing account is disabled. Ask your administrator.' }, { status: 403 });
      }

      // Add UserTenant if missing; if dormant, reactivate.
      const existingMembership = await prisma.userTenant.findUnique({
        where: { userId_tenantId: { userId: existing.id, tenantId: tenant.id } },
      }).catch(() => null);

      if (existingMembership) {
        if (!existingMembership.isActive) {
          await prisma.userTenant.update({
            where: { id: existingMembership.id },
            data:  { isActive: true, roleId: role.id },
          });
        }
      } else {
        await prisma.userTenant.create({
          data: { id: crypto.randomUUID(), userId: existing.id, tenantId: tenant.id, roleId: role.id, isActive: true },
        });
      }

      await prisma.$executeRawUnsafe(
        `UPDATE tenant_invitations SET used_at = NOW() WHERE id = $1::uuid`,
        inv.id,
      );

      void logAudit({
        tenantId: tenant.id, tenantName: tenant.name,
        userId: existing.id, userRole: role.code,
        entityType: 'Invitation', entityId: inv.id, entityName: inv.email,
        action: 'UPDATE',
        details: `Invitation accepted by existing user ${inv.email}; joined as ${role.code}.`,
      });

      const tk = await signSession({
        userId:   existing.id,
        tenantId: tenant.id,
        plan:     tenant.plan ?? 'TRIAL',
        role:     role.code,
      });
      const res = NextResponse.json({
        ok: true,
        user:   { id: existing.id, email: existing.email },
        tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan ?? 'TRIAL' },
      });
      res.cookies.set(COOKIE_NAME, tk, {
        httpOnly: true, sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 86_400, path: '/',
      });
      return res;
    }

    // Path B: new user — require firstName/lastName + valid policy.
    if (!firstName || !lastName) {
      return NextResponse.json({ ok: false, error: 'First and last name are required.' }, { status: 400 });
    }
    const validation = validatePassword(password, { email: inv.email }, DEFAULT_PASSWORD_POLICY);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, errors: validation.errors }, { status: 400 });
    }

    const newUserId = crypto.randomUUID();
    const pwHash    = hashPassword(password);

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id:        newUserId,
          username:  inv.email,
          email:     inv.email,
          firstName,
          lastName,
          isActive:  true,
          updatedAt: new Date(),
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
        pwHash, newUserId,
      );
      await tx.userTenant.create({
        data: { id: crypto.randomUUID(), userId: newUserId, tenantId: tenant.id, roleId: role.id, isActive: true },
      });
      await tx.$executeRawUnsafe(
        `UPDATE tenant_invitations SET used_at = NOW() WHERE id = $1::uuid`,
        inv.id,
      );
    });

    void logAudit({
      tenantId: tenant.id, tenantName: tenant.name,
      userId: newUserId, userRole: role.code,
      entityType: 'Invitation', entityId: inv.id, entityName: inv.email,
      action: 'CREATE',
      details: `Invitation accepted; new user ${inv.email} created and joined as ${role.code}.`,
    });

    const tk = await signSession({
      userId:   newUserId,
      tenantId: tenant.id,
      plan:     tenant.plan ?? 'TRIAL',
      role:     role.code,
    });
    const res = NextResponse.json({
      ok: true,
      user:   { id: newUserId, email: inv.email },
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan ?? 'TRIAL' },
    });
    res.cookies.set(COOKIE_NAME, tk, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86_400, path: '/',
    });
    return res;
  } catch (err) {
    captureException(err, { context: 'auth.invitation.accept' });
    return NextResponse.json({ ok: false, error: 'Could not accept invitation.' }, { status: 500 });
  }
}
