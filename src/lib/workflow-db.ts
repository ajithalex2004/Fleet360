import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { getServiceTypeKeyCandidatesForProcedure } from '@/lib/service-config/workflow-procedure';

const _g = globalThis as { _workflowDbInit?: Promise<void> };

function _ensureWorkflowTablesOnce(): Promise<void> {
  if (_g._workflowDbInit) return _g._workflowDbInit;
  _g._workflowDbInit = _doInit().catch((e) => {
    delete _g._workflowDbInit;
    throw e;
  });
  return _g._workflowDbInit;
}

async function _doInit(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $DDL$
    BEGIN
      CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        module TEXT NOT NULL,
        procedure TEXT NOT NULL,
        description TEXT,
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );

      -- ── Phase 2 of the Service-Configuration ↔ Workflow merge ─────────
      -- Move workflows from the legacy (module, procedure) global keying
      -- to a per-service-type, per-tenant model so:
      --   • each WorkflowDefinition belongs to a specific ServiceType
      --     (matches the L2 hierarchy admins already configure)
      --   • workflows are tenant-scoped (multi-tenant correctness fix —
      --     they were previously shared across every tenant)
      --   • Phase 2E scope inheritance can override workflows at branch /
      --     region / department level via the same scope chain that
      --     resolves SLA + Approval rules.
      -- Columns are nullable during transition; legacy rows resolve via
      -- (module, procedure) fallback in triggerWorkflow().
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "serviceTypeId" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "tenantId"      TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "scopeId"       UUID;

      CREATE TABLE IF NOT EXISTS "WorkflowStep" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        "stepType" TEXT NOT NULL DEFAULT 'APPROVAL',
        "assigneeType" TEXT NOT NULL DEFAULT 'SPECIFIC_USER',
        "assigneeEmail" TEXT,
        "assigneeRoleCode" TEXT,
        "multiApproverEmails" TEXT,
        "requireAllApprovers" BOOLEAN DEFAULT false,
        "emailSubject" TEXT,
        "emailBody" TEXT,
        "slaHours" INTEGER DEFAULT 24,
        "escalationEmail" TEXT,
        "escalationHours" INTEGER DEFAULT 48,
        "conditionJson" TEXT,
        "isOptional" BOOLEAN DEFAULT false,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      -- Migrate existing WorkflowStep tables (add new columns if not present)
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "multiApproverEmails" TEXT;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "requireAllApprovers" BOOLEAN DEFAULT false;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationEmail" TEXT;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationHours" INTEGER DEFAULT 48;
      ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "conditionJson" TEXT;

      -- WorkflowDefinition defaults
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeType" TEXT DEFAULT 'SPECIFIC_USER';
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeEmail" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeRoleCode" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailSubject" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailBody" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultSlaHours" INTEGER DEFAULT 24;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationEmail" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationHours" INTEGER DEFAULT 48;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT';
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "currentVersionId" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "publishedVersionId" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "lastPublishedAt" TIMESTAMP;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "lastPublishedBy" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "studioLayoutJson" TEXT;
      ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "notificationPolicyJson" TEXT;

      -- Indexes for the new resolution paths.
      CREATE INDEX IF NOT EXISTS idx_workflow_def_servicetype
        ON "WorkflowDefinition" ("serviceTypeId") WHERE "serviceTypeId" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_def_tenant
        ON "WorkflowDefinition" ("tenantId") WHERE "tenantId" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_workflow_def_scope
        ON "WorkflowDefinition" ("scopeId") WHERE "scopeId" IS NOT NULL;

      -- Idempotent backfill — only fills rows where serviceTypeId is still
      -- NULL AND there is exactly one tenant with a service_type matching
      -- the workflow procedure key. Ambiguous matches (same key under
      -- multiple tenants) are left for manual reconciliation since cloning
      -- one global workflow into N tenant copies would silently change
      -- runtime behaviour. Guarded by the existence of service_types since
      -- that table is created lazily by the service-config module.
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'service_types'
      ) THEN
        WITH unique_matches AS (
          SELECT st.key,
                 MIN(st.id::text)    AS id,
                 MIN(st.tenant_id)   AS tenant_id,
                 COUNT(*)            AS n
          FROM service_types st
          WHERE st.deleted_at IS NULL
          GROUP BY st.key
          HAVING COUNT(*) = 1
        )
        UPDATE "WorkflowDefinition" wd
        SET "serviceTypeId" = um.id,
            "tenantId"      = um.tenant_id,
            "updatedAt"     = NOW()
        FROM unique_matches um
        WHERE wd."serviceTypeId" IS NULL
          AND wd.procedure = um.key;
      END IF;

      CREATE TABLE IF NOT EXISTS "WorkflowInstance" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "referenceType" TEXT NOT NULL,
        "referenceId" TEXT NOT NULL,
        "referenceNumber" TEXT,
        "currentStepOrder" INTEGER DEFAULT 1,
        status TEXT DEFAULT 'IN_PROGRESS',
        "initiatedByEmail" TEXT,
        "initiatedByName" TEXT,
        "initiatedAt" TIMESTAMP DEFAULT NOW(),
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "WorkflowStepInstance" (
        id TEXT PRIMARY KEY,
        "workflowInstanceId" TEXT NOT NULL,
        "stepId" TEXT NOT NULL,
        "stepOrder" INTEGER NOT NULL,
        "stepName" TEXT NOT NULL,
        "assignedToEmail" TEXT,
        "assignedToName" TEXT,
        status TEXT DEFAULT 'PENDING',
        comments TEXT,
        "actionedAt" TIMESTAMP,
        "actionedByEmail" TEXT,
        "dueAt" TIMESTAMP,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "WorkflowVersion" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        "versionNumber" INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        "snapshotJson" TEXT NOT NULL,
        "changeSummary" TEXT,
        "createdBy" TEXT,
        "publishedAt" TIMESTAMP,
        "publishedBy" TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_version_unique
        ON "WorkflowVersion" ("workflowId", "versionNumber");
      CREATE INDEX IF NOT EXISTS idx_workflow_version_workflow
        ON "WorkflowVersion" ("workflowId", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS "WorkflowNotificationEvent" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT,
        "workflowInstanceId" TEXT,
        "stepInstanceId" TEXT,
        "tenantId" TEXT,
        channel TEXT NOT NULL DEFAULT 'IN_APP',
        event TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        "recipientEmail" TEXT,
        "isRead" BOOLEAN DEFAULT false,
        payload TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "readAt" TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_notification_recipient
        ON "WorkflowNotificationEvent" ("recipientEmail", "isRead", "createdAt" DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_notification_workflow
        ON "WorkflowNotificationEvent" ("workflowId", "createdAt" DESC);

      CREATE TABLE IF NOT EXISTS "WorkflowAISuggestion" (
        id TEXT PRIMARY KEY,
        "workflowId" TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'HEURISTIC',
        category TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        rationale TEXT,
        recommendation TEXT,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "resolvedAt" TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_ai_workflow
        ON "WorkflowAISuggestion" ("workflowId", status, "createdAt" DESC);
    END
    $DDL$
  `);
}

//  Table Bootstrap
export async function ensureWorkflowTables() {
  await _ensureWorkflowTablesOnce();
}

export async function reconcileWorkflowServiceTypeLinks(tenantId?: string | null) {
  await ensureWorkflowTables();

  const workflows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    procedure: string;
    tenantId: string | null;
  }>>(
    `SELECT id::text AS id, procedure, "tenantId"
       FROM "WorkflowDefinition"
      WHERE "serviceTypeId" IS NULL
        AND ($1::text IS NULL OR "tenantId" = $1 OR "tenantId" IS NULL)`,
    tenantId ?? null,
  ).catch(() => []);

  for (const workflow of workflows) {
    const ownerTenantId = workflow.tenantId ?? tenantId ?? null;
    if (!ownerTenantId) continue;

    const serviceTypeCandidates = getServiceTypeKeyCandidatesForProcedure(workflow.procedure);
    if (serviceTypeCandidates.length === 0) continue;

    const matches = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM service_types
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND key = ANY($2::text[])
        ORDER BY created_at DESC
        LIMIT 2`,
      ownerTenantId,
      serviceTypeCandidates,
    ).catch(() => []);

    if (matches.length !== 1) continue;

    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowDefinition"
          SET "serviceTypeId" = $2,
              "tenantId" = COALESCE("tenantId", $3),
              "updatedAt" = NOW()
        WHERE id = $1
          AND "serviceTypeId" IS NULL`,
      workflow.id,
      matches[0].id,
      ownerTenantId,
    ).catch(() => undefined);
  }
}

type WorkflowSnapshot = {
  workflow: Record<string, any>;
  steps: Record<string, any>[];
};

async function getNextWorkflowVersionNumber(workflowId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ next_version: number }>>(
    `SELECT COALESCE(MAX("versionNumber"), 0) + 1 AS next_version
       FROM "WorkflowVersion"
      WHERE "workflowId" = $1`,
    workflowId,
  ).catch(() => []);
  return Number(rows[0]?.next_version ?? 1);
}

export async function buildWorkflowSnapshot(workflowId: string): Promise<WorkflowSnapshot | null> {
  const workflow = await getWorkflowWithSteps(workflowId);
  if (!workflow) return null;
  const { steps = [], ...definition } = workflow;
  return {
    workflow: definition,
    steps: Array.isArray(steps) ? steps : [],
  };
}

export async function snapshotWorkflowVersion(args: {
  workflowId: string;
  createdBy?: string | null;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  changeSummary?: string | null;
}) {
  await ensureWorkflowTables();
  const snapshot = await buildWorkflowSnapshot(args.workflowId);
  if (!snapshot) throw new Error('Workflow not found');

  const versionId = randomUUID();
  const versionNumber = await getNextWorkflowVersionNumber(args.workflowId);
  const status = args.status ?? 'DRAFT';

  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowVersion"
      (id, "workflowId", "versionNumber", status, "snapshotJson", "changeSummary", "createdBy", "publishedAt", "publishedBy")
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    versionId,
    args.workflowId,
    versionNumber,
    status,
    JSON.stringify(snapshot),
    args.changeSummary ?? null,
    args.createdBy ?? null,
    status === 'PUBLISHED' ? new Date() : null,
    status === 'PUBLISHED' ? (args.createdBy ?? null) : null,
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowDefinition"
        SET "currentVersionId" = $2,
            status = CASE
              WHEN $3 = 'PUBLISHED' THEN 'PUBLISHED'
              ELSE COALESCE(status, 'DRAFT')
            END,
            "publishedVersionId" = CASE
              WHEN $3 = 'PUBLISHED' THEN $2
              ELSE "publishedVersionId"
            END,
            "lastPublishedAt" = CASE
              WHEN $3 = 'PUBLISHED' THEN NOW()
              ELSE "lastPublishedAt"
            END,
            "lastPublishedBy" = CASE
              WHEN $3 = 'PUBLISHED' THEN $4
              ELSE "lastPublishedBy"
            END,
            "updatedAt" = NOW()
      WHERE id = $1`,
    args.workflowId,
    versionId,
    status,
    args.createdBy ?? null,
  );

  return { id: versionId, versionNumber, status, snapshot };
}

export async function listWorkflowVersions(workflowId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT id,
            "workflowId",
            "versionNumber",
            status,
            "changeSummary",
            "createdBy",
            "publishedAt",
            "publishedBy",
            "createdAt"
       FROM "WorkflowVersion"
      WHERE "workflowId" = $1
      ORDER BY "versionNumber" DESC`,
    workflowId,
  );
}

export async function rollbackWorkflowToVersion(args: {
  workflowId: string;
  versionId: string;
  actorUserId?: string | null;
}) {
  await ensureWorkflowTables();
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    workflowId: string;
    versionNumber: number;
    snapshotJson: WorkflowSnapshot | string;
  }>>(
    `SELECT id,
            "workflowId",
            "versionNumber",
            "snapshotJson"
       FROM "WorkflowVersion"
      WHERE id = $1
        AND "workflowId" = $2
      LIMIT 1`,
    args.versionId,
    args.workflowId,
  );
  const version = rows[0];
  if (!version) return null;

  const snapshot = typeof version.snapshotJson === 'string'
    ? JSON.parse(version.snapshotJson) as WorkflowSnapshot
    : version.snapshotJson;
  if (!snapshot?.workflow) {
    throw new Error('Workflow version snapshot is invalid');
  }

  const workflow = snapshot.workflow as Record<string, any>;
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];

  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      `UPDATE "WorkflowDefinition"
          SET name = $2,
              module = $3,
              procedure = $4,
              description = $5,
              "serviceTypeId" = $6,
              "tenantId" = $7,
              "scopeId" = $8::uuid,
              "isActive" = $9,
              "defaultAssigneeType" = $10,
              "defaultAssigneeEmail" = $11,
              "defaultAssigneeRoleCode" = $12,
              "defaultEmailSubject" = $13,
              "defaultEmailBody" = $14,
              "defaultSlaHours" = $15,
              "defaultEscalationEmail" = $16,
              "defaultEscalationHours" = $17,
              status = 'DRAFT',
              "studioLayoutJson" = $18,
              "notificationPolicyJson" = $19,
              "updatedAt" = NOW()
        WHERE id = $1`,
      args.workflowId,
      workflow.name,
      workflow.module,
      workflow.procedure,
      workflow.description ?? null,
      workflow.serviceTypeId ?? null,
      workflow.tenantId ?? null,
      workflow.scopeId ?? null,
      workflow.isActive ?? true,
      workflow.defaultAssigneeType ?? 'SPECIFIC_USER',
      workflow.defaultAssigneeEmail ?? null,
      workflow.defaultAssigneeRoleCode ?? null,
      workflow.defaultEmailSubject ?? null,
      workflow.defaultEmailBody ?? null,
      workflow.defaultSlaHours ?? 24,
      workflow.defaultEscalationEmail ?? null,
      workflow.defaultEscalationHours ?? 48,
      workflow.studioLayoutJson ?? null,
      workflow.notificationPolicyJson ?? null,
    );

    await tx.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE "workflowId" = $1`, args.workflowId);

    for (const step of steps) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "WorkflowStep"
          (id, "workflowId", "stepOrder", "stepName", "stepType", "assigneeType", "assigneeEmail",
           "assigneeRoleCode", "multiApproverEmails", "requireAllApprovers", "emailSubject", "emailBody",
           "slaHours", "escalationEmail", "escalationHours", "conditionJson", "isOptional")
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        randomUUID(),
        args.workflowId,
        step.stepOrder,
        step.stepName,
        step.stepType,
        step.assigneeType,
        step.assigneeEmail ?? null,
        step.assigneeRoleCode ?? null,
        step.multiApproverEmails ?? null,
        step.requireAllApprovers ?? false,
        step.emailSubject ?? null,
        step.emailBody ?? null,
        step.slaHours ?? 24,
        step.escalationEmail ?? null,
        step.escalationHours ?? 48,
        step.conditionJson ?? null,
        step.isOptional ?? false,
      );
    }
  });

  const restored = await snapshotWorkflowVersion({
    workflowId: args.workflowId,
    createdBy: args.actorUserId ?? null,
    status: 'DRAFT',
    changeSummary: `Rolled back workflow to version ${version.versionNumber}`,
  });

  return { version, restored };
}

