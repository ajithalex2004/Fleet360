-- R10 fix 2026-08-13 — BulkImportJob table for idempotent bulk imports.
--
-- Stores (tenantId, idempotencyKey) → cached result so a retry with
-- the same key is a no-op. The route handler upserts on conflict and
-- checks bodyHash to reject key reuse with a different body.

CREATE TABLE IF NOT EXISTS bulk_import_jobs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTz,
  tenant_id        UUID          NOT NULL,
  idempotency_key  TEXT          NOT NULL,
  body_hash        TEXT          NOT NULL,
  result           JSONB         NOT NULL,
  created_by       UUID,
  expires_at       TIMESTAMPTZ   NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bulk_import_tenant_key
  ON bulk_import_jobs (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_bulk_import_expires
  ON bulk_import_jobs (expires_at);
