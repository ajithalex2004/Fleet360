/**
 * B2B RAC Portal — single-use SHA-256 invitation token lifecycle (`rac_portal_invitations`).
 *
 * Mirrors `src/lib/leasing-portal/invitations.ts`. Raw tokens are never stored
 * in Postgres; only their SHA-256 digest is persisted.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { withSavepoint } from '@/lib/rental/locks';

const INVITATION_TTL_DAYS = 7;

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface CreatedRacInvitation {
  id: string;
  rawToken: string;
  expiresAt: string;
}

export async function createRacInvitation(args: {
  tenantId: string;
  portalUserId: string;
  invitedByUserId: string;
}): Promise<CreatedRacInvitation> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

  const rows = await withTenantRls(prisma, args.tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{ id: string; expires_at: string }>>(
      `INSERT INTO rac_portal_invitations
         (tenant_id, portal_user_id, token_hash, expires_at, invited_by_user_id)
       VALUES ($1, $2::uuid, $3, $4::timestamptz, $5)
       RETURNING id::text, expires_at::text`,
      args.tenantId,
      args.portalUserId,
      tokenHash,
      expiresAt,
      args.invitedByUserId,
    ),
  );
  if (!rows[0]) throw new Error('createRacInvitation returned no row');
  return { id: rows[0].id, rawToken, expiresAt: rows[0].expires_at };
}

interface InvitationRow {
  id: string;
  tenant_id: string;
  portal_user_id: string;
  expires_at: string;
  accepted_at: string | null;
}

export async function resolveRacInvitation(rawToken: string): Promise<InvitationRow | null> {
  const tokenHash = hashToken(rawToken);
  const rows = await runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<InvitationRow[]>(
        `SELECT id::text, tenant_id, portal_user_id::text, expires_at::text, accepted_at::text
           FROM rac_portal_invitations
          WHERE token_hash = $1
          LIMIT 1`,
        tokenHash,
      ),
    ),
  );
  const row = rows[0];
  if (!row) return null;
  if (row.accepted_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

export async function acceptRacInvitation(
  rawToken: string,
  passwordHash: string,
): Promise<{ portalUserId: string; tenantId: string } | null> {
  const tokenHash = hashToken(rawToken);
  return runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, async (tx) => {
      // 1. Lock the unaccepted, unexpired invitation row first without burning it
      const pendingRows = await tx.$queryRawUnsafe<
        Array<{ id: string; portal_user_id: string; tenant_id: string }>
      >(
        `SELECT id::text, portal_user_id::text, tenant_id
           FROM rac_portal_invitations
          WHERE token_hash = $1
            AND accepted_at IS NULL
            AND expires_at > NOW()
          LIMIT 1
          FOR UPDATE`,
        tokenHash,
      );
      const pending = pendingRows[0];
      if (!pending) return null;

      // 2. Verify target portal user is active and not soft-deleted BEFORE mutating rows
      const userRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id
           FROM rac_portal_users
          WHERE id = $1::uuid
            AND tenant_id = $2
            AND is_active = TRUE
            AND deleted_at IS NULL
          FOR UPDATE`,
        pending.portal_user_id,
        pending.tenant_id,
      );
      if (!userRows[0]) {
        return null;
      }

      // 3. Mark invitation accepted
      const claimRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE rac_portal_invitations
            SET accepted_at = NOW()
          WHERE id = $1::uuid
            AND accepted_at IS NULL
            AND expires_at > NOW()
          RETURNING id::text`,
        pending.id,
      );
      if (!claimRows[0]) return null;

      // 4. Set password hash, bump session_version, and record password_changed_at
      const updatedWithSv = await withSavepoint<number | null>(
        tx,
        'rac_inv_accept_sv',
        () =>
          tx.$executeRawUnsafe(
            `UPDATE rac_portal_users
                SET password_hash = $1,
                    password_changed_at = NOW(),
                    session_version = COALESCE(session_version, 1) + 1,
                    updated_at = NOW()
              WHERE id = $2::uuid
                AND tenant_id = $3
                AND is_active = TRUE
                AND deleted_at IS NULL`,
            passwordHash,
            pending.portal_user_id,
            pending.tenant_id,
          ),
        null,
      );
      if (updatedWithSv === null) {
        await tx.$executeRawUnsafe(
          `UPDATE rac_portal_users
              SET password_hash = $1, updated_at = NOW()
            WHERE id = $2::uuid
              AND tenant_id = $3
              AND is_active = TRUE
              AND deleted_at IS NULL`,
          passwordHash,
          pending.portal_user_id,
          pending.tenant_id,
        );
      }

      return { portalUserId: pending.portal_user_id, tenantId: pending.tenant_id };
    }),
  );
}