export async function publishWorkflow(workflowId: string, publishedBy?: string | null, changeSummary?: string | null) {
  await ensureWorkflowTables();
  const version = await snapshotWorkflowVersion({
    workflowId,
    createdBy: publishedBy ?? null,
    status: 'PUBLISHED',
    changeSummary: changeSummary ?? 'Published from Workflow Studio',
  });
  return version;
}

export async function recordWorkflowNotificationEvent(input: {
  workflowId?: string | null;
  workflowInstanceId?: string | null;
  stepInstanceId?: string | null;
  tenantId?: string | null;
  channel?: string | null;
  event: string;
  severity?: string | null;
  title: string;
  message?: string | null;
  recipientEmail?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  await ensureWorkflowTables();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowNotificationEvent"
      (id, "workflowId", "workflowInstanceId", "stepInstanceId", "tenantId", channel, event, severity, title, message, "recipientEmail", payload)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    id,
    input.workflowId ?? null,
    input.workflowInstanceId ?? null,
    input.stepInstanceId ?? null,
    input.tenantId ?? null,
    input.channel ?? 'IN_APP',
    input.event,
    input.severity ?? 'info',
    input.title,
    input.message ?? null,
    input.recipientEmail ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
  ).catch(() => {});
  return id;
}

export async function listWorkflowNotificationEvents(args?: { workflowId?: string; recipientEmail?: string; unreadOnly?: boolean; limit?: number }) {
  await ensureWorkflowTables();
  const conditions: string[] = [];
  const values: any[] = [];
  let index = 1;
  if (args?.workflowId) {
    conditions.push(`"workflowId" = $${index++}`);
    values.push(args.workflowId);
  }
  if (args?.recipientEmail) {
    conditions.push(`"recipientEmail" = $${index++}`);
    values.push(args.recipientEmail);
  }
  if (args?.unreadOnly) {
    conditions.push(`COALESCE("isRead", false) = false`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(args?.limit ?? 50, 200));
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "workflowId", "workflowInstanceId", "stepInstanceId", "tenantId", channel, event, severity, title, message, "recipientEmail", "isRead", payload, "createdAt", "readAt"
       FROM "WorkflowNotificationEvent"
       ${where}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}`,
    ...values,
  );
}

export async function countWorkflowNotificationEvents(args?: { recipientEmail?: string; unreadOnly?: boolean }) {
  await ensureWorkflowTables();
  const conditions: string[] = [];
  const values: any[] = [];
  let index = 1;
  if (args?.recipientEmail) {
    conditions.push(`"recipientEmail" = $${index++}`);
    values.push(args.recipientEmail);
  }
  if (args?.unreadOnly) {
    conditions.push(`COALESCE("isRead", false) = false`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count
       FROM "WorkflowNotificationEvent"
       ${where}`,
    ...values,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markWorkflowNotificationEventsRead(args: {
  recipientEmail: string;
  notificationIds?: string[];
  markAll?: boolean;
}) {
  await ensureWorkflowTables();
  if (args.markAll) {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowNotificationEvent"
          SET "isRead" = true,
              "readAt" = NOW()
        WHERE "recipientEmail" = $1
          AND COALESCE("isRead", false) = false`,
      args.recipientEmail,
    );
    return;
  }

  const ids = (args.notificationIds ?? []).filter(Boolean);
  if (!ids.length) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowNotificationEvent"
        SET "isRead" = true,
            "readAt" = NOW()
      WHERE id = ANY($1::text[])
        AND "recipientEmail" = $2
        AND COALESCE("isRead", false) = false`,
    ids,
    args.recipientEmail,
  );
}

export async function upsertWorkflowAISuggestion(input: {
  workflowId: string;
  source?: string | null;
  category: string;
  severity?: string | null;
  title: string;
  rationale?: string | null;
  recommendation?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  await ensureWorkflowTables();
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM "WorkflowAISuggestion"
      WHERE "workflowId" = $1
        AND category = $2
        AND title = $3
        AND status = 'OPEN'
      LIMIT 1`,
    input.workflowId,
    input.category,
    input.title,
  ).catch(() => []);

  if (existing[0]?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowAISuggestion"
          SET source = $2,
              severity = $3,
              rationale = $4,
              recommendation = $5,
              payload = $6
        WHERE id = $1`,
      existing[0].id,
      input.source ?? 'HEURISTIC',
      input.severity ?? 'info',
      input.rationale ?? null,
      input.recommendation ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
    );
    return existing[0].id;
  }

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowAISuggestion"
      (id, "workflowId", source, category, severity, title, rationale, recommendation, payload)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    id,
    input.workflowId,
    input.source ?? 'HEURISTIC',
    input.category,
    input.severity ?? 'info',
    input.title,
    input.rationale ?? null,
    input.recommendation ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
  );
  return id;
}

