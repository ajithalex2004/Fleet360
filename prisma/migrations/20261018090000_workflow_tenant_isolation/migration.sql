-- Tenant isolation for the approval-workflow engine.
--
-- Before this, none of the four workflow tables had RLS, and only
-- WorkflowDefinition recorded a tenant. The engine's queries mostly had no
-- tenant filter, so:
--   - the legacy (module, procedure) lookup could start an approval on
--     another tenant's workflow, emailing that tenant's approvers;
--   - running approvals of shared (tenantId NULL) workflows showed in every
--     tenant's "All pending" list;
--   - an approval could be read, approved or rejected from any tenant by id.
--
-- 1. WorkflowStep, WorkflowInstance and WorkflowStepInstance get a
--    "tenantId" column, defaulting to the session's app.tenant_id like the
--    tables in 20261017090000. Existing rows are backfilled:
--      steps           from their workflow definition;
--      instances       from their workflow definition, else from the one
--                      tenant their initiator belongs to;
--      step instances  from their instance.
--    Rows that cannot be traced stay NULL: visible in platform context only.
--
-- 2. Definitions and steps with tenantId NULL are platform templates: every
--    tenant may read them (shared_template_read), only a platform admin may
--    change them (tenant_isolation, which has no NULL branch).
--    Instances and step instances get the standard tenant_isolation policy.
--
-- Safe to re-run.

-- ── 1. Tenant columns and backfill ──
ALTER TABLE "WorkflowStep" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "WorkflowInstance" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "WorkflowStepInstance" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

UPDATE "WorkflowStep" s SET "tenantId" = d."tenantId" FROM "WorkflowDefinition" d WHERE d.id = s."workflowId" AND s."tenantId" IS NULL AND d."tenantId" IS NOT NULL;
UPDATE "WorkflowInstance" i SET "tenantId" = d."tenantId" FROM "WorkflowDefinition" d WHERE d.id = i."workflowId" AND i."tenantId" IS NULL AND d."tenantId" IS NOT NULL;
UPDATE "WorkflowInstance" i SET "tenantId" = m.tenant_id FROM (SELECT lower(u.email) AS email, min(ut.tenant_id::text) AS tenant_id FROM "User" u JOIN user_tenants ut ON ut.user_id = u.id GROUP BY lower(u.email) HAVING count(DISTINCT ut.tenant_id) = 1) m WHERE i."tenantId" IS NULL AND lower(i."initiatedByEmail") = m.email;
UPDATE "WorkflowStepInstance" si SET "tenantId" = i."tenantId" FROM "WorkflowInstance" i WHERE i.id = si."workflowInstanceId" AND si."tenantId" IS NULL AND i."tenantId" IS NOT NULL;

ALTER TABLE "WorkflowInstance" ALTER COLUMN "tenantId" SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');
ALTER TABLE "WorkflowStepInstance" ALTER COLUMN "tenantId" SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '');

CREATE INDEX IF NOT EXISTS idx_workflow_step_tenant ON "WorkflowStep" ("tenantId");
CREATE INDEX IF NOT EXISTS idx_workflow_instance_tenant ON "WorkflowInstance" ("tenantId", status);
CREATE INDEX IF NOT EXISTS idx_workflow_step_instance_tenant ON "WorkflowStepInstance" ("tenantId", status);

-- ── 2. Row-level security ──
GRANT SELECT, INSERT, UPDATE, DELETE ON "WorkflowDefinition", "WorkflowStep", "WorkflowInstance", "WorkflowStepInstance" TO fleet360_app;

ALTER TABLE "WorkflowDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowDefinition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkflowDefinition";
CREATE POLICY tenant_isolation ON "WorkflowDefinition" FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS shared_template_read ON "WorkflowDefinition";
CREATE POLICY shared_template_read ON "WorkflowDefinition" FOR SELECT USING ("tenantId" IS NULL);

ALTER TABLE "WorkflowStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowStep" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkflowStep";
CREATE POLICY tenant_isolation ON "WorkflowStep" FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS shared_template_read ON "WorkflowStep";
CREATE POLICY shared_template_read ON "WorkflowStep" FOR SELECT USING ("tenantId" IS NULL);

ALTER TABLE "WorkflowInstance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowInstance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkflowInstance";
CREATE POLICY tenant_isolation ON "WorkflowInstance" FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true)));

ALTER TABLE "WorkflowStepInstance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkflowStepInstance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WorkflowStepInstance";
CREATE POLICY tenant_isolation ON "WorkflowStepInstance" FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ("tenantId" = current_setting('app.tenant_id', true)));
