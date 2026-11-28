/**
 * Customer Portal — accounts, per-portal roles, portal access and invitations.
 *
 * One account (customer_portal_users) per person per tenant, belonging to one
 * customer. What the account may use is in customer_portal_user_roles: one
 * row per portal (FSM, TRANSPORT) with its role there. The Shipper portal is
 * the TRANSPORT portal's LOGISTICS category and reads the same rows
 * (src/lib/shipper-portal/portal-users-store.ts). The legacy role column on
 * customer_portal_users is no longer read.
 *
 * Staff invite users from Customer Management; the invite link sets the
 * password (single-use token, only its SHA-256 hash is stored). Login does
 * not know the tenant yet, so the email lookup runs platform-wide (as the RAC
 * portal does); everything else runs under the tenant's RLS.
 *
 * Sign-in, the session check and invite acceptance work for an account with
 * a role in any portal; each portal's routes then require a role there
 * (requireCustomerPortal in ./session.ts).
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls, type TxClient } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { offeredCategories, tenantCategoryTitleMap } from '@/lib/transport-catalog/store';
import {
  CUSTOMER_PORTALS, categoryLabel, isCustomerPortal, isPortalRole, parsePortalRoleMap,
  type CustomerPortal, type PortalRole, type PortalRoleMap, type TransportCategoryCode,
} from './catalog';

export {
  PORTAL_ROLES, CUSTOMER_PORTALS, isPortalRole, isCustomerPortal,
  type PortalRole, type CustomerPortal,
} from './catalog';


/** A signed-in account with its role in each portal it may use. */
export interface PortalUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  fullName: string | null;
  mobile: string | null;
  roles: Partial<Record<CustomerPortal, PortalRole>>;
  isActive: boolean;
  sessionVersion: number;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** An account as onboarding staff see it: every portal role it holds. */
export interface PortalAccount {
  id: string;
  email: string;
  fullName: string | null;
  mobile: string | null;
  isActive: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Partial<Record<CustomerPortal, PortalRole>>;
}

interface AccountRow {
  id: string; tenant_id: string; customer_id: string; email: string; full_name: string | null; mobile: string | null;
  is_active: boolean; session_version: number; password_hash?: string | null;
  last_login_at: string | null; created_at: string; roles: Record<string, string> | null;
}

/** The account holds a role in at least one portal. */
const HAS_ROLE = `EXISTS (SELECT 1 FROM customer_portal_user_roles r WHERE r.portal_user_id = u.id)`;
const ACCOUNT_COLS = `u.id::text, u.tenant_id, u.customer_id, u.email, u.full_name, u.phone AS mobile,
  u.is_active, u.session_version, u.password_hash, u.last_login_at::text, u.created_at::text,
  (SELECT jsonb_object_agg(r.portal, r.role) FROM customer_portal_user_roles r WHERE r.portal_user_id = u.id) AS roles`;

/** Stored in the legacy, unread role column of new accounts (it is NOT NULL). */
const LEGACY_ROLE_VALUE = 'CUSTOMER_PORTAL';

function rolesOf(r: AccountRow): Partial<Record<CustomerPortal, PortalRole>> {
  const roles: Partial<Record<CustomerPortal, PortalRole>> = {};
  for (const [p, role] of Object.entries(r.roles ?? {})) {
    if (isCustomerPortal(p) && isPortalRole(role)) roles[p] = role;
  }
  return roles;
}

function toUser(r: AccountRow): PortalUser {
  return {
    id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, email: r.email, fullName: r.full_name,
    mobile: r.mobile, roles: rolesOf(r), isActive: r.is_active,
    sessionVersion: Number(r.session_version ?? 1), hasPassword: !!r.password_hash,
    lastLoginAt: r.last_login_at, createdAt: r.created_at,
  };
}

function toAccount(r: AccountRow): PortalAccount {
  const roles = rolesOf(r);
  return {
    id: r.id, email: r.email, fullName: r.full_name, mobile: r.mobile, isActive: r.is_active,
    hasPassword: !!r.password_hash, lastLoginAt: r.last_login_at, createdAt: r.created_at, roles,
  };
}

export class PortalUserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ── Signed-in account ──────────────────────────────────────────────────────

