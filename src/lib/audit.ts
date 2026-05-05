/**
 * logAudit — fire-and-forget audit logger
 * Call from any API route after a successful write operation.
 *
 * Example:
 *   await logAudit({
 *     tenantId: 'abc', tenantName: 'EXL Solutions',
 *     entityType: 'Branch', entityId: branch.id, entityName: branch.branch_name,
 *     userId: req.headers.get('x-user-id') ?? 'system',
 *     userRole: 'Admin', action: 'CREATE',
 *     details: 'Created Abu Dhabi branch',
 *   });
 */

import { prisma } from '@/lib/prisma';

export interface AuditPayload {
  tenantId?:    string;
  tenantName?:  string;
  branchId?:    string;          // which branch the action occurred in
  branchName?:  string;
  entityType:   string;          // Branch | User | Vehicle | Trip | Login | etc.
  entityId?:    string;
  entityName?:  string;
  userId?:      string;
  userName?:    string;
  userEmail?:   string;
  userRole?:    string;
  action:       string;          // CREATE | UPDATE | DELETE | LOGIN | LOGOUT | VIEW | EXPORT
  details?:     string;          // human-readable description of what changed
  ipAddress?:   string;
  userAgent?:   string;
  sessionId?:   string;
  loginTime?:   Date | string;
  logoutTime?:  Date | string;
}

/** Ensure the audit_logs table exists (idempotent). */
export async function ensureAuditTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     TEXT,
      tenant_name   TEXT,
      branch_id     TEXT,
      branch_name   TEXT,
      entity_type   TEXT        NOT NULL,
      entity_id     TEXT,
      entity_name   TEXT,
      user_id       TEXT,
      user_name     TEXT,
      user_email    TEXT,
      user_role     TEXT,
      action        TEXT        NOT NULL,
      details       TEXT,
      ip_address    TEXT,
      user_agent    TEXT,
      session_id    TEXT,
      login_time    TIMESTAMPTZ,
      logout_time   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add branch columns if upgrading from an older schema
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_id   TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_name TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_audit_tenant    ON audit_logs(tenant_id);
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_logs(user_id);
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_audit_entity    ON audit_logs(entity_type);
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs(created_at DESC);
  `).catch(() => {});
}

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    await ensureAuditTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs
         (tenant_id, tenant_name, branch_id, branch_name,
          entity_type, entity_id, entity_name,
          user_id, user_name, user_email, user_role,
          action, details, ip_address, user_agent, session_id,
          login_time, logout_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17::timestamptz,$18::timestamptz)`,
      payload.tenantId   ?? null,
      payload.tenantName ?? null,
      payload.branchId   ?? null,
      payload.branchName ?? null,
      payload.entityType,
      payload.entityId   ?? null,
      payload.entityName ?? null,
      payload.userId     ?? null,
      payload.userName   ?? null,
      payload.userEmail  ?? null,
      payload.userRole   ?? null,
      payload.action,
      payload.details    ?? null,
      payload.ipAddress  ?? null,
      payload.userAgent  ?? null,
      payload.sessionId  ?? null,
      payload.loginTime  ? new Date(payload.loginTime).toISOString()  : null,
      payload.logoutTime ? new Date(payload.logoutTime).toISOString() : null,
    );
  } catch (err) {
    // Never crash a caller — audit is best-effort
    console.error('[audit] logAudit failed:', err);
  }
}
