export const dynamic = 'force-dynamic';

/**
 * /api/admin/tenants/[id]/users/[userId]/access — a user's access in one
 * company: department and module access (Admin > Users > Module Access).
 *
 * GET  the user's role there, what the role grants per module, the
 *      company's modules, the saved module access and department, and the
 *      company's departments to choose from.
 * PUT  { moduleAccess?: {module: ["view"|"create"|"edit"|"delete"]} | null,
 *        departmentId?: string | null }   (a field left out stays as it is)
 *
 * Module access narrows the role, never widens it (src/lib/authz/access-mask.ts):
 * levels the role does not grant are dropped before saving, so what is
 * stored is what applies. Saving ends the user's sessions in that company,
 * so the new access takes effect at once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant, requireSuperAdminForTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { getEffectiveRole } from '@/lib/permissions/effective-role';
import { permissionsForEffectiveRole } from '@/lib/authz/session-permissions';
import {
  ACCESS_LEVELS, parseAccessMask, roleAccessByModule, storedAccessMask, type AccessMask,
} from '@/lib/authz/access-mask';
import { MODULES as MODULE_DEFS, resolveModuleKey } from '@/lib/modules';

type Params = { params: Promise<{ id: string; userId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MODULE_LABEL = new Map(MODULE_DEFS.map((m) => [m.key as string, m.shortName ?? m.name]));

function guard(req: NextRequest, tenantId: string) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return { ok: false as const, res: NextResponse.json({ error: authz.error }, { status: authz.status }) };
  const g = requireSuperAdminForTenant(authz, tenantId);
  if (!g.ok) return { ok: false as const, res: NextResponse.json({ error: g.error }, { status: g.status }) };
  return { ok: true as const, authz };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tenantId, userId } = await params;
  const g = guard(req, tenantId);
  if (!g.ok) return g.res;

  try {
    const data = await withPlatformAdmin(prisma, async (tx) => {
      const membership = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
        select: {
          moduleAccess: true, departmentId: true,
          user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
          tenant: { select: { id: true, name: true, modules: { where: { isEnabled: true }, select: { module: true } } } },
        },
      });
      if (!membership) return null;
      const role = await getEffectiveRole(tx as never, userId, tenantId);
      const departments = await tx.department.findMany({
        where: { tenantId, OR: [{ isActive: true }, ...(membership.departmentId ? [{ id: membership.departmentId }] : [])] },
        select: { id: true, name: true, isActive: true },
        orderBy: { name: 'asc' },
      });
      return { membership, role, departments };
    });
    if (!data) return NextResponse.json({ error: 'This user is not a member of this company' }, { status: 404 });

    const { membership, role, departments } = data;
    const roleAccess = roleAccessByModule(permissionsForEffectiveRole(role));
    const tenantModules = new Set(
      membership.tenant.modules.map((m) => resolveModuleKey(m.module) ?? m.module),
    );
    // The company's modules plus any the role holds; Admin access follows
    // the role (Tenant Administrator), not module access.
    const keys = new Set([...tenantModules, ...Object.keys(roleAccess)]);
    keys.delete('admin');
    const modules = [...keys]
      .filter((k) => MODULE_LABEL.has(k))
      .map((key) => ({
        key,
        label: MODULE_LABEL.get(key)!,
        enabledForTenant: tenantModules.has(key),
        roleAccess: roleAccess[key] ?? [],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({
      tenant: { id: membership.tenant.id, name: membership.tenant.name },
      user: membership.user,
      role: role ? { id: role.id, code: role.code, name: role.name } : null,
      isPlatformAdmin: role?.code === 'SUPER_ADMIN',
      levels: ACCESS_LEVELS,
      modules,
      moduleAccess: storedAccessMask(membership.moduleAccess),
      departmentId: membership.departmentId,
      departments,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('GET /api/admin/tenants/[id]/users/[userId]/access:', e);
    return NextResponse.json({ error: 'Failed to load the user\'s access' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest, { params }: Params) {
  const { id: tenantId, userId } = await params;
  const g = guard(req, tenantId);
  if (!g.ok) return g.res;

  let body: { moduleAccess?: unknown; departmentId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  const changeAccess = body.moduleAccess !== undefined;
  let requested: AccessMask | null = null;
  try {
    if (changeAccess) requested = parseAccessMask(body.moduleAccess);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid module access' }, { status: 400 });
  }
  const departmentId = body.departmentId === undefined ? undefined
    : (body.departmentId === null || body.departmentId === '' ? null : String(body.departmentId));
  if (departmentId && !UUID.test(departmentId)) {
    return NextResponse.json({ error: 'Department not found in this company' }, { status: 400 });
  }

  try {
    const result = await withPlatformAdmin(prisma, async (tx) => {
      const membership = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
        select: { id: true, moduleAccess: true, departmentId: true },
      });
      if (!membership) return { status: 404 as const, error: 'This user is not a member of this company' };

      if (departmentId) {
        const dept = await tx.department.findFirst({ where: { id: departmentId, tenantId }, select: { id: true } });
        if (!dept) return { status: 400 as const, error: 'Department not found in this company' };
      }

      // Store only what narrows the role: levels the role does not grant are
      // dropped, and a module left with all of the role's access is not
      // stored (it follows the role). Nothing narrowed: no mask.
      let mask: AccessMask | null = null;
      if (requested) {
        const roleAccess = roleAccessByModule(permissionsForEffectiveRole(await getEffectiveRole(tx as never, userId, tenantId)));
        for (const [module, levels] of Object.entries(requested)) {
          if (module === 'admin') continue;
          const granted = roleAccess[module] ?? [];
          if (granted.length === 0) continue; // nothing to narrow
          const kept = levels.filter((l) => granted.includes(l));
          if (kept.length < granted.length) (mask ??= {})[module] = kept;
        }
      }

      await tx.userTenant.update({
        where: { id: membership.id },
        data: {
          ...(changeAccess ? { moduleAccess: mask === null ? Prisma.DbNull : mask } : {}),
          ...(departmentId !== undefined ? { departmentId } : {}),
        },
      });
      const accessChanged = changeAccess
        && JSON.stringify(storedAccessMask(membership.moduleAccess)) !== JSON.stringify(mask);
      return { ok: true as const, mask, accessChanged };
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

    // Sessions carry their permissions: end them so the new access applies now.
    if (result.accessChanged) {
      await revokeSessionsSafely({ userId, tenantId, reason: 'module-access-changed', revokedBy: g.authz.userId });
    }
    return NextResponse.json({ ok: true, ...(changeAccess ? { moduleAccess: result.mask } : {}), ...(departmentId !== undefined ? { departmentId } : {}) });
  } catch (e) {
    console.error('PUT /api/admin/tenants/[id]/users/[userId]/access:', e);
    return NextResponse.json({ error: 'Failed to save the user\'s access' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
