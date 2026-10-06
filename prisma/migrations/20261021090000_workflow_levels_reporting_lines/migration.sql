-- Approval workflows with levels (src/lib/workflow-db.ts, src/lib/workflow/levels.ts).
--
-- WorkflowInstance."contextJson"        what the approval is about (amount, …),
--                                       read from the record by the server; each
--                                       level's condition is evaluated against it.
-- WorkflowStepInstance."approverEmails" who may act on a level, resolved when the
--                                       level opens (role holders, the submitter's
--                                       manager or department head, …).
-- WorkflowStepInstance.approvals        each approver's decision, so a level that
--                                       requires all approvers waits for all.
-- WorkflowStepInstance."activatedAt"    when the level opened: its time limit and
--                                       escalation count from here.
-- WorkflowStepInstance."escalatedAt"    when the escalation email went (sent once).
-- user_tenants.manager_user_id /        reporting lines in each company, for the
--   department_head_user_id             Direct Manager and Department Head approvers.
--
-- Safe to re-run.
ALTER TABLE "WorkflowInstance" ADD COLUMN IF NOT EXISTS "contextJson" JSONB;
ALTER TABLE "WorkflowStepInstance" ADD COLUMN IF NOT EXISTS "approverEmails" TEXT[];
ALTER TABLE "WorkflowStepInstance" ADD COLUMN IF NOT EXISTS approvals JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "WorkflowStepInstance" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP;
ALTER TABLE "WorkflowStepInstance" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP;
UPDATE "WorkflowStepInstance" SET "activatedAt" = "createdAt" WHERE status = 'PENDING' AND "activatedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_step_instance_escalation ON "WorkflowStepInstance" (status, "escalatedAt");
CREATE INDEX IF NOT EXISTS idx_workflow_instance_reference ON "WorkflowInstance" ("tenantId", "referenceType", "referenceId", status);
ALTER TABLE user_tenants ADD COLUMN IF NOT EXISTS manager_user_id TEXT;
ALTER TABLE user_tenants ADD COLUMN IF NOT EXISTS department_head_user_id TEXT;
