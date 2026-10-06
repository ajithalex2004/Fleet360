export const dynamic = 'force-dynamic';

import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { readTenantFeatureFlags } from '@/lib/tenant-features';
const CACHE_TAG = 'tenants:list';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: params.id },
        include: {
          modules: true,
          roles: { include: { _count: { select: { permissions: true, userTenants: true } } } },
          userTenants: { include: { role: true } },
        },
      });
      if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      // Stored value of every catalog flag (see @/lib/module-features).
      const featureFlags = await readTenantFeatureFlags(tx, params.id);
      return NextResponse.json({ ...tenant, featureFlags }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handlePATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    // featureFlags is read-only here (GET derives it); modules are saved via /modules.
    const { modules, userTenants, roles, featureFlags, ...data } = body;
    const tenant = await withTenantRls(prisma, params.id, (tx) =>
      tx.tenant.update({
        where: { id: params.id },
        data: { ...data, updatedAt: new Date() },
      }),
    );
    // Deactivated, or the plan (signed into sessions) changed: every session
    // in the tenant ends within 60 s.
    if (data.isActive === false || data.plan !== undefined) {
      await revokeSessionsSafely({
        tenantId: params.id,
        reason: data.isActive === false ? 'tenant-deactivated' : 'tenant-plan-changed',
        revokedBy: authz.userId,
      });
    }
    // Bust the list cache so the tenants page and the platform
    // dashboard's stat card see the change on the next render.
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(tenant);
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

async function handleDELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    await withTenantRls(prisma, params.id, (tx) =>
      tx.tenant.update({ where: { id: params.id }, data: { isActive: false } }),
    );
    await revokeSessionsSafely({ tenantId: params.id, reason: 'tenant-deactivated', revokedBy: authz.userId });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
    } catch (e) { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