export async function listWorkflowAISuggestions(workflowId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "workflowId", source, category, severity, title, rationale, recommendation, payload, status, "createdAt", "resolvedAt"
       FROM "WorkflowAISuggestion"
      WHERE "workflowId" = $1
      ORDER BY
        CASE severity
          WHEN 'error' THEN 1
          WHEN 'warning' THEN 2
          ELSE 3
        END,
        "createdAt" DESC`,
    workflowId,
  );
}

export async function refreshWorkflowAISuggestions(workflowId: string) {
  await ensureWorkflowTables();
  const workflow = await getWorkflowWithSteps(workflowId);
  if (!workflow) throw new Error('Workflow not found');

  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowAISuggestion"
        SET status = 'RESOLVED',
            "resolvedAt" = NOW()
      WHERE "workflowId" = $1
        AND source = 'HEURISTIC'
        AND status = 'OPEN'`,
    workflowId,
  ).catch(() => {});

  const steps = Array.isArray(workflow.steps) ? workflow.steps as Record<string, any>[] : [];
  const approvalSteps = steps.filter(step => String(step.stepType ?? '').toUpperCase() === 'APPROVAL');
  const roleLessApprovals = approvalSteps.filter(step => !step.assigneeEmail && !step.assigneeRoleCode);
  const missingEscalation = approvalSteps.filter(step => !Number(step.escalationHours ?? 0));
  const missingSla = steps.filter(step => !Number(step.slaHours ?? 0));

  if (approvalSteps.length === 0) {
    await upsertWorkflowAISuggestion({
      workflowId,
      category: 'coverage',
      severity: 'warning',
      title: 'No approval steps configured',
      rationale: 'This workflow has no explicit approval step, so dangerous actions may run without manual review.',
      recommendation: 'Add at least one approval step or link this workflow only to low-risk automated service types.',
      payload: { stepCount: steps.length },
    });
  }

  if (roleLessApprovals.length > 0) {
    await upsertWorkflowAISuggestion({
      workflowId,
      category: 'routing',
      severity: 'error',
      title: 'One or more approval steps have no approver routing',
      rationale: 'Approval steps without assignee email or role code cannot be delivered at runtime.',
      recommendation: 'Assign a role code or specific email to every approval step before publishing.',
      payload: { stepIds: roleLessApprovals.map(step => step.id), count: roleLessApprovals.length },
    });
  }

  if (missingEscalation.length > 0) {
    await upsertWorkflowAISuggestion({
      workflowId,
      category: 'sla',
      severity: 'warning',
      title: 'Escalation timing is missing on approval steps',
      rationale: 'Without escalation hours, overdue approvals may sit idle and never surface as operational risk.',
      recommendation: 'Set escalation hours per approval step or define workflow-level defaults before publish.',
      payload: { stepIds: missingEscalation.map(step => step.id), count: missingEscalation.length },
    });
  }

  if (missingSla.length > 0) {
    await upsertWorkflowAISuggestion({
      workflowId,
      category: 'sla',
      severity: 'info',
      title: 'Some steps still rely on implicit SLA behavior',
      rationale: 'Missing SLA hours make step urgency harder to monitor consistently across tenants and services.',
      recommendation: 'Define explicit SLA hours on all workflow steps to improve analytics and notifications.',
      payload: { stepIds: missingSla.map(step => step.id), count: missingSla.length },
    });
  }

  return listWorkflowAISuggestions(workflowId);
}

