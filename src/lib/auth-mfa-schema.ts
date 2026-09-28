/**
 * MFA columns on the User table, added at runtime where missing.
 * Called from each MFA route to guarantee the columns exist before queries.
 *
 * Note: Prisma's User model has no @@map override, so the underlying
 * Postgres table is "User" (capitalised, quoted).
 */

import { addMissingColumns } from '@/lib/ensure-columns';

let _ensured = false;

const MFA_COLUMNS: Record<string, string> = {
  mfa_enabled: 'BOOLEAN NOT NULL DEFAULT FALSE',
  mfa_secret: 'TEXT',
  pending_mfa_secret: 'TEXT',
  mfa_recovery_codes: 'JSONB',
  mfa_enrolled_at: 'TIMESTAMPTZ',
};

// Runs on every login. addMissingColumns checks the catalog first and issues
// no DDL when the columns exist, so the runtime role (which owns no tables and
// cannot ALTER them) no longer fails, logs or aborts anything here. A column
// that is genuinely missing still needs the table owner: that failure is
// logged and login carries on, as before.
export async function ensureMfaColumns(): Promise<void> {
  if (_ensured) return;
  try {
    await addMissingColumns('User', MFA_COLUMNS);
  } catch (e) {
    console.warn('[auth-mfa-schema] could not add missing MFA columns (run the migration as the table owner):', e);
  }
  _ensured = true;
}
