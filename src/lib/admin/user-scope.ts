/**
 * Which users a company administrator may manage (Admin > Users).
 *
 * Users are platform-wide accounts; a company administrator acts only on
 * members of their own company:
 *   'member'   their profile in this company (names, department, reporting
 *              lines): the user must be a member of the caller's company;
 *   'account'  the account itself (email, username, password, active,
 *              module access), which every company the user belongs to
 *              shares: the user must belong to the caller's company only
 *              and must not be a platform administrator.
 * Platform administrators (SUPER_ADMIN) may manage any user.
 */
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { isSuperAdmin } from '@/lib/admin-access';

type Tx = Prisma.TransactionClient;

export async function userScopeDenied(
  tx: Tx, headers: Headers, tenantId: string, userId: string, need: 'member' | 'account',
): Promise<NextResponse | null> {
  if (isSuperAdmin(headers)) return null;
  const memberships = await tx.userTenant.findMany({
    where: { userId },
    select: { tenantId: true, role: { select: { code: true } } },
  });
  // Not in the caller's company: as if the user didn't exist.
  if (!memberships.some((m) => m.tenantId === tenantId)) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (need === 'account') {
    if (memberships.some((m) => m.role.code.toUpperCase() === 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Only a platform administrator can change a platform administrator\'s account' }, { status: 403 });
    }
    if (memberships.some((m) => m.tenantId !== tenantId)) {
      return NextResponse.json({
        error: 'This user also belongs to another company: only a platform administrator can change their email, username, password, status or module access',
      }, { status: 403 });
    }
  }
  return null;
}

/**
 * A reporting-line value from a request: a user id who is an active member
 * of `tenantId` and not the user themselves; '' or null clears it.
 */
export async function reportingLineValue(
  tx: Tx, tenantId: string, userId: string, value: unknown, label: string,
): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a user` };
  if (value === userId) return { ok: false, error: `A user cannot be their own ${label.toLowerCase()}` };
  const member = await tx.userTenant.findFirst({
    where: { tenantId, userId: value, isActive: { not: false } },
    select: { id: true },
  });
  if (!member) return { ok: false, error: `${label} must be an active user of this company` };
  return { ok: true, value };
}
