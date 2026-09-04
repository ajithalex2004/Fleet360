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

export function generateInvitationToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash  = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashInvitationToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
