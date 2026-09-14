-- Versioned Migration: 20260914120000_logistics_document_sequences
-- Description: Creates logistics_document_sequences table, sets up RLS and grants,
-- adds unique constraints on request_no and shipment_no, and seeds existing counter values.

-- 1. Create dedicated atomic document sequence counter table
CREATE TABLE IF NOT EXISTS logistics_document_sequences (
  tenant_id TEXT NOT NULL,
  doc_type VARCHAR(50) NOT NULL,
  year_key VARCHAR(10) NOT NULL,
  current_val BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, doc_type, year_key)
);

-- 2. Grants for application runtime role
GRANT SELECT, INSERT, UPDATE, DELETE ON logistics_document_sequences TO fleet360_app;

-- 3. Row-Level Security (RLS) Policy
ALTER TABLE logistics_document_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON logistics_document_sequences;
CREATE POLICY tenant_isolation ON logistics_document_sequences
  AS PERMISSIVE FOR ALL TO fleet360_app
  USING (
    (tenant_id IS NULL)
    OR (current_setting('app.tenant_id', true) = '*')
    OR (tenant_id = current_setting('app.tenant_id', true))
  )
  WITH CHECK (
    (tenant_id IS NULL)
    OR (current_setting('app.tenant_id', true) = '*')
    OR (tenant_id = current_setting('app.tenant_id', true))
  );

-- 4. DB Unique Constraints for integrity defense
CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipping_requests_tenant_no_key
  ON logistics_shipping_requests (tenant_id, request_no);

CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_orders_tenant_no_key
  ON logistics_shipment_orders (tenant_id, shipment_no);

-- 5. Seed counters from pre-existing records to prevent collision
INSERT INTO logistics_document_sequences (tenant_id, doc_type, year_key, current_val, updated_at)
SELECT
  tenant_id,
  'SHIPPING_REQUEST' AS doc_type,
  SUBSTRING(request_no FROM '^SR-([0-9]{2})') AS year_key,
  MAX(NULLIF(regexp_replace(request_no, '^SR-[0-9]{2}', ''), '')::bigint) AS current_val,
  NOW() AS updated_at
FROM logistics_shipping_requests
WHERE request_no ~ '^SR-[0-9]{2}[0-9]+$'
GROUP BY tenant_id, SUBSTRING(request_no FROM '^SR-([0-9]{2})')
ON CONFLICT (tenant_id, doc_type, year_key)
DO UPDATE SET current_val = GREATEST(logistics_document_sequences.current_val, EXCLUDED.current_val), updated_at = NOW();

INSERT INTO logistics_document_sequences (tenant_id, doc_type, year_key, current_val, updated_at)
SELECT
  tenant_id,
  'SHIPMENT' AS doc_type,
  SUBSTRING(shipment_no FROM '^SHP-LOG-([0-9]{2})') AS year_key,
  MAX(NULLIF(regexp_replace(shipment_no, '^SHP-LOG-[0-9]{2}', ''), '')::bigint) AS current_val,
  NOW() AS updated_at
FROM logistics_shipment_orders
WHERE shipment_no ~ '^SHP-LOG-[0-9]{2}[0-9]+$'
GROUP BY tenant_id, SUBSTRING(shipment_no FROM '^SHP-LOG-([0-9]{2})')
ON CONFLICT (tenant_id, doc_type, year_key)
DO UPDATE SET current_val = GREATEST(logistics_document_sequences.current_val, EXCLUDED.current_val), updated_at = NOW();
