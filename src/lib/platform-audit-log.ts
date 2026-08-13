/**
 * Platform audit log — write helper for destructive platform actions.
 *
 * The table is `platform_audit_log`. This module only provides writes;
 * reads are not exposed yet (can be added when a /admin/audit page ships).
 *
 * Append-only by convention. There is intentionally no `update` or
 * `delete` on the underlying table from app code — only this writer.
 *
 * Pair with: /api/admin/* destructive routes (tenant hard-delete, user
 * hard-delete, plan changes, etc.).
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export type AuditAction =
  | 'tenant.hard_delete'
  | 'user.hard_delete'
  | 'plan.create'
  | 'plan.update'
  | 'plan.retire';

export type AuditTargetType = 'tenant' | 'user' | 'plan';

export interface AuditEntry {
  action:              AuditAction | string;   // string fallback for forward compat
  targetType:          AuditTargetType | string;
  targetId:            string;
  targetName?:         string;
  performedBy?:        { userId?: string; email?: string };
  dryRun:              boolean;
  metadata:            Record<string, unknown>;
}

interface AuditRow {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  target_name: string | null;
  performed_by_user_id: string | null;
  performed_by_email: string | null;
  dry_run: boolean;
  metadata: unknown;
  created_at: Date;
}

/**
 * Append an entry to platform_audit_log. Returns the new id.
 * Never throws — audit-log failures should not break the calling action,
 * but are logged to stderr so operators can see them.
 */
export async function logAudit(entry: AuditEntry): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO platform_audit_log
         (id, action, target_type, target_id, target_name,
          performed_by_user_id, performed_by_email, dry_run, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      id,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.targetName ?? null,
      entry.performedBy?.userId ?? null,
      entry.performedBy?.email ?? null,
      !!entry.dryRun,
      JSON.stringify(entry.metadata ?? {}),
    );
    return id;
  } catch (e) {
    console.error('[audit-log] write failed (action=%s target=%s/%s):', entry.action, entry.targetType, entry.targetId, e);
    return null;
  }
}

/**
 * Read recent entries. Used by the (future) admin audit log page.
 */
export async function getAuditLog(opts: {
  limit?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  since?: Date;
} = {}): Promise<AuditRow[]> {
  const limit = Math.min(opts.limit ?? 100, 1000);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (opts.action)     { values.push(opts.action);     clauses.push(`action = $${values.length}`); }
  if (opts.targetType) { values.push(opts.targetType); clauses.push(`target_type = $${values.length}`); }
  if (opts.targetId)   { values.push(opts.targetId);   clauses.push(`target_id = $${values.length}`); }
  if (opts.since)      { values.push(opts.since);      clauses.push(`created_at >= $${values.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);
  const rows = await prisma.$queryRawUnsafe<AuditRow[]>(
    `SELECT id, action, target_type, target_id, target_name,
            performed_by_user_id, performed_by_email, dry_run, metadata, created_at
     FROM platform_audit_log
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    ...values,
  );
  return rows;
}
