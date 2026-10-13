/**
 * Adding a person to a company — the one server path behind the New User
 * form (Admin > Users, Tenant > Users, Tenant > Invitations) and the
 * invitations API.
 *
 * Everything is chosen up front: profile, role, department and module
 * access (narrowing the role, src/lib/authz/access-mask.ts). Two ways in:
 *
 *   invite    an invitation email; the person sets their own password, and
 *             accepting applies the role, department and module access
 *             (POST /api/auth/invitation/accept). Works for people who
 *             already have an account in another company: they accept with
 *             their existing password.
 *   password  the account is created now with a password the admin sets.
 *             An email that already has an account is added to the company
 *             directly — by a platform administrator only; a company
 *             administrator invites them instead, so nobody is attached to
 *             a company without accepting.
 *
 * Both check the same rules: the role belongs to the company or the
 * platform (only platform administrators grant Super Admin), the department
 * is the company's, the plan's user limit, and that the person is not
 * already a member.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { isSuperAdmin } from '@/lib/admin-access';
import { generateInvitationToken, INVITATION_TTL_DAYS } from '@/lib/invitations';
import { getLimits } from '@/lib/plan-limits';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { logAudit } from '@/lib/audit';
import { DEFAULT_PASSWORD_POLICY, hashPassword, validatePassword } from '@/lib/password-policy';
import { getEffectiveRoleById } from '@/lib/permissions/effective-role';
import { permissionsForEffectiveRole } from '@/lib/authz/session-permissions';
import { parseAccessMask, roleAccessByModule, type AccessMask } from '@/lib/authz/access-mask';
import { narrowToRole } from '@/lib/admin/member-access';
import { revalidateCache } from '@/lib/server-cache';

type Tx = Parameters<Parameters<typeof withPlatformAdmin>[1]>[0];

export interface NewMember {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  mobileNumber: string | null;
  position: string | null;
  userType: string;
  roleId: string;
  departmentId: string | null;
  /** As requested; narrowed to the role before it is stored. */
  moduleAccess: AccessMask | null;
}