//  Workflow Definition CRUD
/**
 * List workflows with optional filters. Backward-compatible signature —
 * pass a string for the legacy module-only filter, or an options object
 * for the Phase 2 service-type / tenant filters.
 */
export async function listWorkflows(filter?: string | {
  module?: string;
  serviceTypeId?: string;
  tenantId?: string;
  lite?: boolean;
  reconcile?: boolean;
}) {
  await ensureWorkflowTables();
  const opts = typeof filter === 'string' ? { module: filter } : (filter ?? {});
  if (opts.reconcile !== false) {
    await reconcileWorkflowServiceTypeLinks(opts.tenantId ?? null);
  }
  const where: string[] = [];
  const args: any[] = [];
  let p = 1;
  if (opts.module)        { where.push(`wd.module = $${p++}`);                                        args.push(opts.module); }
  if (opts.serviceTypeId) { where.push(`(wd."serviceTypeId" = $${p++} OR wd."serviceTypeId" IS NULL)`); args.push(opts.serviceTypeId); }
  if (opts.tenantId)      { where.push(`(wd."tenantId" = $${p++} OR wd."tenantId" IS NULL)`);           args.push(opts.tenantId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (opts.lite) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT wd.id,
             wd.name,
             wd.module,
             wd.procedure,
             wd.description,
             wd."isActive",
             wd."serviceTypeId",
             wd."tenantId",
             wd."scopeId",
             wd.status,
             wd."currentVersionId",
             wd."publishedVersionId",
             wd."lastPublishedAt",
             wd."lastPublishedBy",
             COALESCE(step_counts.step_count, 0)::int AS "stepCount",
             COALESCE(instance_counts.active_instances, 0)::int AS "activeInstances",
             pending_delete.approval_id AS "pendingDeleteApprovalId",
             pending_delete.status AS "pendingDeleteStatus",
             pending_delete.execution_status AS "pendingDeleteExecutionStatus"
        FROM "WorkflowDefinition" wd
        LEFT JOIN (
          SELECT "workflowId", COUNT(*) AS step_count
            FROM "WorkflowStep"
           GROUP BY "workflowId"
        ) step_counts
          ON step_counts."workflowId" = wd.id
        LEFT JOIN (
          SELECT "workflowId", COUNT(*) AS active_instances
            FROM "WorkflowInstance"
           WHERE status = 'IN_PROGRESS'
           GROUP BY "workflowId"
        ) instance_counts
          ON instance_counts."workflowId" = wd.id
        LEFT JOIN LATERAL (
          SELECT id::text AS approval_id,
                 status,
                 execution_status
            FROM admin_approval_requests
           WHERE action = 'workflow.delete'
             AND target_id = wd.id
             AND (status = 'PENDING' OR (status = 'APPROVED' AND COALESCE(execution_status, '') <> 'EXECUTED'))
           ORDER BY created_at DESC
           LIMIT 1
        ) pending_delete ON TRUE
        ${whereSql}
       ORDER BY wd.module, wd.procedure
      `,
      ...args,
    );
    return rows;
  }

  const sql = where.length
    ? `SELECT * FROM "WorkflowDefinition" WHERE ${where.join(' AND ')} ORDER BY module, procedure`
    : `SELECT * FROM "WorkflowDefinition" ORDER BY module, procedure`;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const counts = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowStep"
     WHERE "workflowId" = ANY($1::text[]) GROUP BY "workflowId"`, ids);
  // active instances per workflow
  const instances = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "workflowId", COUNT(*) as count FROM "WorkflowInstance"
     WHERE "workflowId" = ANY($1::text[]) AND status='IN_PROGRESS' GROUP BY "workflowId"`, ids).catch(() => []);
  const pendingDeletes = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DISTINCT ON (target_id)
            target_id,
            id::text AS approval_id,
            status,
            execution_status
       FROM admin_approval_requests
      WHERE action = 'workflow.delete'
        AND target_id = ANY($1::text[])
        AND (status = 'PENDING' OR (status = 'APPROVED' AND COALESCE(execution_status, '') <> 'EXECUTED'))
      ORDER BY target_id, created_at DESC`,
    ids,
  ).catch(() => []);
  const countMap: Record<string, number> = {};
  const instanceMap: Record<string, number> = {};
  const pendingDeleteMap: Record<string, { approvalId: string; status: string; executionStatus: string | null }> = {};
  counts.forEach((c: any) => { countMap[c.workflowId] = parseInt(c.count); });
  (instances as any[]).forEach((c: any) => { instanceMap[c.workflowId] = parseInt(c.count); });
  (pendingDeletes as any[]).forEach((row: any) => {
    pendingDeleteMap[String(row.target_id)] = {
      approvalId: String(row.approval_id),
      status: String(row.status),
      executionStatus: row.execution_status ? String(row.execution_status) : null,
    };
  });
  return rows.map(r => ({
    ...r,
    stepCount:       countMap[r.id] ?? 0,
    activeInstances: instanceMap[r.id] ?? 0,
    pendingDeleteApprovalId: pendingDeleteMap[r.id]?.approvalId ?? null,
    pendingDeleteStatus: pendingDeleteMap[r.id]?.status ?? null,
    pendingDeleteExecutionStatus: pendingDeleteMap[r.id]?.executionStatus ?? null,
  }));
}

