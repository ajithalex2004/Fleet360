/**
 * Customer Portal — users, portal access and invitations.
 *
 * Portal users belong to one customer of one tenant. Staff invite them from
 * Customer Management; the invite link sets the password (single-use token,
 * only its SHA-256 hash is stored). Login does not know the tenant yet, so
 * the email lookup runs platform-wide (as the RAC portal does); everything
 * else runs under the tenant's RLS.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';

export type PortalRole = 'ADMIN' | 'REQUESTER' | 'VIEWER';
export const PORTAL_ROLES: PortalRole[] = ['ADMIN', 'REQUESTER', 'VIEWER'];
export type CustomerPortal = 'FSM' | 'TRANSPORT';
export const CUSTOMER_PORTALS: CustomerPortal[] = ['FSM', 'TRANSPORT'];

export function isPortalRole(v: unknown): v is PortalRole { return PORTAL_ROLES.includes(v as PortalRole); }
export function isCustomerPortal(v: unknown): v is CustomerPortal { return CUSTOMER_PORTALS.includes(v as CustomerPortal); }

export interface PortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  fullName: string | null;
  mobile: string | null;
  role: PortalRole;
  isActive: boolean;
  sessionVersion: number;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserRow {
  id: string; tenant_id: string; customer_id: string; email: string; full_name: string | null; mobile: string | null;
  role: string; is_active: boolean; session_version: number; password_hash?: string | null;
  last_login_at: string | null; created_at: string;
}

const USER_COLS = `id::text, tenant_id, customer_id, email, full_name, mobile, role, is_active, session_version,
  password_hash, last_login_at::text, created_at::text`;

function toUser(r: UserRow): PortalUser {
  return {
    id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, email: r.email, fullName: r.full_name,
    mobile: r.mobile, role: (isPortalRole(r.role) ? r.role : 'VIEWER'), isActive: r.is_active,
    sessionVersion: Number(r.session_version ?? 1), hasPassword: !!r.password_hash,
    lastLoginAt: r.last_login_at, createdAt: r.created_at,
  };
}

export class PortalUserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function getPortalUserById(tenantId: string, id: string): Promise<PortalUser | null> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<UserRow[]>(
      `SELECT ${USER_COLS} FROM customer_portal_users
        WHERE id::text = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      id, tenantId,
    ),
  ).catch(() => [] as UserRow[]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Active users with this email across tenants, with their password hashes (login only). */
export async function findActivePortalUsersByEmail(email: string): Promise<Array<PortalUser & { passwordHash: string }>> {
  const rows = await runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<UserRow[]>(
        `SELECT ${USER_COLS} FROM customer_portal_users
          WHERE lower(email) = lower($1) AND is_active AND deleted_at IS NULL AND password_hash IS NOT NULL`,
        email,
      ),
    ),
  );
  return rows.map((r) => ({ ...toUser(r), passwordHash: String(r.password_hash) }));
}

export async function markPortalUserLoggedIn(tenantId: string, id: string): Promise<void> {
  await withTenantRls(prisma, tenantId, (tx) =>
    tx.$executeRawUnsafe(
      `UPDATE customer_portal_users SET last_login_at = NOW() WHERE id::text = $1 AND tenant_id = $2`, id, tenantId,
    ),
  );
}

