/**
 * POST /api/admin/impersonate
 * Body: { tenantId, userId? }
 *
 * SUPER_ADMIN-only. Issues a new session cookie scoped to the target tenant
 * (and optionally a specific user inside it). Stashes the impersonator's
 * original session in a separate "xl-impersonator-session" cookie so they
 * can revert via /api/admin/impersonate/stop.
 *
 * The impersonation session has a shorter TTL (1 hour) and embeds
 * `impersonatedBy = <super-admin user id>` so the UI can render a banner
 * and audit logs can attribute actions to the real human.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signSession } from '@/lib/tenant-session';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const COOKIE_NAME              = 'xl-session';
const IMPERSONATOR_COOKIE_NAME = 'xl-impersonator-session';
const IMPERSONATION_TTL_MS     = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const role = req.headers.get('x-user-role');
    if (role !== 'SUPER_ADMIN') {
      return NextResponse.json({ ok: false, error: 'Only platform admins can impersonate' }, { status: 403 });
    }
    const impersonatorId = req.headers.get('x-user-id') ?? '';
    if (!impersonatorId) {
      return NextResponse.json({ ok: false, error: 'No session' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const tenantId    = String(body?.tenantId ?? '').trim();
    const targetUserId = body?.userId ? String(body.userId).trim() : null;
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: 'tenantId is required' }, { status: 400 });
    }

    // Resolve target tenant + tenant admin user (or specified user).
    const tenantRows = await prisma.$queryRawUnsafe<{ id: string; name: string; plan: string; is_active: boolean }[]>(
      `SELECT id, name, plan, is_active FROM tenants WHERE id = $1 LIMIT 1`,
      tenantId,
    );
    const tenant = tenantRows[0];
    if (!tenant) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });
    if (!tenant.is_active) {
      return NextResponse.json({ ok: false, error: 'Tenant is inactive' }, { status: 400 });
    }

    // Find a UserTenant — explicit user if provided, otherwise the most recent
    // active TENANT_ADMIN, otherwise the most recent active member.
    const memberships = await prisma.userTenant.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(targetUserId ? { userId: targetUserId } : {}),
      },
      include: {
        user: { select: { id: true, email: true, isActive: true } },
        role: { select: { code: true } },
      },
      orderBy: [{ role: { code: 'asc' } }, { createdAt: 'desc' }],
    });
    const usable = memberships.filter(m => m.user.isActive);
    if (usable.length === 0) {
      return NextResponse.json({ ok: false, error: 'No active user found for this tenant' }, { status: 404 });
    }
    const target = usable.find(m => m.role.code === 'TENANT_ADMIN') ?? usable[0];

    // Stash the current (impersonator's) session under a separate cookie so we
    // can restore it on /stop. The original cookie is then overwritten with
    // the impersonation session.
    const originalToken = req.cookies.get(COOKIE_NAME)?.value ?? '';

    const newToken = await signSession({
      userId:         target.user.id,
      tenantId:       tenant.id,
      plan:           tenant.plan ?? 'TRIAL',
      role:           target.role.code,
      impersonatedBy: impersonatorId,
      ttlMs:          IMPERSONATION_TTL_MS,
    });

    void logAudit({
      tenantId: tenant.id,
      tenantName: tenant.name,
      userId: impersonatorId,
      userRole: 'SUPER_ADMIN',
      entityType: 'Impersonation',
      entityId: target.user.id,
      entityName: target.user.email,
      action: 'CREATE',
      details: `Impersonation started by ${impersonatorId} → tenant ${tenant.name} (${tenant.id}) as user ${target.user.email}.`,
    });

    const res = NextResponse.json({
      ok: true,
      tenant:  { id: tenant.id, name: tenant.name, plan: tenant.plan },
      asUser:  { id: target.user.id, email: target.user.email, role: target.role.code },
      ttlSec:  IMPERSONATION_TTL_MS / 1000,
    });
    res.cookies.set(COOKIE_NAME, newToken, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: IMPERSONATION_TTL_MS / 1000, path: '/',
    });
    if (originalToken) {
      res.cookies.set(IMPERSONATOR_COOKIE_NAME, originalToken, {
        httpOnly: true, sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: IMPERSONATION_TTL_MS / 1000, path: '/',
      });
    }
    return res;
  } catch (err) {
    captureException(err, { context: 'admin.impersonate.start' });
    return NextResponse.json({ ok: false, error: 'Impersonation failed' }, { status: 500 });
  }
}
