/**
 * B2B RAC Portal — portal-user CRUD (`rac_portal_users`).
 *
 * Mirrors `src/lib/leasing-portal/portal-users-store.ts` 1:1, scoped to
 * corporate B2B `rental_customers` under `FORCE ROW LEVEL SECURITY`.
 */

import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls, type TxClient } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { withSavepoint } from '@/lib/rental/locks';

export type RacPortalRole =
  | 'RAC_B2B_VIEWER'
  | 'RAC_B2B_BOOKER'
  | 'RAC_B2B_FINANCE'
  | 'RAC_B2B_ADMIN'
  | 'RAC_B2B_USER';

export interface RacPortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  hasPassword: boolean;
  isActive: boolean;
  role: RacPortalRole;
  sessionVersion: number;
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
  session_version?: number | string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  tenant_code?: string | null;
  tenant_name?: string | null;
  tenant_slug?: string | null;
}

const SELECT_WITH_SV = `id::text, tenant_id, customer_id, email, full_name, phone,
  password_hash, is_active, role, COALESCE(session_version, 1) AS session_version,
  last_login_at::text, created_at::text, updated_at::text`;

const SELECT_LEGACY = `id::text, tenant_id, customer_id, email, full_name, phone,
  password_hash, is_active, role, 1 AS session_version,
  last_login_at::text, created_at::text, updated_at::text`;

const VALID_ROLES = new Set<RacPortalRole>([
  'RAC_B2B_VIEWER',
  'RAC_B2B_BOOKER',
  'RAC_B2B_FINANCE',
  'RAC_B2B_ADMIN',
  'RAC_B2B_USER',
]);

function normalizeRole(raw: string | null | undefined): RacPortalRole {
  if (raw && VALID_ROLES.has(raw as RacPortalRole)) {
    return raw as RacPortalRole;
  }
  return 'RAC_B2B_USER';
}

function rowToApi(r: Row): RacPortalUser {
  const parsedSv = Number(r.session_version ?? 1);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id,
    email: r.email,
    fullName: r.full_name,
    phone: r.phone,
    hasPassword: !!r.password_hash,
    isActive: r.is_active,
    role: normalizeRole(r.role),
    sessionVersion: Number.isFinite(parsedSv) && parsedSv >= 1 ? Math.trunc(parsedSv) : 1,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function inTenant<T>(tenantId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return withTenantRls(prisma, tenantId, fn);
}

function acrossTenants<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return runOutsideRlsScope(() => withPlatformAdmin(prisma, fn));
}

async function queryUsersWithSvFallback(
  tx: TxClient,
  spName: string,
  buildSql: (selectClause: string) => string,
  params: unknown[],
): Promise<Row[]> {
  const withSv = await withSavepoint<Row[] | null>(
    tx,
    spName,
    () => tx.$queryRawUnsafe<Row[]>(buildSql(SELECT_WITH_SV), ...params),
    null,
  );
  if (withSv !== null) return withSv;
  return tx.$queryRawUnsafe<Row[]>(buildSql(SELECT_LEGACY), ...params);
}

export async function createRacPortalUser(args: {
  tenantId: string;
  customerId: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role?: RacPortalRole;
}): Promise<RacPortalUser> {
  const rows = await inTenant(args.tenantId, (tx) =>
    queryUsersWithSvFallback(
      tx,
      'rac_user_create',
      (sel) =>
        `INSERT INTO rac_portal_users
           (tenant_id, customer_id, email, full_name, phone, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${sel}`,
      [
        args.tenantId,
        args.customerId,
        args.email.toLowerCase().trim(),
        args.fullName?.trim() ?? null,
        args.phone?.trim() ?? null,
        args.role ?? 'RAC_B2B_BOOKER',
      ],
    ),
  );
  if (!rows[0]) throw new Error('createRacPortalUser returned no row');
  return rowToApi(rows[0]);
}

