-- Tenant attachments (Admin > Tenants > Create / Manage > Attachments) and
-- the Attachment Type master (Admin > Attachment Types).
-- See src/lib/tenant-attachments.ts.
--
-- attachment_types is platform master data (no tenant_id, no RLS): the
-- document types a tenant can be asked for. is_mandatory types must be
-- uploaded before a tenant can be created. requires_expiry asks for the
-- document's expiry date.
--
-- tenant_attachments holds one row per uploaded document, tenant-scoped
-- with the standard tenant_isolation policy. Files live in storage under
-- tenant-attachments/{tenantId}/ (src/lib/storage/file-access.ts).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS attachment_types (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL, name TEXT NOT NULL, description TEXT, is_mandatory BOOLEAN NOT NULL DEFAULT false, requires_expiry BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER NOT NULL DEFAULT 100, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS attachment_types_code_key ON attachment_types (code);

GRANT SELECT, INSERT, UPDATE ON attachment_types TO fleet360_app;

INSERT INTO attachment_types (code, name, description, is_mandatory, requires_expiry, sort_order) VALUES
  ('TRADE_LICENSE',      'Trade License',      'Trade license issued by the economic department', true,  true,  10),
  ('COMMERCIAL_LICENSE', 'Commercial License', 'Commercial registration / license',               false, true,  20),
  ('VAT_CERTIFICATE',    'VAT Certificate',    'FTA VAT registration certificate',                false, false, 30),
  ('PERMITS',            'Permits',            'Operating permits (e.g. RTA, municipality)',      false, true,  40),
  ('OTHER',              'Other Documents',    'Any other supporting document',                    false, false, 90)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS tenant_attachments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, attachment_type_id UUID NOT NULL REFERENCES attachment_types(id), file_url TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, document_number TEXT, expiry_date DATE, uploaded_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_tenant_attachments_tenant ON tenant_attachments (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_attachments_file_url ON tenant_attachments (file_url);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_attachments TO fleet360_app;

ALTER TABLE tenant_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_attachments;
CREATE POLICY tenant_isolation ON tenant_attachments FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