export type Failure = { ok: false; status: number; error: string; errors?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Reads the form. A first and last name are required for "password" (the
 * account is created now); for "invite" the invitee can still enter them.
 */
export function parseNewMember(
  body: unknown,
  opts: { requireName: boolean },
): { ok: true; value: NewMember } | Failure {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Invalid request body' };
  const b = body as Record<string, unknown>;
  const email = (text(b.email, 254) ?? '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'A valid email is required' };
  const roleId = text(b.roleId, 64);
  if (!roleId) return { ok: false, status: 400, error: 'Choose a role' };
  const firstName = text(b.firstName, 100) ?? '';
  const lastName = text(b.lastName, 100) ?? '';
  if (opts.requireName && (!firstName || !lastName)) return { ok: false, status: 400, error: 'First and last name are required' };
  const departmentId = text(b.departmentId, 64);
  if (departmentId && !UUID.test(departmentId)) return { ok: false, status: 400, error: 'Department not found in this company' };
  let moduleAccess: AccessMask | null;
  try {
    moduleAccess = parseAccessMask(b.moduleAccess ?? null);
  } catch (e) {
    return { ok: false, status: 400, error: e instanceof Error ? e.message : 'Invalid module access' };
  }
  return {
    ok: true,
    value: {
      email,
      username: text(b.username, 100) ?? email,
      firstName,
      lastName,
      mobileNumber: text(b.mobileNumber, 40),
      position: text(b.position, 100),
      userType: text(b.userType, 40) ?? 'STAFF',
      roleId,
      departmentId,
      moduleAccess,
    },
  };
}

interface Prepared {
  tenant: { id: string; name: string; plan: string | null };
  role: { id: string; code: string; name: string };
  departmentId: string | null;
  mask: AccessMask | null;
}

/** The checks both ways share. Runs in platform context (roles and memberships are RLS-protected). */
async function prepare(
  tx: Tx,
  headers: Headers,
  tenantId: string,
  m: NewMember,
  countPendingInvites: boolean,
): Promise<{ ok: true; value: Prepared } | Failure> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, plan: true, isActive: true } });
  if (!tenant || !tenant.isActive) return { ok: false, status: 400, error: 'Company not found or inactive' };

  const role = await tx.role.findFirst({
    where: { id: m.roleId, OR: [{ tenantId }, { tenantId: null }] },
    select: { id: true, code: true, name: true },
  });
  if (!role) return { ok: false, status: 400, error: 'Role not found for this company' };
  if (role.code === 'SUPER_ADMIN' && !isSuperAdmin(headers)) {
    return { ok: false, status: 403, error: 'Only a platform administrator can grant the Super Admin role' };
  }

  if (m.departmentId) {
    const dept = await tx.department.findFirst({ where: { id: m.departmentId, tenantId }, select: { id: true } });
    if (!dept) return { ok: false, status: 400, error: 'Department not found in this company' };
  }

  const member = await tx.userTenant.findFirst({
    where: { tenantId, isActive: true, user: { email: { equals: m.email, mode: 'insensitive' } } },
    select: { id: true },
  });
  if (member) return { ok: false, status: 409, error: `${m.email} is already a member of ${tenant.name}` };

  // The plan's user limit: active members, plus open invitations when inviting.
  const active = await tx.userTenant.count({ where: { tenantId, isActive: true } });
  let pending = 0;
  if (countPendingInvites) {
    const rows = await tx.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT COUNT(*)::bigint AS c FROM tenant_invitations
        WHERE tenant_id = $1 AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
      tenantId,
    );
    pending = Number(rows[0]?.c ?? 0);
  }
  const plan = tenant.plan ?? 'TRIAL';
  const limit = getLimits(plan).maxUsers;
  if (active + pending >= limit) {
    return { ok: false, status: 402, error: `The ${plan} plan is limited to ${limit} users (currently ${active + pending}). Upgrade in Admin › Billing.` };
  }

  const effective = await getEffectiveRoleById(tx as never, tenantId, role.id);
  const mask = narrowToRole(m.moduleAccess, roleAccessByModule(permissionsForEffectiveRole(effective)));
  return { ok: true, value: { tenant, role, departmentId: m.departmentId, mask } };
}

export type InviteResult =
  | { ok: true; emailed: boolean; reason?: string; acceptUrl?: string }
  | Failure;