export async function getRacPortalUserById(tenantId: string, id: string): Promise<RacPortalUser | null> {
  const rows = await inTenant(tenantId, (tx) =>
    queryUsersWithSvFallback(
      tx,
      'rac_user_by_id',
      (sel) =>
        `SELECT ${sel} FROM rac_portal_users
          WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
      [id, tenantId],
    ),
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function findRacPortalUserByEmail(email: string): Promise<RacPortalUser | null> {
  const rows = await acrossTenants((tx) =>
    queryUsersWithSvFallback(
      tx,
      'rac_user_by_email',
      (sel) =>
        `SELECT ${sel} FROM rac_portal_users
          WHERE lower(email) = lower($1) AND deleted_at IS NULL AND is_active = TRUE
          ORDER BY (password_hash IS NOT NULL) DESC, created_at DESC
          LIMIT 1`,
      [email.trim()],
    ),
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

function matchesTenantSelector(row: Row, selector: string): boolean {
  const needle = selector.trim().toLowerCase();
  if (!needle) return true;
  if (row.tenant_id?.toLowerCase() === needle) return true;
  if (row.tenant_code?.trim().toLowerCase() === needle) return true;
  if (row.tenant_slug?.trim().toLowerCase() === needle) return true;
  if (row.tenant_name) {
    const slugifiedName = row.tenant_name.trim().toLowerCase().replace(/\s+/g, '-');
    if (slugifiedName === needle) return true;
  }
  return false;
}

/**
 * Returns ALL active, password-activated B2B portal users matching `email` across tenants,
 * optionally narrowed by `tenantCode` (`t.slug`, `t.code`, slugified `t.name`, or `t.id`).
 * Prevents an unactivated invite in Tenant B from locking out an active user in Tenant A,
 * and allows multi-tenant login disambiguation when the same email + password is active
 * in multiple RAC tenants.
 */
export async function findActiveRacUsersWithHashByEmail(
  email: string,
  tenantCode?: string | null,
): Promise<Array<RacPortalUser & { passwordHash: string }>> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return [];

  const rows = await acrossTenants(async (tx) => {
    const withSvAndSlug = await withSavepoint<Row[] | null>(
      tx,
      'rac_login_sv_slug',
      () =>
        tx.$queryRawUnsafe<Row[]>(
          `SELECT u.id::text, u.tenant_id, u.customer_id, u.email, u.full_name, u.phone,
                  u.password_hash, u.is_active, u.role, COALESCE(u.session_version, 1) AS session_version,
                  u.last_login_at::text, u.created_at::text, u.updated_at::text,
                  t.code AS tenant_code, t.name AS tenant_name, t.slug AS tenant_slug
             FROM rac_portal_users u
             LEFT JOIN tenants t ON t.id::text = u.tenant_id
            WHERE lower(u.email) = lower($1)
              AND u.deleted_at IS NULL
              AND u.is_active = TRUE
              AND u.password_hash IS NOT NULL
            ORDER BY u.created_at ASC`,
          normalizedEmail,
        ),
      null,
    );
    if (withSvAndSlug !== null) return withSvAndSlug;

    const withSv = await withSavepoint<Row[] | null>(
      tx,
      'rac_login_sv',
      () =>
        tx.$queryRawUnsafe<Row[]>(
          `SELECT u.id::text, u.tenant_id, u.customer_id, u.email, u.full_name, u.phone,
                  u.password_hash, u.is_active, u.role, COALESCE(u.session_version, 1) AS session_version,
                  u.last_login_at::text, u.created_at::text, u.updated_at::text,
                  t.code AS tenant_code, t.name AS tenant_name
             FROM rac_portal_users u
             LEFT JOIN tenants t ON t.id::text = u.tenant_id
            WHERE lower(u.email) = lower($1)
              AND u.deleted_at IS NULL
              AND u.is_active = TRUE
              AND u.password_hash IS NOT NULL
            ORDER BY u.created_at ASC`,
          normalizedEmail,
        ),
      null,
    );
    if (withSv !== null) return withSv;

    return tx.$queryRawUnsafe<Row[]>(
      `SELECT u.id::text, u.tenant_id, u.customer_id, u.email, u.full_name, u.phone,
              u.password_hash, u.is_active, u.role, 1 AS session_version,
              u.last_login_at::text, u.created_at::text, u.updated_at::text,
              t.code AS tenant_code, t.name AS tenant_name
         FROM rac_portal_users u
         LEFT JOIN tenants t ON t.id::text = u.tenant_id
        WHERE lower(u.email) = lower($1)
          AND u.deleted_at IS NULL
          AND u.is_active = TRUE
          AND u.password_hash IS NOT NULL
        ORDER BY u.created_at ASC`,
      normalizedEmail,
    );
  });

  const filtered = tenantCode?.trim()
    ? rows.filter((r) => matchesTenantSelector(r, tenantCode))
    : rows;

  return filtered
    .filter((r): r is Row & { password_hash: string } => typeof r.password_hash === 'string' && r.password_hash.length > 0)
    .map((r) => ({ ...rowToApi(r), passwordHash: r.password_hash }));
}

export async function _findRacUserWithHashByEmail(
  email: string,
  tenantCode?: string | null,
): Promise<(RacPortalUser & { passwordHash: string | null }) | null> {
  const candidates = await findActiveRacUsersWithHashByEmail(email, tenantCode);
  return candidates[0] ?? null;
}

export async function listRacPortalUsersByCustomer(
  tenantId: string,
  customerId: string,
): Promise<RacPortalUser[]> {
  const rows = await inTenant(tenantId, (tx) =>
    queryUsersWithSvFallback(
      tx,
      'rac_users_by_cust',
      (sel) =>
        `SELECT ${sel} FROM rac_portal_users
          WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL
          ORDER BY created_at DESC`,
      [tenantId, customerId],
    ),
  );
  return rows.map(rowToApi);
}

export async function markRacPortalUserLoggedIn(tenantId: string, userId: string): Promise<void> {
  await inTenant(tenantId, (tx) =>
    tx.$executeRawUnsafe(
      `UPDATE rac_portal_users
          SET last_login_at = NOW(), updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2`,
      userId,
      tenantId,
    ),
  );
}

export async function updateRacPortalUserPassword(
  tenantId: string,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const result = await inTenant(tenantId, async (tx) => {
    const updatedWithSv = await withSavepoint<number | null>(
      tx,
      'rac_user_pw_sv',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rac_portal_users
              SET password_hash = $1,
                  password_changed_at = NOW(),
                  session_version = COALESCE(session_version, 1) + 1,
                  updated_at = NOW()
            WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL`,
          passwordHash,
          userId,
          tenantId,
        ),
      null,
    );
    if (updatedWithSv !== null) return updatedWithSv;
    return tx.$executeRawUnsafe(
      `UPDATE rac_portal_users
          SET password_hash = $1, updated_at = NOW()
        WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL`,
      passwordHash,
      userId,
      tenantId,
    );
  });
  return Number(result) > 0;
}

