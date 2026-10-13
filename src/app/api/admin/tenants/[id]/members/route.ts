export const dynamic = 'force-dynamic';

/**
 * /api/admin/tenants/[id]/members — the New User form for one company
 * (src/components/admin/NewUserDialog.tsx; rules in
 * src/lib/admin/member-onboarding.ts).
 *
 * GET   ?roleId=  the form's choices: the roles this caller may grant here,
 *       the company's active departments, and, for roleId, the modules
 *       with what that role grants in each (to narrow).
 * POST  { email, firstName, lastName, username?, mobileNumber?, position?,
 *         userType?, roleId, departmentId?, moduleAccess?,
 *         onboarding: "invite" | "password", password? }
 *
 * Company administrators act on their own company; platform administrators
 * on any.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant, requireSuperAdminForTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { isSuperAdmin } from '@/lib/admin-access';
import { sessionUser } from '@/lib/session-user';
import { getEffectiveRoleById } from '@/lib/permissions/effective-role';
import { permissionsForEffectiveRole } from '@/lib/authz/session-permissions';
import { ACCESS_LEVELS, roleAccessByModule } from '@/lib/authz/access-mask';
import { accessModuleRows } from '@/lib/admin/member-access';
import { createMember, inviteMember, parseNewMember } from '@/lib/admin/member-onboarding';

type Params = { params: Promise<{ id: string }> };

function guard(req: NextRequest, tenantId: string) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return { ok: false as const, res: NextResponse.json({ error: authz.error }, { status: authz.status }) };
  const g = requireSuperAdminForTenant(authz, tenantId);
  if (!g.ok) return { ok: false as const, res: NextResponse.json({ error: g.error }, { status: g.status }) };
  if (!authz.userId) return { ok: false as const, res: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  return { ok: true as const, userId: authz.userId };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: tenantId } = await params;
  const g = guard(req, tenantId);
  if (!g.ok) return g.res;
  const roleId = req.nextUrl.searchParams.get('roleId');

  try {
    const data = await withPlatformAdmin(prisma, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, modules: { where: { isEnabled: true }, select: { module: true } } },
      });
      if (!tenant) return null;
      const roles = await tx.role.findMany({
        where: {
          OR: [{ tenantId }, { tenantId: null }],
          ...(isSuperAdmin(req.headers) ? {} : { NOT: { code: 'SUPER_ADMIN' } }),
        },
        select: { id: true, name: true, code: true, tenantId: true },
        orderBy: { name: 'asc' },
      });
      const departments = await tx.department.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      let modules = null;
      if (roleId && roles.some((r) => r.id === roleId)) {
        const effective = await getEffectiveRoleById(tx as never, tenantId, roleId);
        modules = accessModuleRows(
          tenant.modules.map((m) => m.module),
          roleAccessByModule(permissionsForEffectiveRole(effective)),
        );
      }
      return { tenant, roles, departments, modules };
    });
    if (!data) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    return NextResponse.json({
      tenant: { id: data.tenant.id, name: data.tenant.name },
      roles: data.roles.map((r) => ({ id: r.id, name: r.name, code: r.code, scope: r.tenantId ? 'company' : 'platform' })),
      departments: data.departments,
      levels: ACCESS_LEVELS,
      modules: data.modules,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('GET /api/admin/tenants/[id]/members:', e);
    return NextResponse.json({ error: 'Failed to load the form' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, { params }: Params) {
  const { id: tenantId } = await params;
  const g = guard(req, tenantId);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const onboarding = body?.onboarding === 'password' ? 'password' : body?.onboarding === 'invite' ? 'invite' : null;
  if (!onboarding) return NextResponse.json({ error: 'Choose how the user signs in: invitation or password' }, { status: 400 });

  const parsed = parseNewMember(body, { requireName: onboarding === 'password' });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  try {
    if (onboarding === 'invite') {
      const inviter = await sessionUser(req.headers).catch(() => null);
      const r = await inviteMember(req.headers, tenantId, { userId: g.userId, name: inviter?.name, email: inviter?.email }, parsed.value);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({ ok: true, outcome: 'invited', emailed: r.emailed, reason: r.reason, acceptUrl: r.acceptUrl }, { status: 201 });
    }
    const password = typeof body?.password === 'string' ? body.password : '';
    const r = await createMember(req.headers, tenantId, { userId: g.userId }, parsed.value, password);
    if (!r.ok) return NextResponse.json({ error: r.error, errors: r.errors }, { status: r.status });
    return NextResponse.json({ ok: true, outcome: r.existingAccount ? 'added' : 'created', userId: r.userId }, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'P2002') return NextResponse.json({ error: 'That username or email is already taken' }, { status: 409 });
    console.error('POST /api/admin/tenants/[id]/members:', e);
    return NextResponse.json({ error: 'Failed to add the user' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