/** Sends an invitation carrying the role, department, module access and profile. */
export async function inviteMember(
  headers: Headers,
  tenantId: string,
  actor: { userId: string; name?: string | null; email?: string | null },
  m: NewMember,
): Promise<InviteResult> {
  const saved = await withPlatformAdmin(prisma, async (tx) => {
    const p = await prepare(tx, headers, tenantId, m, true);
    if (!p.ok) return p;
    // One live invitation per email and company.
    await tx.$executeRawUnsafe(
      `UPDATE tenant_invitations SET revoked = TRUE
        WHERE tenant_id = $1 AND LOWER(email) = $2 AND used_at IS NULL AND revoked = FALSE AND expires_at > NOW()`,
      tenantId, m.email,
    );
    const { token, hash } = generateInvitationToken();
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_invitations
         (tenant_id, email, role_id, token_hash, invited_by_user_id, expires_at,
          first_name, last_name, mobile_number, position, department_id, module_access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::jsonb)`,
      tenantId, m.email, p.value.role.id, hash, actor.userId,
      new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      m.firstName || null, m.lastName || null, m.mobileNumber, m.position,
      p.value.departmentId, p.value.mask ? JSON.stringify(p.value.mask) : null,
    );
    return { ok: true as const, token, prepared: p.value };
  });
  if (!saved.ok) return saved;

  const acceptUrl = appUrl(`/invitation/${encodeURIComponent(saved.token)}`);
  // In the company's wording, name and language (Admin > Email templates).
  const send = await sendTemplatedEmail({
    tenantId,
    key: 'account.user_invitation',
    to: m.email,
    ...(actor.email ? { replyTo: actor.email } : {}),
    values: {
      roleName: saved.prepared.role.name,
      invitedBy: actor.name ?? actor.email ?? '',
      acceptUrl,
      validDays: String(INVITATION_TTL_DAYS),
    },
  });
  void logAudit({
    tenantId, tenantName: saved.prepared.tenant.name,
    userId: actor.userId,
    userRole: headers.get('x-user-role') ?? 'TENANT_ADMIN',
    entityType: 'Invitation',
    entityName: m.email,
    action: 'CREATE',
    details: `Invitation sent to ${m.email} as ${saved.prepared.role.name}`
      + (saved.prepared.mask ? `, module access narrowed (${Object.keys(saved.prepared.mask).join(', ')})` : '')
      + `. Email send: ${send.sent ? 'OK' : `failed (${send.reason ?? 'unknown'})`}.`,
  });
  return {
    ok: true,
    emailed: send.sent,
    ...(send.sent ? {} : { reason: send.reason, acceptUrl }), // shown when email is not configured
  };
}

export type CreateResult = { ok: true; userId: string; existingAccount: boolean } | Failure;

/** Creates the account now with a password, or adds an existing account (platform admins only). */
export async function createMember(
  headers: Headers,
  tenantId: string,
  actor: { userId: string },
  m: NewMember,
  password: string,
): Promise<CreateResult> {
  const result = await withPlatformAdmin(prisma, async (tx): Promise<CreateResult> => {
    const p = await prepare(tx, headers, tenantId, m, false);
    if (!p.ok) return p;

    const existing = await tx.user.findFirst({
      where: { email: { equals: m.email, mode: 'insensitive' } },
      select: { id: true, isActive: true },
    });
    let userId: string;
    if (existing) {
      if (!isSuperAdmin(headers)) {
        return { ok: false, status: 409, error: `${m.email} already has an account. Send an invitation instead: they accept it with their own password.` };
      }
      if (!existing.isActive) return { ok: false, status: 409, error: `${m.email} has a disabled account. Enable it in Admin › Users first.` };
      userId = existing.id;
    } else {
      const check = validatePassword(password, { email: m.email, username: m.username }, DEFAULT_PASSWORD_POLICY);
      if (!check.ok) return { ok: false, status: 400, error: 'The password does not meet the policy', errors: check.errors };
      userId = crypto.randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          username: m.username,
          email: m.email,
          firstName: m.firstName,
          lastName: m.lastName,
          mobileNumber: m.mobileNumber,
          position: m.position,
          userType: m.userType,
          isActive: true,
          updatedAt: new Date(),
        },
      });
      await tx.$executeRawUnsafe(`UPDATE "User" SET password_hash = $1 WHERE id = $2`, hashPassword(password), userId);
    }

    const membership = {
      roleId: p.value.role.id,
      isActive: true,
      departmentId: p.value.departmentId,
      moduleAccess: p.value.mask ?? Prisma.DbNull,
    };
    // A membership left inactive (removed earlier) is reactivated.
    await tx.userTenant.upsert({
      where: { userId_tenantId: { userId, tenantId } },
      update: membership,
      create: { userId, tenantId, ...membership },
    });
    void logAudit({
      tenantId, tenantName: p.value.tenant.name,
      userId: actor.userId,
      userRole: headers.get('x-user-role') ?? 'TENANT_ADMIN',
      entityType: 'User',
      entityId: userId,
      entityName: m.email,
      action: 'CREATE',
      details: `${existing ? 'Existing account added' : 'User created'} as ${p.value.role.name}`
        + (p.value.mask ? `, module access narrowed (${Object.keys(p.value.mask).join(', ')})` : '') + '.',
    });
    return { ok: true, userId, existingAccount: !!existing };
  });
  if (result.ok) revalidateCache(['users:list']);
  return result;
}
