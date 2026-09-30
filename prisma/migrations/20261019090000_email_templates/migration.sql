-- Per-tenant email templates (English and Arabic), editable under
-- Admin > Email templates. See src/lib/email-templates/.
--
-- email_templates holds overrides of the built-in wording in the code
-- catalogue (src/lib/email-templates/catalogue.ts):
--   tenant_id NULL  a platform default: every tenant reads it, only platform
--                   context changes it (shared_template_read / tenant_isolation,
--                   the same pattern as WorkflowDefinition templates);
--   tenant_id set   that tenant's own wording.
-- One row per (tenant, template, channel, language). Resolution order when an
-- email is sent: the tenant's row, the platform row, the built-in wording.
--
-- email_template_versions keeps each replaced or reset version, so an edit
-- can be looked back at and restored. Visible to its own tenant only.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS email_templates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, template_key TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'EMAIL', locale TEXT NOT NULL DEFAULT 'en', subject TEXT NOT NULL, body TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true, version INT NOT NULL DEFAULT 1, updated_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS email_templates_scope_key ON email_templates ((COALESCE(tenant_id, '')), template_key, channel, locale);
CREATE INDEX IF NOT EXISTS idx_email_templates_tenant ON email_templates (tenant_id);

CREATE TABLE IF NOT EXISTS email_template_versions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), template_id UUID, tenant_id TEXT, template_key TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'EMAIL', locale TEXT NOT NULL, version INT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, saved_by TEXT, saved_at TIMESTAMPTZ NOT NULL DEFAULT now(), reason TEXT NOT NULL DEFAULT 'replaced');
CREATE INDEX IF NOT EXISTS idx_email_template_versions_lookup ON email_template_versions (tenant_id, template_key, locale, saved_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON email_templates, email_template_versions TO fleet360_app;

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_templates;
CREATE POLICY tenant_isolation ON email_templates FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
DROP POLICY IF EXISTS shared_template_read ON email_templates;
CREATE POLICY shared_template_read ON email_templates FOR SELECT USING (tenant_id IS NULL);

ALTER TABLE email_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_template_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON email_template_versions;
CREATE POLICY tenant_isolation ON email_template_versions FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
