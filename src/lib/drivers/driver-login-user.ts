/**
 * Which login account a driver profile may link to, and have its password
 * set by, from the Driver Hub (POST /api/drivers, PUT/PATCH /api/drivers/[id]).
 *
 * Those routes used to look up an existing User by email, username,
 * employee id or mobile number across the whole platform and then
 * overwrite that user's password with the one in the request. Anyone who
 * could create a driver in their own tenant could put another person's email
 * (a platform admin's, say) on a "driver" with a password of their choosing
 * and sign in as them.
 *
 * An existing account is linkable only when it is plainly this tenant's
 * driver login: a DRIVER-type user whose every membership is in this
 * tenant, with a driver role (or none). Any other match is a conflict: the
 * route refuses and touches nothing. The read uses the platform context,
 * because tenant RLS would hide the memberships in other tenants that make
 * an account unsafe.
 */
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

export interface DriverLoginLookup {
  /** The driver profile's id: an account created for it has this id. */
  driverId?: string;
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
};

/**
 * The driver profile a signed-in user may act as, in this tenant: the
 * reverse direction of findLinkableDriverUser, used by login and the driver
 * app's vehicle login to mint a DRIVER session.
 *
 * Only a DRIVER-type account, and only by the same id, the exact email or
 * the employee id. Matching by name, username or a licence number derived
 * from the username let a staff user who shared a driver's name (or set
 * their username to a driver's email prefix) be signed in as that driver.
 */
export async function matchDriverProfileForUser(
  db: RawQueryClient,
  tenantId: string,
  user: { id: string; userType?: string | null; email?: string | null; employeeId?: string | null },
): Promise<string | null> {
  if ((user.userType ?? '').toUpperCase() !== 'DRIVER') return null;
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
       FROM drivers
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND (
          id::text = $2
          OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3))
          OR ($4::text IS NOT NULL AND employee_id IS NOT NULL AND LOWER(employee_id) = LOWER($4))
        )
      ORDER BY (id::text = $2) DESC, (LOWER(COALESCE(email, '')) = LOWER(COALESCE($3, ''))) DESC
      LIMIT 2`,
    tenantId,
    user.id,
    user.email?.trim() || null,
    user.employeeId?.trim() || null,
  );
  if (rows.length === 0) return null;
  // The same id is unambiguous; otherwise two matches mean the details are shared.
  if (rows[0].id === user.id || rows.length === 1) return rows[0].id;
  return null;
}

const isDriverRole = (role: { code: string | null; name: string | null } | null) =>
  !role || (role.code ?? '').toUpperCase() === 'DRIVER' || /driver/i.test(role.name ?? '');

export async function findLinkableDriverUser(tenantId: string, lookup: DriverLoginLookup): Promise<DriverLoginMatch> {
  const or: Array<Record<string, unknown>> = [];
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
