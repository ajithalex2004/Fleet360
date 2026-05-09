/**
 * Tenant invitation helpers — table schema, token gen, lookup.
 *
 * Same hashed-token pattern as password reset: raw 32-byte hex token in the
 * email link, sha256 hash stored in the DB. Plain token never lands in
 * persistent storage.
 *
 * Lazy-creates the table on first use so no separate migration is needed.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export const INVITATION_TTL_DAYS = 7;

export interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  token_hash: string;
  invited_by_user_id: string | null;
  expires_at: string;
  used_at: string | null;
  revoked: boolean;
  created_at: string;
}

let _ensured = false;

export async function ensureInvitationTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_invitations (
      id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id            TEXT         NOT NULL,
      email                TEXT         NOT NULL,
      role_id              TEXT         NOT NULL,
      token_hash           TEXT         NOT NULL,
      invited_by_user_id   TEXT,
      expires_at           TIMESTAMPTZ  NOT NULL,
      used_at              TIMESTAMPTZ,
      revoked              BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations (tenant_id, expires_at)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_invitations_hash   ON tenant_invitations (token_hash)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email  ON tenant_invitations (LOWER(email))`,
  );
  _ensured = true;
}

export function generateInvitationToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash  = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashInvitationToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