export async function getPortalUserById(tenantId: string, id: string): Promise<PortalUser | null> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<AccountRow[]>(
      `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u
        WHERE u.id::text = $1 AND u.tenant_id = $2 AND u.deleted_at IS NULL`,
      id, tenantId,
    ),
  ).catch(() => [] as AccountRow[]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Active accounts with a portal role and this email, across tenants, with password hashes (login only). */
export async function findActivePortalUsersByEmail(email: string): Promise<Array<PortalUser & { passwordHash: string }>> {
  const rows = await runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<AccountRow[]>(
        `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u
          WHERE lower(u.email) = lower($1) AND u.is_active AND u.deleted_at IS NULL AND u.password_hash IS NOT NULL
            AND ${HAS_ROLE}`,
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

// ── Staff onboarding ───────────────────────────────────────────────────────

export interface CustomerPortalSummary {
  customerId: string; code: string | null; name: string; status: string | null;
  portals: CustomerPortal[]; transportCategories: TransportCategoryCode[]; activeUsers: number; invitedUsers: number;
  /** Linked Rental customer (Rent-a-Car), shown by name. */
  rentalCustomer: { id: string; name: string } | null;
}

export async function listCustomerPortalSummaries(tenantId: string): Promise<CustomerPortalSummary[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{
      id: string; customer_code: string | null; name_en: string; status: string | null;
      portals: string[] | null; transport_categories: string[] | null; active_users: number; invited_users: number;
      rental_customer_id: string | null; rental_customer_name: string | null;
    }>>(
      `SELECT c.id, c.customer_code, c.name_en, c.status,
              (SELECT array_agg(a.portal ORDER BY a.portal) FROM customer_portal_access a
                WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id) AS portals,
              (SELECT a.categories FROM customer_portal_access a
                WHERE a.tenant_id = c.tenant_id AND a.customer_id = c.id AND a.portal = 'TRANSPORT') AS transport_categories,
              (SELECT COUNT(*)::int FROM customer_portal_users u
                WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id AND u.deleted_at IS NULL
                  AND u.is_active AND u.password_hash IS NOT NULL
                  AND EXISTS (SELECT 1 FROM customer_portal_user_roles r WHERE r.portal_user_id = u.id)) AS active_users,
              (SELECT COUNT(*)::int FROM customer_portal_users u
                WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id AND u.deleted_at IS NULL
                  AND u.is_active AND u.password_hash IS NULL
                  AND EXISTS (SELECT 1 FROM customer_portal_user_roles r WHERE r.portal_user_id = u.id)) AS invited_users,
              l.rental_customer_id,
              (SELECT COALESCE(rc.company_name, rc.full_name) FROM rental_customers rc
                WHERE rc.id::text = l.rental_customer_id AND rc.tenant_id::text = c.tenant_id) AS rental_customer_name
         FROM customers c
         LEFT JOIN customer_rental_links l ON l.tenant_id = c.tenant_id AND l.customer_id = c.id
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.name_en`,
      tenantId,
    ),
  );
  return rows.map((r) => ({
    customerId: r.id, code: r.customer_code, name: r.name_en, status: r.status,
    portals: (r.portals ?? []).filter(isCustomerPortal),
    transportCategories: (r.transport_categories ?? []) as TransportCategoryCode[],
    activeUsers: Number(r.active_users), invitedUsers: Number(r.invited_users),
    rentalCustomer: r.rental_customer_id ? { id: r.rental_customer_id, name: r.rental_customer_name ?? r.rental_customer_id } : null,
  }));
}

/**
 * Turns a portal on or off for a customer. For TRANSPORT, `categories`
 * (when given) replaces the customer's Transport categories.
 */
export async function setCustomerPortalAccess(
  tenantId: string, customerId: string, portal: CustomerPortal, enabled: boolean, by: string,
  categories?: TransportCategoryCode[],
): Promise<void> {
  await withTenantRls(prisma, tenantId, async (tx) => {
    const [c] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, customerId, tenantId,
    );
    if (!c) throw new PortalUserError('Customer not found.', 404);
    if (enabled && portal === 'TRANSPORT' && categories) {
      // Only categories the tenant offers (Transport catalogue) can be given;
      // ones the customer already has stay even if no longer offered.
      const [offeredList, titleMap] = await Promise.all([
        offeredCategories(tenantId, tx),
        tenantCategoryTitleMap(tenantId, tx),
      ]);
      const offered = new Set(offeredList);
      const [cur] = await tx.$queryRawUnsafe<Array<{ categories: string[] }>>(
        `SELECT categories FROM customer_portal_access WHERE tenant_id = $1 AND customer_id = $2 AND portal = 'TRANSPORT'`,
        tenantId, customerId,
      );
      const had = new Set(cur?.categories ?? []);
      const notOffered = categories.filter((k) => !offered.has(k) && !had.has(k));
      if (notOffered.length) {
        throw new PortalUserError(
          `Not offered by your Transport catalogue: ${notOffered.map((k) => categoryLabel(k, titleMap)).join(', ')}.`,
        );
      }
    }
    if (enabled) {
      const cats = portal === 'TRANSPORT' ? (categories ?? null) : [];
      await tx.$executeRawUnsafe(
        `INSERT INTO customer_portal_access (tenant_id, customer_id, portal, enabled_by, categories)
         VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{}'))
         ON CONFLICT (tenant_id, customer_id, portal)
         DO UPDATE SET categories = COALESCE($5::text[], customer_portal_access.categories)`,
        tenantId, customerId, portal, by, cats,
      );
    } else {
      await tx.$executeRawUnsafe(
        `DELETE FROM customer_portal_access WHERE tenant_id = $1 AND customer_id = $2 AND portal = $3`,
        tenantId, customerId, portal,
      );
    }
  });
}

/** Every account of the customer with the portals it may use. */
export async function listCustomerAccounts(tenantId: string, customerId: string): Promise<PortalAccount[]> {
  const rows = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<AccountRow[]>(
      `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u
        WHERE u.tenant_id = $1 AND u.customer_id = $2 AND u.deleted_at IS NULL ORDER BY u.created_at`,
      tenantId, customerId,
    ),
  );
  return rows.map(toAccount);
}

