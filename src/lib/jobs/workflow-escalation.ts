/**
 * workflow-escalation — emails a level's escalation contact when an
 * approval has waited on that level longer than its escalation time.
 *
 * Escalation contact and time: the level's own (Admin > Workflows > step),
 * else the workflow's defaults; levels with no contact are not escalated.
 * Counted from when the level opened. Each level escalates once: the claim
 * (escalatedAt) is set before the email goes, so overlapping runs never send
 * twice. Runs in platform context ('*') across tenants; each email is
 * rendered with its tenant's template (Admin > Email templates,
 * "Approval escalation").
 */
import { prisma } from '@/lib/prisma';
import { runAsTenant } from '@/lib/rls-scope';
import { parseEmailList } from '@/lib/workflow-db';
import type { JobContext, JobResult } from './registry';

/** Most levels escalated per run; the rest go on the next run. */
const BATCH = 200;

interface DueLevel {
  stepInstanceId: string;
  tenantId: string;
  stepName: string;
  referenceType: string;
  referenceNumber: string | null;
  workflowName: string;
  module: string;
  initiatedByName: string | null;
  initiatedByEmail: string | null;
  approverEmails: string[] | null;
  escalationEmail: string;
  hours: number;
  openedAt: Date;
}

export async function runWorkflowEscalation(ctx: JobContext): Promise<JobResult> {
  const dryRun = ctx.searchParams.get('dryRun') === 'true';
  const due = await runAsTenant('*', () => prisma.$queryRawUnsafe<DueLevel[]>(
    `SELECT wsi.id AS "stepInstanceId", wsi."tenantId", wsi."stepName",
            wi."referenceType", wi."referenceNumber", wi."initiatedByName", wi."initiatedByEmail",
            wd.name AS "workflowName", wd.module, wsi."approverEmails",
            COALESCE(NULLIF(trim(ws."escalationEmail"), ''), NULLIF(trim(wd."defaultEscalationEmail"), '')) AS "escalationEmail",
            esc.hours, COALESCE(wsi."activatedAt", wsi."createdAt") AS "openedAt"
       FROM "WorkflowStepInstance" wsi
       JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId" AND wi.status = 'IN_PROGRESS'
       JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
       LEFT JOIN "WorkflowStep" ws ON ws.id = wsi."stepId"
       CROSS JOIN LATERAL (SELECT COALESCE(NULLIF(ws."escalationHours", 0), NULLIF(wd."defaultEscalationHours", 0), 48) AS hours) esc
      WHERE wsi.status = 'PENDING'
        AND wsi."escalatedAt" IS NULL
        AND wsi."tenantId" IS NOT NULL
        AND esc.hours > 0
        AND COALESCE(wsi."activatedAt", wsi."createdAt") + make_interval(hours => esc.hours) <= NOW()
        AND COALESCE(NULLIF(trim(ws."escalationEmail"), ''), NULLIF(trim(wd."defaultEscalationEmail"), '')) IS NOT NULL
      ORDER BY COALESCE(wsi."activatedAt", wsi."createdAt")
      LIMIT ${BATCH}`,
  ));

  if (dryRun) {
    return {
      status: 'ok',
      summary: `${due.length} approval level(s) due for escalation (dry run)`,
      data: { due: due.map((d) => ({ stepInstanceId: d.stepInstanceId, tenantId: d.tenantId, referenceNumber: d.referenceNumber })) },
    };
  }

  let escalated = 0;
  let notSent = 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  for (const level of due) {
    const to = parseEmailList(level.escalationEmail);
    // Claim first: a level escalates once, even if the email then fails.
    const claimed = await runAsTenant('*', () => prisma.$executeRawUnsafe(
      `UPDATE "WorkflowStepInstance" SET "escalatedAt" = NOW() WHERE id = $1 AND "escalatedAt" IS NULL AND status = 'PENDING'`,
      level.stepInstanceId));
    if (!claimed) continue;
    if (!to.length) { notSent++; continue; }
    const waitedHours = Math.floor((Date.now() - new Date(level.openedAt).getTime()) / 3_600_000);
    try {
      const { sendTemplatedEmail } = await import('@/lib/email-templates');
      const result = await runAsTenant(level.tenantId, () => sendTemplatedEmail({
        tenantId: level.tenantId, key: 'workflow.escalation', to,
        values: {
          referenceNumber: level.referenceNumber ?? '',
          referenceType: level.referenceType,
          stepName: level.stepName,
          workflowName: level.workflowName,
          moduleLabel: level.module.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          submittedBy: level.initiatedByName || level.initiatedByEmail || '',
          waitingWith: (level.approverEmails ?? []).join(', ') || '—',
          hoursWaiting: String(waitedHours),
          approvalUrl: `${appUrl}/approvals`,
        },
      }));
      if (result.sent) escalated++;
      else notSent++;
    } catch (e) {
      notSent++;
      console.error('[workflow-escalation] Email failed:', e instanceof Error ? e.message : e);
    }
  }

  return {
    status: 'ok',
    summary: `${escalated} approval level(s) escalated${notSent ? `, ${notSent} could not be emailed` : ''}`,
    data: { due: due.length, escalated, notSent },
  };
}