/**
 * Phase 3 — canonical resolver. Returns the active workflow for a given
 * service type at a given scope, walking the scope chain up to the tenant
 * root. Falls back to a tenant-wide (scopeId IS NULL) workflow if no
 * scope-specific one exists. Returns null when nothing is configured.
 *
 * Consumers should prefer this over the legacy (module, procedure) lookup.
 */
export async function getActiveWorkflowForServiceType(args: {
  serviceTypeId: string;
  tenantId: string;
  /** Optional active scope. When provided, the resolver walks parent
   *  scopes via service_scopes.parent_scope_id until a matching workflow
   *  is found, or reaches the tenant root. */
  scopeId?: string | null;
}): Promise<{ id: string; name: string; isActive: boolean } | null> {
  await ensureWorkflowTables();
  const { serviceTypeId, tenantId, scopeId } = args;

  // Build the scope chain (leaf → root) so we resolve overrides correctly.
  let scopeChain: string[] = [];
  if (scopeId) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `WITH RECURSIVE chain AS (
           SELECT id::text, parent_scope_id, 0 AS depth
             FROM service_scopes
            WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
           UNION ALL
           SELECT s.id::text, s.parent_scope_id, c.depth + 1
             FROM service_scopes s
             JOIN chain c ON s.id = c.parent_scope_id
            WHERE s.tenant_id = $2 AND s.deleted_at IS NULL
         )
         SELECT id FROM chain ORDER BY depth ASC`,
        scopeId, tenantId,
      );
      scopeChain = rows.map(r => r.id);
    } catch { scopeChain = [scopeId]; }
  }

  // 1) Walk the scope chain, leaf-first.
  for (const sId of scopeChain) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, "isActive"
         FROM "WorkflowDefinition"
        WHERE "serviceTypeId" = $1
          AND "tenantId"      = $2
          AND "scopeId"       = $3::uuid
          AND "isActive"      = true
        LIMIT 1`,
      serviceTypeId, tenantId, sId,
    );
    if (rows[0]) return rows[0];
  }

  // 2) Tenant-wide (scopeId IS NULL) — applies when no scope override.
  const tenantWide = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, "isActive"
       FROM "WorkflowDefinition"
      WHERE "serviceTypeId" = $1
        AND "tenantId"      = $2
        AND "scopeId"       IS NULL
        AND "isActive"      = true
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    serviceTypeId, tenantId,
  );
  return tenantWide[0] ?? null;
}

export async function getWorkflowWithSteps(id: string) {
  await ensureWorkflowTables();
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowDefinition" WHERE id = $1`, id);
  if (!rows.length) return null;
  const steps: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId" = $1 ORDER BY "stepOrder"`, id);
  return { ...rows[0], steps };
}

export async function createWorkflow(data: {
  name: string; module: string; procedure: string; description?: string;
  // Phase 2 — canonical service-type / tenant linkage. Optional during the
  // transition; the legacy (module, procedure) keying still works.
  serviceTypeId?: string | null;
  tenantId?:      string | null;
  scopeId?:       string | null;
  status?:        'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | null;
  studioLayoutJson?: string | null;
  notificationPolicyJson?: string | null;
}) {
  await ensureWorkflowTables();
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition"
       (id, name, module, procedure, description,
        "serviceTypeId", "tenantId", "scopeId", status, "studioLayoutJson", "notificationPolicyJson")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11)`,
    id, data.name, data.module, data.procedure, data.description ?? null,
    data.serviceTypeId ?? null, data.tenantId ?? null, data.scopeId ?? null,
    data.status ?? 'DRAFT', data.studioLayoutJson ?? null, data.notificationPolicyJson ?? null);
  return id;
}

export async function updateWorkflow(id: string, data: {
  name?: string; module?: string; procedure?: string; description?: string; isActive?: boolean;
  defaultAssigneeType?: string; defaultAssigneeEmail?: string; defaultAssigneeRoleCode?: string;
  defaultEmailSubject?: string; defaultEmailBody?: string;
  defaultSlaHours?: number; defaultEscalationEmail?: string; defaultEscalationHours?: number;
  status?: string; studioLayoutJson?: string; notificationPolicyJson?: string;
}) {
  await ensureWorkflowTables();
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowDefinition"
     SET name=COALESCE($2,name),
         module=COALESCE($3,module),
         procedure=COALESCE($4,procedure),
         description=COALESCE($5,description),
         "isActive"=COALESCE($6,"isActive"),
         "defaultAssigneeType"=COALESCE($7,"defaultAssigneeType"),
         "defaultAssigneeEmail"=COALESCE($8,"defaultAssigneeEmail"),
         "defaultAssigneeRoleCode"=COALESCE($9,"defaultAssigneeRoleCode"),
         "defaultEmailSubject"=COALESCE($10,"defaultEmailSubject"),
         "defaultEmailBody"=COALESCE($11,"defaultEmailBody"),
         "defaultSlaHours"=COALESCE($12,"defaultSlaHours"),
         "defaultEscalationEmail"=COALESCE($13,"defaultEscalationEmail"),
         "defaultEscalationHours"=COALESCE($14,"defaultEscalationHours"),
         status=COALESCE($15,status),
         "studioLayoutJson"=COALESCE($16,"studioLayoutJson"),
         "notificationPolicyJson"=COALESCE($17,"notificationPolicyJson"),
         "updatedAt"=NOW()
     WHERE id=$1`,
    id, data.name ?? null, data.module ?? null, data.procedure ?? null,
    data.description ?? null, data.isActive ?? null,
    data.defaultAssigneeType ?? null, data.defaultAssigneeEmail ?? null,
    data.defaultAssigneeRoleCode ?? null, data.defaultEmailSubject ?? null,
    data.defaultEmailBody ?? null, data.defaultSlaHours ?? null,
    data.defaultEscalationEmail ?? null, data.defaultEscalationHours ?? null,
    data.status ?? null, data.studioLayoutJson ?? null, data.notificationPolicyJson ?? null);
}

export async function deleteWorkflow(id: string) {
  await ensureWorkflowTables();
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE "workflowId" = $1`, id);
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowDefinition" WHERE id = $1`, id);
}