async function accountById(tx: TxClient, tenantId: string, id: string): Promise<AccountRow | undefined> {
  const [row] = await tx.$queryRawUnsafe<AccountRow[]>(
    `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u
      WHERE u.id::text = $1 AND u.tenant_id = $2 AND u.deleted_at IS NULL`,
    id, tenantId,
  );
  return row;
}

/** Applies a role map; returns true when an existing grant was changed or removed. */
async function applyRoles(
  tx: TxClient, tenantId: string, userId: string, current: Record<string, string> | null, roles: PortalRoleMap, by: string,
): Promise<boolean> {
  let narrowed = false;
  for (const portal of CUSTOMER_PORTALS) {
    if (!(portal in roles)) continue;
    const next = roles[portal];
    const had = current?.[portal];
    if (next === null) {
      if (had) narrowed = true;
      await tx.$executeRawUnsafe(
        `DELETE FROM customer_portal_user_roles WHERE portal_user_id = $1::uuid AND tenant_id = $2 AND portal = $3`,
        userId, tenantId, portal,
      );
    } else if (next) {
      if (had && had !== next) narrowed = true;
      await tx.$executeRawUnsafe(
        `INSERT INTO customer_portal_user_roles (tenant_id, portal_user_id, portal, role, granted_by_user_id)
         VALUES ($1, $2::uuid, $3, $4, $5)
         ON CONFLICT (portal_user_id, portal) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        tenantId, userId, portal, next, by,
      );
    }
  }
  return narrowed;
}

/** Roles from an invite / update body: `roles` map, or the older single FSM `role`. */
function rolesFromInput(input: { roles?: unknown; role?: unknown }): PortalRoleMap | null {
  if (input.roles !== undefined) return parsePortalRoleMap(input.roles);
  if (input.role !== undefined) return isPortalRole(input.role) ? { FSM: input.role } : null;
  return {};
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteResult {
  account: PortalAccount;
  /** Null when the account already has a password: the new access works with it. */
  rawToken: string | null;
  expiresAt: string | null;
}

/**
 * Invites a person, or gives an existing account more portals. One account
 * per email per tenant: an email already used by another customer is refused.
 */
export async function inviteCustomerUser(
  tenantId: string, customerId: string,
  input: { email?: unknown; fullName?: unknown; mobile?: unknown; roles?: unknown; role?: unknown },
  invitedBy: string,
): Promise<InviteResult> {
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) throw new PortalUserError('Enter a valid email address.');
  const roles = rolesFromInput(input);
  if (!roles) throw new PortalUserError('Unknown portal or role.');
  const granted = CUSTOMER_PORTALS.filter((p) => roles[p]);
  if (granted.length === 0) throw new PortalUserError('Choose a role in at least one portal.');
  const fullName = String(input.fullName ?? '').trim().slice(0, 120) || null;
  const mobile = String(input.mobile ?? '').trim().slice(0, 40) || null;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [c] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, customerId, tenantId,
    );
    if (!c) throw new PortalUserError('Customer not found.', 404);
    const [existing] = await tx.$queryRawUnsafe<AccountRow[]>(
      `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u
        WHERE u.tenant_id = $1 AND lower(u.email) = $2 AND u.deleted_at IS NULL`,
      tenantId, email,
    );
    if (existing && existing.customer_id !== customerId) {
      throw new PortalUserError('That email already has portal access for another customer.', 409);
    }
    let userId: string;
    if (existing) {
      userId = existing.id;
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_users
            SET full_name = COALESCE($3, full_name), phone = COALESCE($4, phone), is_active = TRUE, updated_at = NOW()
          WHERE id::text = $1 AND tenant_id = $2`,
        userId, tenantId, fullName, mobile,
      );
    } else {
      const [row] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO customer_portal_users (tenant_id, customer_id, email, full_name, phone, role, invited_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
        tenantId, customerId, email, fullName, mobile, LEGACY_ROLE_VALUE, invitedBy,
      );
      userId = row.id;
    }
    const narrowed = await applyRoles(tx, tenantId, userId, existing?.roles ?? null, roles, invitedBy);
    if (narrowed) {
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_users SET session_version = session_version + 1 WHERE id::text = $1 AND tenant_id = $2`,
        userId, tenantId,
      );
    }

    let rawToken: string | null = null;
    let expiresAt: string | null = null;
    if (!existing?.password_hash) {
      rawToken = crypto.randomBytes(32).toString('base64url');
      expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await tx.$executeRawUnsafe(
        `INSERT INTO customer_portal_invitations (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
         VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)`,
        tenantId, userId, hashToken(rawToken), expiresAt, invitedBy,
      );
    }
    const account = await accountById(tx, tenantId, userId);
    if (!account) throw new PortalUserError('Portal user not found.', 404);
    const result = toAccount(account);
    return { account: result, rawToken, expiresAt };
  });
}

/**
 * Activates / deactivates the account, or changes its portal roles
 * (a role sets or changes access, null removes the portal). Any change ends
 * the account's open FSM sessions; the Shipper portal re-reads the role on
 * every request.
 */
export async function updateCustomerUser(
  tenantId: string, id: string, patch: { isActive?: unknown; roles?: unknown; role?: unknown }, by: string,
  /** When set, only an account of this customer can be changed (customer-admin Team page). */
  onlyCustomerId?: string,
): Promise<PortalAccount> {
  const roles = rolesFromInput(patch);
  if (!roles) throw new PortalUserError('Unknown portal or role.');
  const isActive = typeof patch.isActive === 'boolean' ? patch.isActive : null;
  return withTenantRls(prisma, tenantId, async (tx) => {
    const current = await accountById(tx, tenantId, id);
    if (!current || (onlyCustomerId && current.customer_id !== onlyCustomerId)) {
      throw new PortalUserError('Portal user not found.', 404);
    }
    await applyRoles(tx, tenantId, current.id, current.roles, roles, by);
    await tx.$executeRawUnsafe(
      `UPDATE customer_portal_users
          SET is_active = COALESCE($3, is_active), session_version = session_version + 1, updated_at = NOW()
        WHERE id::text = $1 AND tenant_id = $2`,
      current.id, tenantId, isActive,
    );
    const updated = await accountById(tx, tenantId, current.id);
    if (!updated) throw new PortalUserError('Portal user not found.', 404);
    return toAccount(updated);
  });
}

// ── Invitations (password setup) ───────────────────────────────────────────

function hashToken(raw: string) { return crypto.createHash('sha256').update(raw).digest('hex'); }

/** The invited account for a valid, unused, unexpired token (for the setup page). */
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
            AND u.is_active AND u.deleted_at IS NULL AND ${HAS_ROLE}
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
        `SELECT i.id::text, i.tenant_id, i.portal_user_id::text FROM customer_portal_invitations i
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()
            AND EXISTS (SELECT 1 FROM customer_portal_user_roles r
                         WHERE r.portal_user_id = i.portal_user_id AND r.tenant_id = i.tenant_id)
          LIMIT 1 FOR UPDATE OF i`,
        hashToken(rawToken),
      );
      if (!inv) return null;
      const [updated] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE customer_portal_users
            SET password_hash = $1, session_version = session_version + 1, updated_at = NOW()
          WHERE id::text = $2 AND tenant_id = $3 AND is_active AND deleted_at IS NULL
          RETURNING id::text`,
        passwordHash, inv.portal_user_id, inv.tenant_id,
      );
      if (!updated) return null;
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_invitations SET accepted_at = NOW() WHERE id::text = $1`, inv.id,
      );
      // Other outstanding invites for this account are no longer needed.
      await tx.$executeRawUnsafe(
        `UPDATE customer_portal_invitations SET accepted_at = NOW()
          WHERE portal_user_id::text = $1 AND tenant_id = $2 AND accepted_at IS NULL`,
        inv.portal_user_id, inv.tenant_id,
      );
      const [row] = await tx.$queryRawUnsafe<AccountRow[]>(
        `SELECT ${ACCOUNT_COLS} FROM customer_portal_users u WHERE u.id::text = $1 AND u.tenant_id = $2`,
        inv.portal_user_id, inv.tenant_id,
      );
      return row ? toUser(row) : null;
    }),
  );
}
