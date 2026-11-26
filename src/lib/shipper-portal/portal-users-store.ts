/**
 * Shipper Portal — portal-user CRUD.
 *
 * Mirrors the data-master lib style (raw SQL via $queryRawUnsafe so the
 * lazy-init schema doesn't require a Prisma migration). All queries are
 * tenant-scoped — there is no path to read or write a portal user across
 * tenant boundaries.
 *
 * Accounts are shared with the FSM Customer Portal (one account per person
 * per tenant, src/lib/customer-portal/users.ts). An account may use this
 * portal when it holds a TRANSPORT role (customer_portal_user_roles) and its
 * customer has the Transport portal with the LOGISTICS category
 * (customer_portal_access). ADMIN maps to SHIPPER_ADMIN, the other roles to
 * SHIPPER_USER; VIEWER cannot submit shipping requests.
 */

import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls, type TxClient } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';

// ── Types ──────────────────────────────────────────────────────────────────

export type PortalRole = 'SHIPPER_USER' | 'SHIPPER_ADMIN';

export interface PortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  /** True once an invitation has been accepted and a password set. */
  hasPassword: boolean;
  /** Account active, holds a Transport role, and the customer has Logistics. */
  isActive: boolean;
  role: PortalRole;
  /** The account's Transport portal role (null: no Transport access). */
  transportRole: 'ADMIN' | 'REQUESTER' | 'FINANCE' | 'VIEWER' | null;
  /** The account itself is active (not deactivated by staff). */
  accountActive: boolean;
  /** The customer has the Transport portal with the Logistics category. */
  logisticsEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  customer_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  password_hash: string | null;
  is_active: boolean;
  transport_role: string | null;
  logistics_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The account (u) with its Transport role (r, may be missing). */
const FROM = `customer_portal_users u
  LEFT JOIN customer_portal_user_roles r ON r.portal_user_id = u.id AND r.portal = 'TRANSPORT'`;

const SELECT = `u.id::text, u.tenant_id, u.customer_id, u.email, u.full_name, u.phone,
  u.password_hash, u.is_active, r.role AS transport_role,
  EXISTS (SELECT 1 FROM customer_portal_access a
           WHERE a.tenant_id = u.tenant_id AND a.customer_id = u.customer_id
             AND a.portal = 'TRANSPORT' AND 'LOGISTICS' = ANY (a.categories)) AS logistics_enabled,
  u.last_login_at::text, u.created_at::text, u.updated_at::text`;

/** Stored in the legacy, unread role column of new accounts (it is NOT NULL). */
const LEGACY_ROLE_VALUE = 'CUSTOMER_PORTAL';

function transportRoleOf(v: string | null): PortalUser['transportRole'] {
  return v === 'ADMIN' || v === 'REQUESTER' || v === 'FINANCE' || v === 'VIEWER' ? v : null;
}

function rowToApi(r: Row): PortalUser {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id,
    email: r.email,
    fullName: r.full_name,
    phone: r.phone,
    hasPassword: !!r.password_hash,
    isActive: r.is_active && transportRoleOf(r.transport_role) !== null && r.logistics_enabled,
    role: r.transport_role === 'ADMIN' ? 'SHIPPER_ADMIN' : 'SHIPPER_USER',
    transportRole: transportRoleOf(r.transport_role),
    accountActive: r.is_active,
    logisticsEnabled: r.logistics_enabled,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── RLS scope ──────────────────────────────────────────────────────────────
//
// customer_portal_users is under FORCE ROW LEVEL SECURITY, and the portal's routes are
// public: the middleware sets no request tenant, so a bare prisma query ran
// with app.tenant_id unset and RLS returned no rows. Every login, invitation
// and session check failed. Each query now runs in a scope: the tenant's
// when it is known, the platform's only for the lookups that establish who
// the user is (by email, before any tenant is known), in a transaction of
// their own so they never widen a caller's tenant transaction.

function inTenant<T>(tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return withTenantRls(prisma, tenantId, fn);
}

function acrossTenants<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return runOutsideRlsScope(() => withPlatformAdmin(prisma, fn));
}

// ── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Creates the account with a Transport role (SHIPPER_ADMIN -> ADMIN, else
 * REQUESTER), or gives an existing account of the same customer that role.
 * Inviting a shipper also turns on the customer's Transport portal with the
 * Logistics category, so the account can sign in here.
 */
