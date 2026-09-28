/**
 * Revoking sessions: every session issued before now becomes invalid for a
 * scope, within REVOCATION_RECHECK_MS (60 s) everywhere.
 *
 *   revokeSessions({ userId })            the user, in every tenant
 *                                         (deactivated, password reset,
 *                                         sign out everywhere)
 *   revokeSessions({ userId, tenantId })  the user in one tenant (role
 *                                         changed, membership removed)
 *   revokeSessions({ tenantId })          everyone in a tenant (a tenant
 *                                         role's permissions changed, the
 *                                         tenant was deactivated)
 *
 * The durable record is session_revocations (read by the Go backend's auth
 * middleware); Redis mirrors it for the edge middleware
 * (src/lib/auth/revocation-check.ts). Each revocation is audited.
 *
 * Revoked users sign in again and get a session with their current role and
 * permissions. Call after the change is committed, never inside a
 * transaction that could still roll back.
 */
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { getRedis } from '@/lib/upstash';
import { logAudit } from '@/lib/audit';
import { clearRevocationCache, revocationKeys } from '@/lib/auth/revocation-check';

/** Mirror keys outlive every session they could revoke (24 h lifetime). */
const MIRROR_TTL_SECONDS = 25 * 60 * 60;

export interface RevocationScope {
  userId?: string | null;
  tenantId?: string | null;
  /** Why, for the audit trail: 'role-changed', 'user-deactivated', … */
  reason: string;
  /** Who did it (user id), when known. */
  revokedBy?: string | null;
}

function mirrorKey(userId: string | null, tenantId: string | null): string {
  if (userId && tenantId) return revocationKeys(userId, tenantId)[2];
  if (userId) return revocationKeys(userId, '_')[0];
  return revocationKeys('_', tenantId as string)[1];
}

export async function revokeSessions(scope: RevocationScope): Promise<void> {
  const userId = scope.userId || null;
  const tenantId = scope.tenantId || null;
  if (!userId && !tenantId) throw new Error('revokeSessions needs a userId, a tenantId or both');
  const notBefore = new Date();

  await withPlatformAdmin(prisma, (tx) => tx.$executeRawUnsafe(
    `INSERT INTO session_revocations (user_id, tenant_id, not_before, reason, revoked_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ((COALESCE(user_id, '')), (COALESCE(tenant_id, '')))
     DO UPDATE SET not_before = EXCLUDED.not_before, reason = EXCLUDED.reason,
                   revoked_by = EXCLUDED.revoked_by, created_at = now()`,
    userId, tenantId, notBefore, scope.reason, scope.revokedBy ?? null,
  ));

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(mirrorKey(userId, tenantId), notBefore.getTime(), { ex: MIRROR_TTL_SECONDS });
    } catch (err) {
      console.error('[revocation] Redis mirror write failed; the edge check will miss this revocation:', err);
    }
  } else {
    console.warn('[revocation] Redis not configured: revocation reaches the Go backend only; Next.js sessions stay valid until they expire');
  }
  clearRevocationCache();

  await logAudit({
    tenantId: tenantId ?? undefined,
    entityType: 'Session',
    entityId: userId ?? undefined,
    action: 'UPDATE',
    details: `Revoked sessions ${userId ? `of user ${userId}` : 'of every user'}${tenantId ? ` in tenant ${tenantId}` : ' in every tenant'} (${scope.reason})`,
    userId: scope.revokedBy ?? undefined,
  });
}

/** revokeSessions that never throws: for request paths where the change itself already succeeded. */
export async function revokeSessionsSafely(scope: RevocationScope): Promise<boolean> {
  try {
    await revokeSessions(scope);
    return true;
  } catch (err) {
    console.error(`[revocation] failed to revoke sessions (${scope.reason}):`, err);
    return false;
  }
}

/** Who a change to a role affects: its tenant, or (a platform role) every user holding it. */
export type RoleHolders = { tenantId: string } | { userIds: string[] } | null;

/**
 * Read before changing or deleting a role. A tenant's role affects that
 * tenant's sessions; a platform role affects every user assigned it.
 */
export async function holdersOfRole(roleId: string): Promise<RoleHolders> {
  return withPlatformAdmin(prisma, async (tx) => {
    const role = await tx.role.findUnique({ where: { id: roleId }, select: { tenantId: true } });
    if (!role) return null;
    if (role.tenantId) return { tenantId: role.tenantId };
    const holders = await tx.userTenant.findMany({ where: { roleId }, select: { userId: true } });
    return { userIds: [...new Set(holders.map((h) => h.userId))] };
  });
}

/** Revoke the sessions of a role's holders (from holdersOfRole) after the change. */
export async function revokeRoleHolders(holders: RoleHolders, reason: string, revokedBy?: string | null): Promise<void> {
  if (!holders) return;
  if ('tenantId' in holders) {
    await revokeSessionsSafely({ tenantId: holders.tenantId, reason, revokedBy });
    return;
  }
  for (const userId of holders.userIds) {
    await revokeSessionsSafely({ userId, reason, revokedBy });
  }
}
