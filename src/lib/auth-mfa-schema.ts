/**
 * Idempotent ALTER TABLE for MFA columns on the users table.
 * Called from each MFA route to guarantee the columns exist before queries.
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureMfaColumns(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS pending_mfa_secret TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`);
  _ensured = true;
}
