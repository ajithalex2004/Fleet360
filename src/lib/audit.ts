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

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
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
