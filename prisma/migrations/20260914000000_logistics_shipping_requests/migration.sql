-- Adds logistics_shipping_requests, the demand-intake table backing
-- src/lib/logistics/domain.ts's createShippingRequest/listShippingRequests/
-- getShippingRequest/updateShippingRequestStatus/convertShippingRequest.
-- Already-shipped consumers (src/app/api/logistics/shipping-requests/**,
-- src/app/api/shipper-portal/shipments/route.ts) were querying/inserting
-- against this table name since 2026-08-31; it never had a migration, so
-- every call failed until now. Same conventions as the sibling
-- 20260910000034_logistics_domain_tables migration: DDL-only, no RLS
-- (this domain filters by tenant_id at the app layer throughout — see that
-- migration's header comment for why), TEXT PK via gen_random_uuid()::text,
-- standard created_at/updated_at/deleted_at audit columns.

CREATE TABLE IF NOT EXISTS logistics_shipping_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  request_no TEXT NOT NULL,
  shipper_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  shipment_type TEXT,
  origin_name TEXT,
  origin_address TEXT,
  destination_name TEXT,
  destination_address TEXT,
  pickup_window_from TIMESTAMPTZ,
  pickup_window_to TIMESTAMPTZ,
  delivery_window_from TIMESTAMPTZ,
  delivery_window_to TIMESTAMPTZ,
  requested_vehicle_type TEXT,
  total_weight_kg NUMERIC(14,3),
  total_volume_cbm NUMERIC(14,3),
  cargo_value_amount NUMERIC(15,2),
  currency TEXT NOT NULL DEFAULT 'AED',
  goods_description TEXT,
  special_instructions TEXT,
  reference_no TEXT,
  source TEXT NOT NULL DEFAULT 'OPERATOR',
  shipment_order_id TEXT,
  review_notes TEXT,
  metadata JSONB,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_logistics_shipping_requests_tenant_status
  ON logistics_shipping_requests (tenant_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_logistics_shipping_requests_tenant_shipper
  ON logistics_shipping_requests (tenant_id, shipper_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_logistics_shipping_requests_request_no
  ON logistics_shipping_requests (tenant_id, request_no);
