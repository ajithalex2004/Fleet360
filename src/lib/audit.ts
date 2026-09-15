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
 *
 * Almost every call site uses `void logAudit(...)` rather than awaiting —
 * that's intentional, audit logging should never add latency to the
 * response it's recording. That's also exactly why this function opens its
 * own independent transaction instead of writing on whatever connection
 * happens to be ambiently active: a fire-and-forget call started while a
 * caller's own transaction is still open inherits that transaction's scope
 * (AsyncLocalStorage propagates it into anything spawned during the call,
 * awaited or not), and that transaction can commit — closing its
 * connection — before this write's own statement reaches it. See #72.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';

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

type AuditDb = { $executeRawUnsafe: (...args: any[]) => Promise<any> };

function writeAuditRow(db: AuditDb, payload: AuditPayload) {
  return db.$executeRawUnsafe(
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
}

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    // Own, independent transaction — never the caller's. audit_logs' RLS
    // policy requires app.tenant_id to either match the row's tenant_id or
    // be '*'; a NULL-tenant row (platform/system events with no tenantId)
    // can only ever satisfy the '*' branch, so that case needs
    // withPlatformAdmin specifically, not just "no scoping".
    await runOutsideRlsScope(() =>
      payload.tenantId
        ? withTenantRls(prisma, payload.tenantId as string, (tx) => writeAuditRow(tx, payload))
        : withPlatformAdmin(prisma, (tx) => writeAuditRow(tx, payload)),
    );
  } catch (err) {
    // Never crash a caller — audit is best-effort
    console.error('[audit] logAudit failed:', err);
  }
}

/**
 * For callers that are already inside their own correctly-scoped
 * transaction and want the audit row written atomically alongside other
 * work on that same `tx` — deliberately the opposite of `logAudit`'s own
 * independent-transaction behavior above. Only use this when `tx` is a real
 * transaction client the caller owns and awaits; never pass a fire-and-
 * forget scope here, that's exactly the bug #72 fixed in `logAudit`.
 */
export async function logAuditInTx(payload: AuditPayload, tx: AuditDb): Promise<void> {
  try {
    await writeAuditRow(tx, payload);
  } catch (err) {
    console.error('[audit] logAuditInTx failed:', err);
  }
}
