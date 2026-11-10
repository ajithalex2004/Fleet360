/**
 * Unified Identity Link (User.id <-> Driver.id Foreign Key) & Safe Login Resolution.
 *
 * Determines which login account (`public."User"`) a driver profile (`public.drivers`)
 * links to via the explicit `drivers.user_id` foreign key, with fallback resolution
 * by UUID parity, email, or employeeId for legacy records (and automatic self-healing
 * of `drivers.user_id`).
 *
 * Security invariant:
 * An existing account is linkable only when it is plainly this tenant's
 * driver login: a DRIVER-type user whose every membership is in this
 * tenant, with a driver role (or none). Any other match is a conflict: the
 * route refuses and touches nothing.
 */
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

export interface DriverLoginLookup {
  /** The driver profile's id: an account created for it has this id. */
  driverId?: string;
  /** Explicit foreign key (`drivers.user_id`) if already linked. */
  userId?: string | null;
  email?: string | null;
  username?: string | null;
  employeeId?: string | null;
  mobileNumber?: string | null;
}

export type LinkableUser = {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  mobileNumber: string | null;
  employeeId: string | null;
  hierarchy: string | null;
  position: string | null;
};

export type DriverLoginMatch =
  | { kind: 'none' }
  | { kind: 'linkable'; user: LinkableUser }
  | { kind: 'conflict'; message: string };

/** Minimal client for a raw query: prisma or a transaction. */
type RawQueryClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<unknown>;
};

/**
 * Resolves the driver profile (`drivers.id`) for a signed-in user in this tenant.
 *
 * Priority order:
 * 1. Explicit `drivers.user_id = user.id` foreign key (O(1) index scan on `idx_drivers_tenant_user_id`)
 * 2. Direct UUID parity (`drivers.id = user.id`)
 * 3. Exact tenant-scoped email or employeeId match (only for `userType === 'DRIVER'`),
 *    with automatic self-healing of `drivers.user_id` when matched unambiguously.
 */
export async function matchDriverProfileForUser(
  db: RawQueryClient,
  tenantId: string,
  user: { id: string; userType?: string | null; email?: string | null; employeeId?: string | null },
): Promise<string | null> {
  if ((user.userType ?? '').toUpperCase() !== 'DRIVER') return null;

  const rows = await db.$queryRawUnsafe<Array<{ id: string; user_id?: string | null }>>(
    `SELECT id::text AS id, user_id
       FROM drivers
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND (
          user_id = $2
          OR id::text = $2
          OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3))
          OR ($4::text IS NOT NULL AND employee_id IS NOT NULL AND LOWER(employee_id) = LOWER($4))
        )
      ORDER BY
        (user_id = $2) DESC,
        (id::text = $2) DESC,
        (LOWER(COALESCE(email, '')) = LOWER(COALESCE($3, ''))) DESC
      LIMIT 2`,
    tenantId,
    user.id,
    user.email?.trim() || null,
    user.employeeId?.trim() || null,
  );
  if (rows.length === 0) return null;

  const top = rows[0];
  const unambiguous = top.user_id === user.id || top.id === user.id || rows.length === 1;
  if (!unambiguous) return null;

  // Self-heal `drivers.user_id` if resolved via legacy fallback and `user_id` is not yet populated
  if (top.user_id !== user.id && typeof db.$executeRawUnsafe === 'function') {
    await db
      .$executeRawUnsafe(
        `UPDATE drivers
            SET user_id = $1,
                updated_at = NOW()
          WHERE id::text = $2
            AND tenant_id = $3
            AND user_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM drivers d2
              WHERE d2.user_id = $1 AND d2.deleted_at IS NULL
            )`,
        user.id,
        top.id,
        tenantId,
      )
      .catch(() => null);
  }

  return top.id;
}

/**
 * Enforces `drivers.user_id = userId` synchronization inside an active transaction.
 */
export async function syncDriverUserForeignKey(
  db: RawQueryClient,
  params: { tenantId: string; driverId: string; userId: string },
): Promise<void> {
  if (typeof db.$executeRawUnsafe !== 'function') return;
  await db.$executeRawUnsafe(
    `UPDATE drivers
        SET user_id = $1,
            updated_at = NOW()
      WHERE id::text = $2
        AND tenant_id = $3
        AND (user_id IS NULL OR user_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM drivers d2
          WHERE d2.user_id = $1
            AND d2.id::text <> $2
            AND d2.deleted_at IS NULL
        )`,
    params.userId,
    params.driverId,
    params.tenantId,
  );
}

const isDriverRole = (role: { code: string | null; name: string | null } | null) =>
  !role || (role.code ?? '').toUpperCase() === 'DRIVER' || /driver/i.test(role.name ?? '');

export async function findLinkableDriverUser(tenantId: string, lookup: DriverLoginLookup): Promise<DriverLoginMatch> {
  const or: Array<Record<string, unknown>> = [];
  if (lookup.userId?.trim()) or.push({ id: lookup.userId.trim() });
  if (lookup.driverId) or.push({ id: lookup.driverId });
  if (lookup.email?.trim()) or.push({ email: { equals: lookup.email.trim(), mode: 'insensitive' } });
  if (lookup.username?.trim()) or.push({ username: { equals: lookup.username.trim(), mode: 'insensitive' } });
  if (lookup.employeeId?.trim()) or.push({ employeeId: lookup.employeeId.trim() });
  if (lookup.mobileNumber?.trim()) or.push({ mobileNumber: lookup.mobileNumber.trim() });
  if (or.length === 0) return { kind: 'none' };

  const users = await withPlatformAdmin(prisma, (tx) =>
    tx.user.findMany({
      where: { OR: or },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        mobileNumber: true,
        employeeId: true,
        hierarchy: true,
        position: true,
        userType: true,
        userTenants: { select: { tenantId: true, role: { select: { code: true, name: true } } } },
      },
      take: 5,
    }),
  );
  if (users.length === 0) return { kind: 'none' };

  const safe = (u: (typeof users)[number]) =>
    (u.userType ?? '').toUpperCase() === 'DRIVER' &&
    u.userTenants.every((m) => m.tenantId === tenantId && isDriverRole(m.role));

  // Every account the details match must be safe; one that is not means the
  // details belong to someone else, so nothing is linked or changed.
  const unsafe = users.find((u) => !safe(u));
  if (unsafe) {
    return {
      kind: 'conflict',
      message:
        'That email, username, employee ID or mobile number belongs to an existing account that is not a driver login of this organisation. Use different details, or manage that account in User Management.',
    };
  }
  if (users.length > 1) {
    return { kind: 'conflict', message: 'Those details match more than one driver login. Use a unique email, username and employee ID.' };
  }
  const { userType: _t, userTenants: _m, ...user } = users[0];
  void _t;
  void _m;
  return { kind: 'linkable', user };
}
