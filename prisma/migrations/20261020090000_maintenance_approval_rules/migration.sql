-- Maintenance estimate approval rules, per tenant (Maintenance > Approvals >
-- Rules). See src/lib/maintenance/approval-rules.ts.
--
-- A rule covers a cost band [min_cost, max_cost] (max_cost NULL = no upper
-- limit). When an estimate in the band is approved, the approver must hold
-- one of required_roles (role codes); an empty list means anyone who may
-- approve estimates. auto_approve approves an estimate in the band as soon
-- as it is submitted. With no active rule for a cost, approval works as
-- before.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS maintenance_approval_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT NOT NULL, min_cost NUMERIC(14,2) NOT NULL DEFAULT 0, max_cost NUMERIC(14,2), required_roles TEXT[] NOT NULL DEFAULT '{}', auto_approve BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_maintenance_approval_rules_tenant ON maintenance_approval_rules (tenant_id) WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_approval_rules TO fleet360_app;

ALTER TABLE maintenance_approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_approval_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON maintenance_approval_rules;
CREATE POLICY tenant_isolation ON maintenance_approval_rules FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
