-- Move runtime DDL out of src/lib/workflow-db.ts (ensureWorkflowTables /
-- _doInit). Zero external callers of the guard function itself — every
-- call site was internal to that file.
--
-- DDL-only: no RLS is added here. Every query in workflow-db.ts uses the
-- bare `prisma` client, never a tenant-scoped transaction from
-- withTenantRls, so app.tenant_id is never set when these tables are
-- queried. Enabling RLS on them today would make every query return
-- zero rows and break the whole approval-workflow engine (leasing
-- credit approval, service-ticket approvals, etc.), not fix anything.
-- WorkflowStep / WorkflowInstance / WorkflowStepInstance also have no
-- tenant_id column at all — they'd need either a denormalised column
-- with backfill or join-based policies, a bigger design decision.
--
-- Real tenant-isolation gap confirmed separately (not fixed here):
-- listWorkflows() only filters by tenantId when a caller explicitly
-- passes one; legacy (module, procedure)-only calls return every
-- tenant's matching workflows. Left as its own planned effort — start
-- with a full caller inventory across workflow-db.ts's ~19 exported
-- functions before touching signatures.
--
-- Transcribed verbatim from the original DO $DDL$ block (already a
-- single statement for the same reason migrations want one: a 42501
-- partway through can't leave the schema half-created).

DO $$
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

  -- Phase 2 of the Service-Configuration <-> Workflow merge — see
  -- src/lib/workflow-db.ts for the full rationale. Columns nullable
  -- during transition; legacy rows resolve via (module, procedure)
  -- fallback in triggerWorkflow().
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

  ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "multiApproverEmails" TEXT;
  ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "requireAllApprovers" BOOLEAN DEFAULT false;
  ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationEmail" TEXT;
  ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "escalationHours" INTEGER DEFAULT 48;
  ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "conditionJson" TEXT;

  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeType" TEXT DEFAULT 'SPECIFIC_USER';
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeEmail" TEXT;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultAssigneeRoleCode" TEXT;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailSubject" TEXT;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEmailBody" TEXT;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultSlaHours" INTEGER DEFAULT 24;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationEmail" TEXT;
  ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "defaultEscalationHours" INTEGER DEFAULT 48;

  CREATE INDEX IF NOT EXISTS idx_workflow_def_servicetype
    ON "WorkflowDefinition" ("serviceTypeId") WHERE "serviceTypeId" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_workflow_def_tenant
    ON "WorkflowDefinition" ("tenantId") WHERE "tenantId" IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_workflow_def_scope
    ON "WorkflowDefinition" ("scopeId") WHERE "scopeId" IS NOT NULL;

  -- Idempotent backfill — only fills rows where serviceTypeId is still
  -- NULL AND there is exactly one tenant with a service_type matching
  -- the workflow procedure key. Ambiguous matches are left for manual
  -- reconciliation. Guarded by the existence of service_types since
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
END
$$;