export async function duplicateWorkflow(id: string) {
  const original = await getWorkflowWithSteps(id);
  if (!original) throw new Error('Workflow not found');
  const newId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowDefinition"
       (id, name, module, procedure, description, "serviceTypeId", "tenantId", "scopeId", "isActive")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,false)`,
    newId, `${original.name} (Copy)`, original.module, original.procedure, original.description ?? null,
    original.serviceTypeId ?? null, original.tenantId ?? null, original.scopeId ?? null);
  for (const step of (original.steps ?? [])) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStep"
       (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
        "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
        "slaHours","escalationEmail","escalationHours","conditionJson","isOptional")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      randomUUID(), newId, step.stepOrder, step.stepName, step.stepType,
      step.assigneeType, step.assigneeEmail ?? null, step.assigneeRoleCode ?? null,
      step.multiApproverEmails ?? null, step.requireAllApprovers ?? false,
      step.emailSubject ?? null, step.emailBody ?? null, step.slaHours ?? 24,
      step.escalationEmail ?? null, step.escalationHours ?? 48,
      step.conditionJson ?? null, step.isOptional ?? false);
  }
  return newId;
}

//  Global Stats 
export async function getWorkflowStats() {
  await ensureWorkflowTables();
  const totals = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN "isActive" THEN 1 ELSE 0 END) as active
     FROM "WorkflowDefinition"`);
  const pending = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) as count FROM "WorkflowStepInstance" WHERE status='PENDING'`
  ).catch(() => [{ count: 0 }]);
  const instances = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) as count FROM "WorkflowInstance" WHERE status='IN_PROGRESS'`
  ).catch(() => [{ count: 0 }]);
  return {
    total: parseInt(totals[0]?.total ?? 0),
    active: parseInt(totals[0]?.active ?? 0),
    pendingApprovals: parseInt((pending[0] as any)?.count ?? 0),
    activeInstances: parseInt((instances[0] as any)?.count ?? 0),
  };
}

//  Workflow Step CRUD 
export async function listSteps(workflowId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId" = $1 ORDER BY "stepOrder"`, workflowId);
}

export async function createStep(workflowId: string, data: {
  stepOrder: number; stepName: string; stepType: string;
  assigneeType: string; assigneeEmail?: string; assigneeRoleCode?: string;
  multiApproverEmails?: string; requireAllApprovers?: boolean;
  emailSubject?: string; emailBody?: string; slaHours?: number;
  escalationEmail?: string; escalationHours?: number;
  conditionJson?: string; isOptional?: boolean;
}) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowStep"
     (id,"workflowId","stepOrder","stepName","stepType","assigneeType","assigneeEmail",
      "assigneeRoleCode","multiApproverEmails","requireAllApprovers","emailSubject","emailBody",
      "slaHours","escalationEmail","escalationHours","conditionJson","isOptional")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    id, workflowId, data.stepOrder, data.stepName, data.stepType, data.assigneeType,
    data.assigneeEmail ?? null, data.assigneeRoleCode ?? null,
    data.multiApproverEmails ?? null, data.requireAllApprovers ?? false,
    data.emailSubject ?? null, data.emailBody ?? null, data.slaHours ?? 24,
    data.escalationEmail ?? null, data.escalationHours ?? 48,
    data.conditionJson ?? null, data.isOptional ?? false);
  return id;
}

export async function updateStep(stepId: string, data: {
  stepOrder?: number; stepName?: string; stepType?: string;
  assigneeType?: string; assigneeEmail?: string; assigneeRoleCode?: string;
  multiApproverEmails?: string; requireAllApprovers?: boolean;
  emailSubject?: string; emailBody?: string; slaHours?: number;
  escalationEmail?: string; escalationHours?: number;
  conditionJson?: string; isOptional?: boolean;
}) {
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStep" SET
      "stepOrder"=COALESCE($2,"stepOrder"),
      "stepName"=COALESCE($3,"stepName"),
      "stepType"=COALESCE($4,"stepType"),
      "assigneeType"=COALESCE($5,"assigneeType"),
      "assigneeEmail"=COALESCE($6,"assigneeEmail"),
      "assigneeRoleCode"=COALESCE($7,"assigneeRoleCode"),
      "multiApproverEmails"=COALESCE($8,"multiApproverEmails"),
      "requireAllApprovers"=COALESCE($9,"requireAllApprovers"),
      "emailSubject"=COALESCE($10,"emailSubject"),
      "emailBody"=COALESCE($11,"emailBody"),
      "slaHours"=COALESCE($12,"slaHours"),
      "escalationEmail"=COALESCE($13,"escalationEmail"),
      "escalationHours"=COALESCE($14,"escalationHours"),
      "conditionJson"=COALESCE($15,"conditionJson"),
      "isOptional"=COALESCE($16,"isOptional")
    WHERE id=$1`,
    stepId,
    data.stepOrder ?? null, data.stepName ?? null, data.stepType ?? null,
    data.assigneeType ?? null, data.assigneeEmail ?? null, data.assigneeRoleCode ?? null,
    data.multiApproverEmails ?? null, data.requireAllApprovers ?? null,
    data.emailSubject ?? null, data.emailBody ?? null, data.slaHours ?? null,
    data.escalationEmail ?? null, data.escalationHours ?? null,
    data.conditionJson ?? null, data.isOptional ?? null);
}

export async function deleteStep(stepId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "WorkflowStep" WHERE id = $1`, stepId);
}

