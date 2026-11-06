export const dynamic = 'force-dynamic';

import { revokeSessionsSafely } from '@/lib/auth/session-revocation';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkGrantableRole } from '@/lib/admin-scope';
import { isSuperAdmin } from '@/lib/admin-access';
import { requireUnderQuota } from '@/lib/plan-limits';
import { withAuditedAction } from '@/lib/audited-action';
import { reportingLineValue, userScopeDenied } from '@/lib/admin/user-scope';
import { validatePasswordPolicy } from '@/lib/password-policy';

const CACHE_TAG = 'users:list';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

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
    const singleUserId = req.nextUrl.searchParams.get('userId');
    if (singleUserId) {
      const ut = await withTenantRls(prisma, params.id, (tx) =>
        tx.userTenant.findUnique({
          where: { userId_tenantId: { userId: singleUserId, tenantId: params.id } },
          include: { user: true, role: true },
        }),
      );
      if (!ut) {
        return NextResponse.json({ error: 'User not found in tenant' }, { status: 404 });
      }
      return NextResponse.json({
        ...ut.user,
        reportingLines: {
          managerUserId: ut.managerUserId ?? null,
          departmentHeadUserId: ut.departmentHeadUserId ?? null,
        },
      });
    }

    // Single joined query — avoids 2 sequential DB round-trips
    // UserTenant has RLS, Role has RLS, User is global. We use withTenantRls
    // so the join is constrained to the target tenant's memberships.
    const userTenants = await withTenantRls(prisma, params.id, (tx) =>
      tx.userTenant.findMany({
        where: { tenantId: params.id },
        include: {
          role: true,
          user: true,   // join user in same query instead of a second findMany
        },
      })
    );

    // Return flat structure so the UI can access u.firstName, u.username,
    // u.roleName, u.roleCode directly without nested drilling
    return NextResponse.json(
      userTenants.map(ut => ({
        ...ut.user,
        userId:         ut.userId,
        userTenantId:   ut.id,
        roleId:         ut.roleId,
        roleName:       ut.role.name,
        roleCode:       ut.role.code,
        isActive:       ut.isActive,
        isTenantActive: ut.isActive,
      })),
      {
        headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
      }
    );
  } catch (e) {
    console.error('GET /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: 'Failed to fetch tenant users' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    if (body.action === 'reset-mfa') {
      const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!targetUserId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }
      const mfaResult = await withPlatformAdmin(prisma, async (tx) => {
        const denied = await userScopeDenied(tx, req.headers, params.id, targetUserId, 'account');
        if (denied) return { denied };
        await tx.$executeRawUnsafe(
          `UPDATE "User"
              SET mfa_enabled = FALSE,
                  mfa_secret = NULL,
                  pending_mfa_secret = NULL,
                  mfa_recovery_codes = NULL,
                  mfa_enrolled_at = NULL,
                  "updatedAt" = NOW()
            WHERE id = $1`,
          targetUserId,
        );
        return { ok: true as const };
      });
      if ('denied' in mfaResult && mfaResult.denied) return mfaResult.denied;
      await revokeSessionsSafely({
        userId: targetUserId,
        reason: 'mfa-reset-by-admin',
        revokedBy: authz.userId,
      });
      revalidateCache([CACHE_TAG]);
      return NextResponse.json({ ok: true, message: 'MFA has been reset and active sessions were signed out.' });
    }

    if (body.action === 'update-member') {
      const {
        userId, username, email, firstName, lastName,
        department, position, mobileNumber, hierarchy,
        userType, employeeId, isActive,
        managerUserId, departmentHeadUserId, newPassword,
      } = body as {
        userId?: string;
        username?: string;
        email?: string;
        firstName?: string | null;
        lastName?: string | null;
        department?: string | null;
        position?: string | null;
        mobileNumber?: string | null;
        hierarchy?: string | null;
        userType?: string;
        employeeId?: string | null;
        isActive?: boolean;
        managerUserId?: string | null;
        departmentHeadUserId?: string | null;
        newPassword?: string;
      };

      if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }

      let passwordHash: string | null = null;
      if (typeof newPassword === 'string' && newPassword.trim()) {
        const pwCheck = validatePasswordPolicy(newPassword.trim());
        if (!pwCheck.ok) {
          return NextResponse.json(
            { error: 'Password must meet policy: ' + pwCheck.error },
            { status: 400 },
          );
        }
        passwordHash = hashPassword(newPassword.trim());
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = { updatedAt: new Date() };
      if (username     !== undefined) data.username     = username;
      if (email        !== undefined) data.email        = email;
      if (firstName    !== undefined) data.firstName    = firstName;
      if (lastName     !== undefined) data.lastName     = lastName;
      if (department   !== undefined) data.department   = department;
      if (position     !== undefined) data.position     = position;
      if (mobileNumber !== undefined) data.mobileNumber = mobileNumber;
      if (hierarchy    !== undefined) data.hierarchy    = hierarchy;
      if (userType     !== undefined) data.userType     = userType;
      if (employeeId   !== undefined) data.employeeId   = employeeId;
      if (isActive     !== undefined) data.isActive     = isActive;

      const lines: { managerUserId?: string | null; departmentHeadUserId?: string | null; isActive?: boolean } = {};
      if (isActive !== undefined) {
        lines.isActive = isActive;
      }
      // Note: Toggling `isActive` within a tenant updates the user's `UserTenant.isActive`
      // membership in this company; global account fields (`username`, `email`, `userType`,
      // `passwordHash`) still require single-tenant ownership or `SUPER_ADMIN` via `userScopeDenied`.
      const globalAccountChange = [username, email, userType, passwordHash].some((v) => v !== undefined && v !== null);

      const result = await withPlatformAdmin(prisma, async (tx) => {
        const denied = await userScopeDenied(
          tx,
          req.headers,
          params.id,
          userId,
          globalAccountChange ? 'account' : 'member',
        );
        if (denied) return { denied };

        // Only update global `User.isActive` when the caller is a Super Admin or
        // the user belongs exclusively to this tenant. Multi-company users have
        // only their `UserTenant.isActive` updated for `params.id`.
        if (isActive !== undefined && !isSuperAdmin(req.headers)) {
          const otherMemberships = await tx.userTenant.count({
            where: { userId, tenantId: { not: params.id } },
          });
          if (otherMemberships > 0) {
            delete data.isActive;
          }
        }

        for (const [key, value, label] of [
          ['managerUserId', managerUserId, 'Manager'],
          ['departmentHeadUserId', departmentHeadUserId, 'Department head'],
        ] as const) {
          if (value === undefined) continue;
          const checked = await reportingLineValue(tx, params.id, userId, value, label);
          if (!checked.ok) return { denied: NextResponse.json({ error: checked.error }, { status: 400 }) };
          lines[key] = checked.value;
        }

        const user = await tx.user.update({ where: { id: userId }, data });
        if (passwordHash) {
          await tx.$executeRawUnsafe(
            `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
            passwordHash,
            userId,
          );
        }
        if (Object.keys(lines).length) {
          await tx.userTenant.updateMany({ where: { userId, tenantId: params.id }, data: lines });
        }
        return { user };
      });

      if (result.denied) return result.denied;

      if (isActive === false || passwordHash) {
        await revokeSessionsSafely({
          userId,
          ...(isActive === false && !isSuperAdmin(req.headers) ? { tenantId: params.id } : {}),
          reason: isActive === false ? 'user-deactivated' : 'password-set-by-admin',
          revokedBy: authz.userId,
        });
      }
      revalidateCache([CACHE_TAG]);
      return NextResponse.json(result.user);
    }

    const { userId, roleId } = body;

    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!roleId)  return NextResponse.json({ error: 'roleId is required' },  { status: 400 });

    // User is global (no RLS), but Role has RLS. We need to look up the
    // User (no RLS issue) and the Role (need to see this tenant's roles
    // plus system roles) — so use withPlatformAdmin for the validation
    // step. The actual UserTenant write happens inside withTenantRls.
    const validations = await withPlatformAdmin(prisma, async (tx) => {
      const user   = await tx.user.findUnique({ where: { id: userId } });
      if (!user)   return { error: `User not found: ${userId}`, status: 404 as const };
      const tenant = await tx.tenant.findUnique({ where: { id: params.id } });
      if (!tenant) return { error: `Tenant not found: ${params.id}`, status: 404 as const };
      const role   = await tx.role.findUnique({ where: { id: roleId } });
      if (!role)   return { error: `Role not found: ${roleId}`, status: 404 as const };
      const existing = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId: params.id } },
      });
      const activeMemberCount = await tx.userTenant.count({
        where: { tenantId: params.id, isActive: true },
      });
      return { ok: true as const, role, tenant, existing, activeMemberCount };
    });
    if ('error' in validations) {
      return NextResponse.json({ error: validations.error }, { status: validations.status });
    }
    const roleDenied = checkGrantableRole(req.headers, params.id, validations.role);
    if (roleDenied) return roleDenied;

    // Cross-tenant hijack & quota protection:
    // If the user is NOT already a member of `params.id`, only a platform SUPER_ADMIN
    // may attach an existing account directly without an invitation, and adding a new
    // active member must respect the tenant's `maxUsers` plan quota.
    if (!validations.existing && !isSuperAdmin(req.headers)) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          message: 'Existing accounts from outside your organization must be invited via the Invitations workflow.',
        },
        { status: 403 },
      );
    }

    if (!validations.existing || !validations.existing.isActive) {
      const targetPlan = (validations.tenant.plan as string | undefined) ?? req.headers.get('x-tenant-plan') ?? 'TRIAL';
      const gate = requireUnderQuota({
        plan: targetPlan,
        resource: 'maxUsers',
        current: validations.activeMemberCount,
      });
      if (gate) return gate;
    }

    // Upsert membership inside the tenant-scoped transaction.
    const { ut, roleChanged } = await withTenantRls(prisma, params.id, async (tx) => {
      const existing = await tx.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId: params.id } },
      });

      const ut = existing
        ? await tx.userTenant.update({
            where: { id: existing.id },
            data: { roleId, isActive: true },
          })
        : await tx.userTenant.create({
            data: { userId, tenantId: params.id, roleId },
          });
      return { ut, roleChanged: !!existing && existing.roleId !== roleId };
    });
    // Sessions signed with the old role (and its permissions) end within 60 s.
    if (roleChanged) {
      await revokeSessionsSafely({ userId, tenantId: params.id, reason: 'role-changed', revokedBy: authz.userId });
    }
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(ut, { status: 201 });
  } catch (e) {
    console.error('POST /api/admin/tenants/[id]/users error:', e);
    if (errorCode(e) === 'P2002') {
      return NextResponse.json({ error: 'Username or email is already taken, or user is already assigned' }, { status: 409 });
    }
    return NextResponse.json(
      { error: errorMessage(e, 'Failed to update tenant user') },
      { status: 500 }
    );
  }
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
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    await withTenantRls(prisma, params.id, (tx) =>
      tx.userTenant.deleteMany({ where: { tenantId: params.id, userId } })
    );
    await revokeSessionsSafely({ userId, tenantId: params.id, reason: 'membership-removed', revokedBy: authz.userId });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/admin/tenants/[id]/users error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
