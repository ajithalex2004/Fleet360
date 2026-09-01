/**
 * Idempotent ALTER TABLE for MFA columns on the User table.
 * Called from each MFA route to guarantee the columns exist before queries.
 *
 * Note: Prisma's User model has no @@map override, so the underlying
 * Postgres table is "User" (capitalised, quoted).
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

const MFA_ALTERS = [
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_secret TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS pending_mfa_secret TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`,
];

// Postgres checks ALTER TABLE privilege before evaluating IF NOT EXISTS, so
// this throws every time under a runtime role that doesn't own the table
// (e.g. fleet360_app) regardless of whether the columns are already there -
// same shape as ensurePasswordHashColumn/ensureTrnColumn elsewhere in this
// codebase. Unlike those, this had no per-statement try/catch, so the first
// ALTER's 42501 "must be owner of table User" propagated straight out of
// every one of this function's five call sites - most critically
// src/app/api/auth/login/route.ts, where it ran unconditionally on every
// login attempt for every user, before the password/MFA checks even
// mattered. _ensured never got set (the throw happened before that line),
// so every single login kept re-attempting and re-failing the same way.
export async function ensureMfaColumns(): Promise<void> {
  if (_ensured) return;
  for (const sql of MFA_ALTERS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('[auth-mfa-schema] ensureMfaColumns skipped:', sql, e);
    }
  }
  _ensured = true;
}
