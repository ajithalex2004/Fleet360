import type { TxClient } from '@/lib/rls';

/** Resolve staff from the verified account and active membership, not a body ID.
 * User.employeeId is the existing account-to-workforce identifier. No email
 * guessing or administrator override is allowed for personal subscriptions.
 */
export async function resolvePushStaff(tx: TxClient, session: { userId: string; tenantId: string }) {
  const membership = await tx.userTenant.findFirst({
    where: {
      userId: session.userId, tenantId: session.tenantId, isActive: true,
      user: { isActive: true }, tenant: { isActive: true },
    },
    select: { user: { select: { employeeId: true } } },
  });
  if (!membership?.user.employeeId) return null;
  return tx.staffMember.findFirst({
    where: {
      tenantId: session.tenantId, employeeId: membership.user.employeeId,
      deletedAt: null, isActive: true,
    },
    select: { id: true, tenantId: true, employeeId: true },
  });
}