export async function customerHasPortal(tenantId: string, customerId: string, portal: CustomerPortal): Promise<boolean> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM customer_portal_access WHERE tenant_id = $1 AND customer_id = $2 AND portal = $3`,
      tenantId, customerId, portal,
    ),
  ).catch(() => [] as Array<{ ok: number }>);
  return rows.length > 0;
}

export async function portalsForCustomer(tenantId: string, customerId: string): Promise<CustomerPortal[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{ portal: string }>>(
      `SELECT portal FROM customer_portal_access WHERE tenant_id = $1 AND customer_id = $2 ORDER BY portal`,
      tenantId, customerId,
    ),
  ).catch(() => [] as Array<{ portal: string }>);
  return rows.map((r) => r.portal).filter(isCustomerPortal);
}

// ── Staff administration ───────────────────────────────────────────────────

export interface CustomerPortalSummary {
  customerId: string; code: string | null; name: string; status: string | null;
  portals: CustomerPortal[]; activeUsers: number; invitedUsers: number;
}

export async function listCustomerPortalSummaries(tenantId: string): Promise<CustomerPortalSummary[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{
      id: string; customer_code: string | null; name_en: string; status: string | null;
      portals: string[] | null; active_users: number; invited_users: number;
    }>>(
      `SELECT c.id, c.customer_code, c.name_en, c.status,
              (SELECT array_agg(a.portal ORDER BY a.portal) FROM customer_portal_access a
                WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id) AS portals,
              (SELECT COUNT(*)::int FROM customer_portal_users u
                WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id AND u.deleted_at IS NULL
                  AND u.is_active AND u.password_hash IS NOT NULL) AS active_users,
              (SELECT COUNT(*)::int FROM customer_portal_users u
                WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id AND u.deleted_at IS NULL
                  AND u.is_active AND u.password_hash IS NULL) AS invited_users
         FROM customers c
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.name_en`,
      tenantId,
    ),
  );
  return rows.map((r) => ({
    customerId: r.id, code: r.customer_code, name: r.name_en, status: r.status,
    portals: (r.portals ?? []).filter(isCustomerPortal), activeUsers: Number(r.active_users), invitedUsers: Number(r.invited_users),
  }));
}

export async function setCustomerPortalAccess(
  tenantId: string, customerId: string, portal: CustomerPortal, enabled: boolean, by: string,
): Promise<void> {
  await withTenantRls(prisma, tenantId, async (tx) => {
    const [c] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, customerId, tenantId,
    );
    if (!c) throw new PortalUserError('Customer not found.', 404);
    if (enabled) {
      await tx.$executeRawUnsafe(
        `INSERT INTO customer_portal_access (tenant_id, customer_id, portal, enabled_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, customer_id, portal) DO NOTHING`,
        tenantId, customerId, portal, by,
      );
    } else {
      await tx.$executeRawUnsafe(
        `DELETE FROM customer_portal_access WHERE tenant_id = $1 AND customer_id = $2 AND portal = $3`,
        tenantId, customerId, portal,
      );
    }
  });
}

export async function listPortalUsers(tenantId: string, customerId: string): Promise<PortalUser[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<UserRow[]>(
      `SELECT ${USER_COLS} FROM customer_portal_users
        WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL ORDER BY created_at`,
      tenantId, customerId,
    ),
  );
  return rows.map(toUser);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates (or re-invites) a portal user and returns a single-use setup token. */
export async function invitePortalUser(
  tenantId: string, customerId: string,
  input: { email?: unknown; fullName?: unknown; mobile?: unknown; role?: unknown },
  invitedBy: string,
): Promise<{ user: PortalUser; rawToken: string; expiresAt: string }> {
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) throw new PortalUserError('Enter a valid email address.');
  const role: PortalRole = isPortalRole(input.role) ? input.role : 'REQUESTER';
  const fullName = String(input.fullName ?? '').trim().slice(0, 120) || null;
  const mobile = String(input.mobile ?? '').trim().slice(0, 40) || null;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [c] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, customerId, tenantId,
    );
    if (!c) throw new PortalUserError('Customer not found.', 404);
    const [existing] = await tx.$queryRawUnsafe<UserRow[]>(
      `SELECT ${USER_COLS} FROM customer_portal_users
        WHERE tenant_id = $1 AND lower(email) = $2 AND deleted_at IS NULL`,
      tenantId, email,
    );
    if (existing && existing.customer_id !== customerId) {
      throw new PortalUserError('That email already has portal access for another customer.', 409);
    }
    const [row] = existing
      ? await tx.$queryRawUnsafe<UserRow[]>(
          `UPDATE customer_portal_users
              SET full_name = COALESCE($3, full_name), mobile = COALESCE($4, mobile), role = $5,
                  is_active = TRUE, updated_at = NOW()
            WHERE id::text = $1 AND tenant_id = $2 RETURNING ${USER_COLS}`,
          existing.id, tenantId, fullName, mobile, role,
        )
      : await tx.$queryRawUnsafe<UserRow[]>(
          `INSERT INTO customer_portal_users (tenant_id, customer_id, email, full_name, mobile, role, invited_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${USER_COLS}`,
          tenantId, customerId, email, fullName, mobile, role, invitedBy,
        );
    await tx.$executeRawUnsafe(
      `INSERT INTO customer_portal_invitations (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
       VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)`,
      tenantId, row.id, tokenHash, expiresAt, invitedBy,
    );
    return { user: toUser(row), rawToken, expiresAt };
  });
}

/** Activate / deactivate or change role. Any change ends the user's open sessions. */
export async function updatePortalUser(
  tenantId: string, id: string, patch: { isActive?: unknown; role?: unknown },
): Promise<PortalUser> {
  const role = patch.role === undefined ? null : isPortalRole(patch.role) ? patch.role : undefined;
  if (role === undefined) throw new PortalUserError('Unknown role.');
  const isActive = typeof patch.isActive === 'boolean' ? patch.isActive : null;
  const [row] = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<UserRow[]>(
      `UPDATE customer_portal_users
          SET role = COALESCE($3, role), is_active = COALESCE($4, is_active),
              session_version = session_version + 1, updated_at = NOW()
        WHERE id::text = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING ${USER_COLS}`,
      id, tenantId, role, isActive,
    ),
  );
  if (!row) throw new PortalUserError('Portal user not found.', 404);
  return toUser(row);
}

// ── Invitations (password setup) ───────────────────────────────────────────

const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

/** The invited user for a valid, unused, unexpired token (for the setup page). */
export async function resolvePortalInvitation(rawToken: string): Promise<{ email: string; fullName: string | null; customerName: string } | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const rows = await runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<Array<{ email: string; full_name: string | null; name_en: string | null }>>(
        `SELECT u.email, u.full_name, c.name_en
           FROM customer_portal_invitations i
           JOIN customer_portal_users u ON u.id = i.portal_user_id AND u.tenant_id = i.tenant_id
           LEFT JOIN customers c ON c.id = u.customer_id AND c.tenant_id = u.tenant_id
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()
            AND u.is_active AND u.deleted_at IS NULL
          LIMIT 1`,
        hashToken(rawToken),
      ),
    ),
  );
  const r = rows[0];
  return r ? { email: r.email, fullName: r.full_name, customerName: r.name_en ?? '' } : null;
}

/** Consumes the token and sets the password; ends any open sessions. */
export async function acceptPortalInvitation(rawToken: string, passwordHash: string): Promise<PortalUser | null> {
  if (!rawToken || rawToken.length > 200) return null;
  return runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, async (tx) => {
      const [inv] = await tx.$queryRawUnsafe<Array<{ id: string; tenant_id: string; portal_user_id: string }>>(
        `SELECT id::text, tenant_id, portal_user_id::text FROM customer_portal_invitations
          WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()
          LIMIT 1 FOR UPDATE`,
        hashToken(rawToken),
      );
      if (!inv) return null;
      const [row] = await tx.$queryRawUnsafe<UserRow[]>(
        `UPDATE customer_portal_users
            SET password_hash = $1, session_version = session_version + 1, updated_at = NOW()
          WHERE id::text = $2 AND tenant_id = $3 AND is_active AND deleted_at IS NULL
          RETURNING ${USER_COLS}`,
        passwordHash, inv.portal_user_id, inv.tenant_id,
      );
      if (!row) return null;
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_invitations SET accepted_at = NOW() WHERE id::text = $1`, inv.id,
      );
      // Other outstanding invites for this user are no longer needed.
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_invitations SET accepted_at = NOW()
          WHERE portal_user_id::text = $1 AND tenant_id = $2 AND accepted_at IS NULL`,
        inv.portal_user_id, inv.tenant_id,
      );
      return toUser(row);
    }),
  );
}
