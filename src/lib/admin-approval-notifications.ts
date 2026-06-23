import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { ApprovalPolicySnapshot } from '@/lib/admin-approval-policy';
import { recordWorkflowNotificationEvent } from '@/lib/workflow-db';

type ApprovalNotificationEvent = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'EXECUTED';

async function findApprovalRecipients(args: {
  tenantId?: string | null;
  requesterId?: string | null;
}) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; email: string }>>(
    `SELECT DISTINCT u.id, u.email
       FROM "User" u
       JOIN user_tenants ut ON ut.user_id = u.id
       JOIN roles r ON r.id = ut.role_id
      WHERE u.is_active = TRUE
        AND COALESCE(ut.is_active, TRUE) = TRUE
        AND u.email IS NOT NULL
        AND ($1::text IS NULL OR ut.tenant_id = $1)
        AND ($2::text IS NULL OR u.id <> $2)
        AND (r.code IN ('SUPER_ADMIN','TENANT_ADMIN') OR r.code ILIKE '%ADMIN%')
      ORDER BY u.email
      LIMIT 25`,
    args.tenantId ?? null,
    args.requesterId ?? null,
  ).catch(() => []);
  return rows;
}

export async function notifyAdminApprovalEvent(args: {
  approvalId: string;
  tenantId?: string | null;
  requesterId?: string | null;
  action: string;
  summary?: string | null;
  event: ApprovalNotificationEvent;
  policy?: ApprovalPolicySnapshot | null;
}) {
  const recipients = await findApprovalRecipients({
    tenantId: args.tenantId,
    requesterId: args.requesterId,
  });
  if (!recipients.length) return { attempted: 0, recipients: [] as string[] };

  const subject = `[Fleet360] ${args.event.toLowerCase()} approval: ${args.action}`;
  const body = [
    `Approval: ${args.approvalId}`,
    `Action: ${args.action}`,
    `Risk: ${args.policy?.risk ?? 'unknown'}`,
    `SLA: ${args.policy?.sla?.status ?? 'unknown'}; due ${args.policy?.sla?.dueAt ?? '-'}`,
    args.summary ? `Summary: ${args.summary}` : null,
  ].filter(Boolean).join('\n');

  await prisma.notificationLog.createMany({
    data: recipients.map(recipient => ({
      id: randomUUID(),
      recipient: recipient.email,
      type: 'AdminApproval',
      subject,
      body,
      triggerReason: `admin_approval.${args.event.toLowerCase()}`,
      status: 'Queued',
    })),
  }).catch(() => undefined);

  await Promise.all(recipients.map(recipient =>
    recordWorkflowNotificationEvent({
      tenantId: args.tenantId ?? null,
      channel: 'IN_APP',
      event: `ADMIN_APPROVAL_${args.event}`,
      severity:
        args.event === 'REJECTED' ? 'warning'
        : args.event === 'EXECUTED' ? 'success'
        : args.event === 'ESCALATED' ? 'error'
        : 'info',
      title: `${args.action} approval ${args.event.toLowerCase()}`,
      message: args.summary ?? body,
      recipientEmail: recipient.email,
      payload: {
        approvalId: args.approvalId,
        action: args.action,
        event: args.event,
        risk: args.policy?.risk ?? null,
        dueAt: args.policy?.sla?.dueAt ?? null,
      },
    })
  )).catch(() => undefined);

  return { attempted: recipients.length, recipients: recipients.map(row => row.email) };
}