export async function setRacPortalUserActive(
  tenantId: string,
  userId: string,
  isActive: boolean,
): Promise<boolean> {
  const result = await inTenant(tenantId, async (tx) => {
    const updatedWithSv = await withSavepoint<number | null>(
      tx,
      'rac_user_active_sv',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rac_portal_users
              SET is_active = $1,
                  session_version = COALESCE(session_version, 1) + 1,
                  updated_at = NOW()
            WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL`,
          isActive,
          userId,
          tenantId,
        ),
      null,
    );
    if (updatedWithSv !== null) return updatedWithSv;
    return tx.$executeRawUnsafe(
      `UPDATE rac_portal_users
          SET is_active = $1, updated_at = NOW()
        WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL`,
      isActive,
      userId,
      tenantId,
    );
  });
  return Number(result) > 0;
}

export async function deleteRacPortalUser(tenantId: string, userId: string): Promise<boolean> {
  const result = await inTenant(tenantId, async (tx) => {
    const deletedWithSv = await withSavepoint<number | null>(
      tx,
      'rac_user_del_sv',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rac_portal_users
              SET deleted_at = NOW(),
                  updated_at = NOW(),
                  is_active = FALSE,
                  session_version = COALESCE(session_version, 1) + 1
            WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
          userId,
          tenantId,
        ),
      null,
    );
    if (deletedWithSv !== null) return deletedWithSv;
    return tx.$executeRawUnsafe(
      `UPDATE rac_portal_users
          SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
        WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      userId,
      tenantId,
    );
  });
  return Number(result) > 0;
}