//  Workflow Engine
export async function triggerWorkflow(params: {
  // Canonical Phase 2 keying — preferred for new callers.
  serviceTypeId?: string;
  tenantId?:      string;
  scopeId?:       string | null;
  // Legacy keying — still supported. If serviceTypeId is provided, the
  // resolver tries that first and only falls back to (module, procedure).
  module?:    string;
  procedure?: string;
  referenceType: string; referenceId: string; referenceNumber: string;
  initiatedByEmail: string; initiatedByName?: string;
  contextData?: Record<string, any>;
  force?: boolean; // set true to re-trigger even if already in progress
}) {
  await ensureWorkflowTables();

  // Resolution order:
  //   1) (serviceTypeId, tenantId, scopeId) — Phase 2 canonical path
  //   2) (module, procedure)                — legacy fallback
  let wfRows: any[] = [];
  if (params.serviceTypeId && params.tenantId) {
    const found = await getActiveWorkflowForServiceType({
      serviceTypeId: params.serviceTypeId,
      tenantId:      params.tenantId,
      scopeId:       params.scopeId ?? null,
    });
    if (found) {
      wfRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "WorkflowDefinition" WHERE id = $1 LIMIT 1`,
        found.id,
      );
    }
  }
  if (!wfRows.length && params.module && params.procedure) {
    wfRows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowDefinition"
       WHERE module=$1 AND procedure=$2 AND "isActive"=true LIMIT 1`,
      params.module, params.procedure);
  }
  if (!wfRows.length) {
    const key = params.serviceTypeId
      ? `serviceType=${params.serviceTypeId} tenant=${params.tenantId}`
      : `module=${params.module} procedure=${params.procedure}`;
    console.warn(`[Workflow] No active workflow for ${key}`);
    return { error: `No active workflow found for ${key}. Please define and activate one in Admin > Service Configuration > Workflow.` };
  }

  const wf = wfRows[0];

  // Idempotency: if an IN_PROGRESS instance already exists for this referenceId, return it
  if (!params.force) {
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "WorkflowInstance" WHERE "referenceId"=$1 AND "workflowId"=$2 AND status='IN_PROGRESS' LIMIT 1`,
      params.referenceId, wf.id);
    if (existing.length) {
      console.info(`[Workflow] Reusing existing instance ${existing[0].id} for ${params.referenceNumber}`);
      return { instanceId: existing[0].id, workflowName: wf.name, reused: true };
    }
  }

  const steps: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStep" WHERE "workflowId"=$1 ORDER BY "stepOrder"`, wf.id);
  if (!steps.length) {
    console.warn(`[Workflow] Workflow "${wf.name}" has no steps. Add steps in Admin > Workflow Management.`);
    return { error: `Workflow "${wf.name}" has no steps configured. Add steps in Admin > Workflow Management.` };
  }

  const instanceId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WorkflowInstance"
     (id,"workflowId","referenceType","referenceId","referenceNumber",
      "currentStepOrder",status,"initiatedByEmail","initiatedByName")
     VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',$7,$8)`,
    instanceId, wf.id, params.referenceType, params.referenceId,
    params.referenceNumber, steps[0].stepOrder,
    params.initiatedByEmail, params.initiatedByName ?? null);

  for (const step of steps) {
    const siId = randomUUID();
    const dueAt = step.slaHours
      ? new Date(Date.now() + step.slaHours * 3600000).toISOString() : null;
    const isPending = step.stepOrder === steps[0].stepOrder;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WorkflowStepInstance"
       (id,"workflowInstanceId","stepId","stepOrder","stepName","assignedToEmail","assignedToName",status,"dueAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      siId, instanceId, step.id, step.stepOrder, step.stepName,
      step.assigneeEmail ?? null, null,
      isPending ? 'PENDING' : 'WAITING', dueAt);
  }

  const firstStep = steps[0];
  if (firstStep.assigneeEmail && firstStep.stepType === 'APPROVAL') {
    await recordWorkflowNotificationEvent({
      workflowId: wf.id,
      workflowInstanceId: instanceId,
      tenantId: wf.tenantId ?? params.tenantId ?? null,
      channel: 'IN_APP',
      event: 'APPROVAL_ASSIGNED',
      severity: 'info',
      title: `${params.referenceNumber} assigned for approval`,
      message: `${firstStep.stepName} is waiting on ${firstStep.assigneeEmail}.`,
      recipientEmail: firstStep.assigneeEmail,
      payload: {
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        referenceNumber: params.referenceNumber,
        stepName: firstStep.stepName,
      },
    });
    await sendWorkflowEmail({
      to: firstStep.assigneeEmail,
      subject: firstStep.emailSubject ??
        `Action Required: ${params.referenceNumber} awaiting your approval`,
      body: firstStep.emailBody ??
        `Dear Approver,\n\n${params.referenceNumber} (${params.referenceType}) has been submitted for your approval.\n\nStep: ${firstStep.stepName}\nSubmitted by: ${params.initiatedByEmail}\n\nPlease log in to Fleet360 to review and approve.`,
      instanceId, referenceNumber: params.referenceNumber,
      referenceType: params.referenceType, stepName: firstStep.stepName,
    });
  }
  if (firstStep.stepType === 'NOTIFICATION') {
    await advanceWorkflow(instanceId, firstStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }

  return { instanceId, workflowName: wf.name };
}

export async function advanceWorkflow(
  instanceId: string, currentStepOrder: number,
  action: 'APPROVE' | 'REJECT' | 'AUTO', comments: string, actionedByEmail: string
) {
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance"
     SET status=$1, comments=$2, "actionedAt"=NOW(), "actionedByEmail"=$3
     WHERE "workflowInstanceId"=$4 AND "stepOrder"=$5 AND status='PENDING'`,
    action === 'REJECT' ? 'REJECTED' : 'APPROVED',
    comments, actionedByEmail, instanceId, currentStepOrder);

  const currentRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT wi."workflowId", wi."referenceNumber", wi."referenceType", wsi.id AS "stepInstanceId", wsi."stepName"
       FROM "WorkflowStepInstance" wsi
       JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
      WHERE wsi."workflowInstanceId" = $1
        AND wsi."stepOrder" = $2
      LIMIT 1`,
    instanceId,
    currentStepOrder,
  ).catch(() => []);
  const currentStep = currentRows[0];

  if (action === 'REJECT') {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='REJECTED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, instanceId);
    if (currentStep?.workflowId) {
      await recordWorkflowNotificationEvent({
        workflowId: currentStep.workflowId,
        workflowInstanceId: instanceId,
        stepInstanceId: currentStep.stepInstanceId ?? null,
        channel: 'IN_APP',
        event: 'APPROVAL_REJECTED',
        severity: 'warning',
        title: `${currentStep.referenceNumber ?? instanceId} was rejected`,
        message: `${currentStep.stepName ?? 'Approval step'} was rejected by ${actionedByEmail}.`,
        recipientEmail: actionedByEmail,
        payload: { comments },
      });
    }
    return { status: 'REJECTED' };
  }

  const nextSteps: any[] = await prisma.$queryRawUnsafe(
    `SELECT ws.* FROM "WorkflowStepInstance" wsi
     JOIN "WorkflowStep" ws ON ws.id=wsi."stepId"
     WHERE wsi."workflowInstanceId"=$1 AND wsi."stepOrder">$2 AND wsi.status='WAITING'
     ORDER BY wsi."stepOrder" LIMIT 1`,
    instanceId, currentStepOrder);

  if (!nextSteps.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "WorkflowInstance"
       SET status='APPROVED',"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, instanceId);
    if (currentStep?.workflowId) {
      await recordWorkflowNotificationEvent({
        workflowId: currentStep.workflowId,
        workflowInstanceId: instanceId,
        stepInstanceId: currentStep.stepInstanceId ?? null,
        channel: 'IN_APP',
        event: 'WORKFLOW_COMPLETED',
        severity: 'success',
        title: `${currentStep.referenceNumber ?? instanceId} completed`,
        message: `Workflow ${currentStep.referenceType ?? ''} completed after ${currentStep.stepName ?? 'final step'}.`,
        recipientEmail: actionedByEmail,
      });
    }
    return { status: 'APPROVED' };
  }

  const nextStep = nextSteps[0];
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowStepInstance" SET status='PENDING'
     WHERE "workflowInstanceId"=$1 AND "stepOrder"=$2`,
    instanceId, nextStep.stepOrder);
  await prisma.$executeRawUnsafe(
    `UPDATE "WorkflowInstance" SET "currentStepOrder"=$1,"updatedAt"=NOW() WHERE id=$2`,
    nextStep.stepOrder, instanceId);

  if (nextStep.assigneeEmail && nextStep.stepType === 'APPROVAL') {
    const instance: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WorkflowInstance" WHERE id=$1`, instanceId);
    if (instance.length) {
      await recordWorkflowNotificationEvent({
        workflowId: instance[0].workflowId,
        workflowInstanceId: instanceId,
        channel: 'IN_APP',
        event: 'APPROVAL_ASSIGNED',
        severity: 'info',
        title: `${instance[0].referenceNumber} assigned for approval`,
        message: `${nextStep.stepName} is now pending with ${nextStep.assigneeEmail}.`,
        recipientEmail: nextStep.assigneeEmail,
        payload: {
          referenceType: instance[0].referenceType,
          referenceId: instance[0].referenceId,
          referenceNumber: instance[0].referenceNumber,
          stepName: nextStep.stepName,
        },
      });
      await sendWorkflowEmail({
        to: nextStep.assigneeEmail,
        subject: nextStep.emailSubject ??
          `Action Required: ${instance[0].referenceNumber}  Step ${nextStep.stepOrder}: ${nextStep.stepName}`,
        body: nextStep.emailBody ??
          `Dear Approver,\n\n${instance[0].referenceNumber} requires your approval.\n\nStep: ${nextStep.stepName}\n\nPlease log in to Fleet360 to review.`,
        instanceId, referenceNumber: instance[0].referenceNumber,
        referenceType: instance[0].referenceType, stepName: nextStep.stepName,
      });
    }
  }
  if (nextStep.stepType === 'NOTIFICATION') {
    return advanceWorkflow(instanceId, nextStep.stepOrder, 'AUTO',
      'Auto-advanced (notification step)', 'system');
  }
  return { status: 'IN_PROGRESS', nextStep: nextStep.stepName };
}