export async function createPortalUser(args: {
  tenantId: string;
  customerId: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role?: PortalRole;
  invitedByUserId?: string | null;
}): Promise<PortalUser> {
  const transportRole = args.role === 'SHIPPER_ADMIN' ? 'ADMIN' : 'REQUESTER';
  const rows = await inTenant(args.tenantId, async (tx) => {
    const [existing] = await tx.$queryRawUnsafe<Array<{ id: string; customer_id: string }>>(
      `SELECT id::text, customer_id FROM customer_portal_users
        WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL LIMIT 1`,
      args.tenantId, args.email.trim(),
    );
    if (existing && existing.customer_id !== args.customerId) {
      // Same signal callers already handle for a duplicate email.
      throw Object.assign(new Error('Portal account belongs to another customer'), { code: '23505' });
    }
    let id = existing?.id;
    if (!id) {
      const [created] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO customer_portal_users
           (tenant_id, customer_id, email, full_name, phone, role, invited_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id::text`,
        args.tenantId,
        args.customerId,
        args.email.toLowerCase().trim(),
        args.fullName?.trim() ?? null,
        args.phone?.trim() ?? null,
        LEGACY_ROLE_VALUE,
        args.invitedByUserId ?? null,
      );
      id = created.id;
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO customer_portal_user_roles (tenant_id, portal_user_id, portal, role, granted_by_user_id)
       VALUES ($1, $2::uuid, 'TRANSPORT', $3, $4)
       ON CONFLICT (portal_user_id, portal) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      args.tenantId, id, transportRole, args.invitedByUserId ?? null,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO customer_portal_access (tenant_id, customer_id, portal, enabled_by, categories)
       VALUES ($1, $2, 'TRANSPORT', $3, ARRAY['LOGISTICS']::text[])
       ON CONFLICT (tenant_id, customer_id, portal) DO UPDATE
         SET categories = CASE WHEN 'LOGISTICS' = ANY (customer_portal_access.categories)
                               THEN customer_portal_access.categories
                               ELSE customer_portal_access.categories || ARRAY['LOGISTICS']::text[] END`,
      args.tenantId, args.customerId, args.invitedByUserId ?? 'shipper-portal-invite',
    );
    // The Customer Portal shows Logistics only if the tenant offers it (Transport
    // catalogue); a tenant that has switched it off keeps it off.
    await tx.$executeRawUnsafe(
      `INSERT INTO tenant_transport_categories (tenant_id, category, enabled, updated_by)
       VALUES ($1, 'LOGISTICS', TRUE, $2) ON CONFLICT (tenant_id, category) DO NOTHING`,
      args.tenantId, args.invitedByUserId ?? 'shipper-portal-invite',
    );
    return tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM} WHERE u.id = $1::uuid AND u.tenant_id = $2`, id, args.tenantId,
    );
  });
  if (!rows[0]) throw new Error('createPortalUser returned no row');
  return rowToApi(rows[0]);
}

export async function getPortalUserById(tenantId: string, id: string): Promise<PortalUser | null> {
  const rows = await inTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE u.id = $1::uuid AND u.tenant_id = $2 AND u.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
  ));
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Find a portal user by email (case-insensitive) across tenants. Used
 *  on login when we don't yet know the tenant — caller must check that
 *  the returned user's tenant matches the requested tenant. */
export async function findPortalUserByEmail(email: string, tenantId?: string): Promise<PortalUser | null> {
  if (tenantId) {
    const rows = await inTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE lower(u.email) = lower($1) AND u.tenant_id = $2 AND u.deleted_at IS NULL
        ORDER BY (u.password_hash IS NOT NULL AND u.is_active = TRUE) DESC, u.created_at DESC
        LIMIT 1`,
      email.trim(), tenantId,
    ));
    return rows[0] ? rowToApi(rows[0]) : null;
  }
  const rows = await acrossTenants((tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL
        ORDER BY (u.password_hash IS NOT NULL AND u.is_active = TRUE AND r.role IS NOT NULL) DESC, u.created_at DESC
        LIMIT 1`,
      email.trim(),
  ));
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Returns the row INCLUDING the password hash. Internal only — never
 *  return the hash via API. Prioritizes active rows with a password hash
 *  set so an unaccepted invite in a second tenant cannot shadow an active
 *  portal user during login. */
export async function _findUserWithHashByEmail(
  email: string,
  tenantId?: string,
): Promise<(PortalUser & { passwordHash: string | null }) | null> {
  if (tenantId) {
    const rows = await inTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE lower(u.email) = lower($1) AND u.tenant_id = $2 AND u.deleted_at IS NULL
        ORDER BY (u.password_hash IS NOT NULL AND u.is_active = TRUE) DESC, u.created_at DESC
        LIMIT 1`,
      email.trim(), tenantId,
    ));
    if (!rows[0]) return null;
    return { ...rowToApi(rows[0]), passwordHash: rows[0].password_hash };
  }
  const rows = await acrossTenants((tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL
        ORDER BY (u.password_hash IS NOT NULL AND u.is_active = TRUE AND r.role IS NOT NULL) DESC, u.created_at DESC
        LIMIT 1`,
      email.trim(),
  ));
  if (!rows[0]) return null;
  return { ...rowToApi(rows[0]), passwordHash: rows[0].password_hash };
}

export async function listPortalUsersByCustomer(
  tenantId: string,
  customerId: string,
): Promise<PortalUser[]> {
  const rows = await inTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM ${FROM}
        WHERE u.tenant_id = $1 AND u.customer_id = $2 AND u.deleted_at IS NULL
          AND r.role IS NOT NULL
        ORDER BY u.created_at DESC`,
      tenantId, customerId,
  ));
  return rows.map(rowToApi);
}

export async function setPortalUserPassword(
  tenantId: string,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await inTenant(tenantId, (tx) => tx.$executeRawUnsafe(
      `UPDATE customer_portal_users
          SET password_hash = $1, updated_at = NOW()
        WHERE id = $2::uuid AND tenant_id = $3`,
      passwordHash, userId, tenantId,
  ));
}

export async function markPortalUserLoggedIn(tenantId: string, userId: string): Promise<void> {
  await inTenant(tenantId, (tx) => tx.$executeRawUnsafe(
      `UPDATE customer_portal_users
          SET last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2`,
      userId, tenantId,
  ));
}

export async function setPortalUserActive(
  tenantId: string,
  userId: string,
  isActive: boolean,
): Promise<boolean> {
  const result = await inTenant(tenantId, (tx) => tx.$executeRawUnsafe(
      `UPDATE customer_portal_users
          SET is_active = $1, updated_at = NOW()
        WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL`,
      isActive, userId, tenantId,
  ));
  return Number(result) > 0;
}

/** Soft-delete — preserves audit trail on shipments. */
export async function deletePortalUser(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const result = await inTenant(tenantId, (tx) => tx.$executeRawUnsafe(
      `UPDATE customer_portal_users
          SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      userId, tenantId,
  ));
  return Number(result) > 0;
}
