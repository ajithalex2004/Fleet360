/**
 * Shipper Portal — portal-user CRUD.
 *
 * Mirrors the data-master lib style (raw SQL via $queryRawUnsafe so the
 * lazy-init schema doesn't require a Prisma migration). All queries are
 * tenant-scoped — there is no path to read or write a portal user across
 * tenant boundaries.
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
  isActive: boolean;
  role: PortalRole;
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
  role: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `id::text, tenant_id, customer_id, email, full_name, phone,
  password_hash, is_active, role,
  last_login_at::text, created_at::text, updated_at::text`;

function rowToApi(r: Row): PortalUser {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id,
    email: r.email,
    fullName: r.full_name,
    phone: r.phone,
    hasPassword: !!r.password_hash,
    isActive: r.is_active,
    role: (r.role as PortalRole) ?? 'SHIPPER_USER',
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

export async function createPortalUser(args: {
  tenantId: string;
  customerId: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role?: PortalRole;
}): Promise<PortalUser> {
  const rows = await inTenant(args.tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `INSERT INTO customer_portal_users
         (tenant_id, customer_id, email, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SELECT}`,
      args.tenantId,
      args.customerId,
      args.email.toLowerCase().trim(),
      args.fullName?.trim() ?? null,
      args.phone?.trim() ?? null,
      args.role ?? 'SHIPPER_USER',
  ));
  if (!rows[0]) throw new Error('createPortalUser returned no row');
  return rowToApi(rows[0]);
}

export async function getPortalUserById(tenantId: string, id: string): Promise<PortalUser | null> {
  const rows = await inTenant(tenantId, (tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM customer_portal_users
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
  ));
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Find a portal user by email (case-insensitive) across tenants. Used
 *  on login when we don't yet know the tenant — caller must check that
 *  the returned user's tenant matches the requested tenant. */
export async function findPortalUserByEmail(email: string): Promise<PortalUser | null> {
  const rows = await acrossTenants((tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM customer_portal_users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      email.trim(),
  ));
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Returns the row INCLUDING the password hash. Internal only — never
 *  return the hash via API. */
export async function _findUserWithHashByEmail(email: string): Promise<(PortalUser & { passwordHash: string | null }) | null> {
  const rows = await acrossTenants((tx) => tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM customer_portal_users
        WHERE lower(email) = lower($1) AND deleted_at IS NULL
        ORDER BY created_at DESC
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
      `SELECT ${SELECT} FROM customer_portal_users
        WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
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