export async function getMyPendingApprovals(email: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT
      wsi.id as "stepInstanceId",
      wsi."workflowInstanceId",
      wsi."stepName",
      wsi."dueAt",
      wsi."createdAt" as "receivedAt",
      wi."referenceType",
      wi."referenceId",
      wi."referenceNumber",
      wi."initiatedByEmail",
      wi."initiatedByName",
      wi."initiatedAt",
      wd.name as "workflowName",
      wd.module,
      wd.procedure
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    WHERE wsi."assignedToEmail" = $1 AND wsi.status = 'PENDING'
    ORDER BY wsi."createdAt" DESC
  `, email);
}

export async function getWorkflowInstanceWithHistory(instanceId: string) {
  await ensureWorkflowTables();
  const instances: any[] = await prisma.$queryRawUnsafe(`
    SELECT wi.*, wd.name as "workflowName", wd.module, wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi.id=$1
  `, instanceId);
  if (!instances.length) return null;
  const stepInstances: any[] = await prisma.$queryRawUnsafe(
    `SELECT * FROM "WorkflowStepInstance" WHERE "workflowInstanceId"=$1 ORDER BY "stepOrder"`,
    instanceId);
  return { ...instances[0], steps: stepInstances };
}

export async function getInstancesForReference(referenceId: string) {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT wi.*, wd.name as "workflowName", wd.procedure
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    WHERE wi."referenceId"=$1
    ORDER BY wi."createdAt" DESC
  `, referenceId);
}

//  Email Sender 
async function sendWorkflowEmail(params: {
  to: string; subject: string; body: string;
  instanceId: string; referenceNumber: string; referenceType: string; stepName: string;
}) {
  try {
    const cfgRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" WHERE type='EMAIL' AND "isActive"=true LIMIT 1`);
    if (!cfgRows.length) {
      console.warn('[Workflow] Email skipped: no active EMAIL integration configured. Go to Admin > Integrations to set up SMTP.');
      return;
    }
    const cfg = cfgRows[0];
    const config = typeof cfg.config === 'string' ? JSON.parse(cfg.config) : cfg.config;
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: config.smtpHost, port: parseInt(config.smtpPort) || 587,
      secure: config.smtpSecure === true || config.smtpPort === '465',
      auth: { user: config.smtpUser, pass: config.smtpPassword },
    });
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/approvals`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px;border-radius:10px;margin-bottom:24px;">
          <h1 style="color:white;margin:0;font-size:20px;">Action Required</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">Fleet360</p>
        </div>
        <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0;">
          <h2 style="color:#1e293b;margin:0 0 16px;font-size:18px;">${params.stepName}</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px;background:#f1f5f9;border-radius:6px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Reference</td><td style="padding:8px;color:#1e293b;font-weight:700;">${params.referenceNumber}</td></tr>
            <tr><td style="padding:8px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Type</td><td style="padding:8px;color:#1e293b;">${params.referenceType}</td></tr>
          </table>
          <pre style="font-family:Arial,sans-serif;white-space:pre-wrap;color:#374151;line-height:1.6;">${params.body}</pre>
          <a href="${approvalUrl}" style="display:inline-block;margin-top:20px;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review &amp; Approve</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center;">Fleet360 Platform</p>
      </div>
    `;
    await transporter.sendMail({
      from: config.fromEmail ?? config.smtpUser,
      to: params.to, subject: params.subject, html,
    });
  } catch (e: any) {
    console.error('Workflow email error:', e?.message);
  }
}

// Returns ALL pending step instances (admin view - no email filter)
export async function getAllPendingStepInstances() {
  await ensureWorkflowTables();
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT
      wsi.id as "stepInstanceId",
      wsi."workflowInstanceId",
      wsi."stepName",
      wsi."assignedToEmail",
      wsi."assignedToName",
      wsi."dueAt",
      wsi."createdAt" as "receivedAt",
      wsi.status as "stepStatus",
      wi."referenceType",
      wi."referenceId",
      wi."referenceNumber",
      wi."initiatedByEmail",
      wi."initiatedByName",
      wi."initiatedAt",
      wi.status as "instanceStatus",
      wd.name as "workflowName",
      wd.module,
      wd.procedure
    FROM "WorkflowStepInstance" wsi
    JOIN "WorkflowInstance" wi ON wi.id = wsi."workflowInstanceId"
    JOIN "WorkflowDefinition" wd ON wd.id = wi."workflowId"
    WHERE wsi.status = 'PENDING'
    ORDER BY wsi."createdAt" DESC
  `);
}

// Returns all workflow instances (admin overview)
export async function getAllWorkflowInstances(opts?: { status?: string; module?: string; limit?: number }) {
  await ensureWorkflowTables();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (opts?.status) { conditions.push(`wi.status=$${idx++}`); values.push(opts.status); }
  if (opts?.module) { conditions.push(`wd.module=$${idx++}`); values.push(opts.module); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts?.limit ?? 100;
  return prisma.$queryRawUnsafe<any[]>(`
    SELECT
      wi.id, wi.status, wi."referenceType", wi."referenceId", wi."referenceNumber",
      wi."currentStepOrder", wi."initiatedByEmail", wi."initiatedAt", wi."completedAt",
      wd.name as "workflowName", wd.module, wd.procedure,
      (SELECT COUNT(*) FROM "WorkflowStepInstance" s WHERE s."workflowInstanceId"=wi.id) as "totalSteps",
      (SELECT COUNT(*) FROM "WorkflowStepInstance" s WHERE s."workflowInstanceId"=wi.id AND s.status='APPROVED') as "completedSteps"
    FROM "WorkflowInstance" wi
    JOIN "WorkflowDefinition" wd ON wd.id=wi."workflowId"
    ${where}
    ORDER BY wi."initiatedAt" DESC
    LIMIT ${limit}
  `, ...values);
}
