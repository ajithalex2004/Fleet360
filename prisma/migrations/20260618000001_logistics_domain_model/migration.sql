-- Logistics domain model: TMS + private freight marketplace foundation.
-- This migration is intentionally additive so the current booking-backed
-- Logistics screens can keep running while new shipment-native APIs come online.

CREATE TABLE IF NOT EXISTS logistics_carriers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  carrier_code TEXT,
  carrier_type TEXT NOT NULL DEFAULT 'TRANSPORT_COMPANY',
  name TEXT NOT NULL,
  trade_license TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  onboarding_status TEXT NOT NULL DEFAULT 'DRAFT',
  compliance_status TEXT NOT NULL DEFAULT 'PENDING',
  service_regions JSONB,
  capacity_profile JSONB,
  commission_model TEXT,
  commission_rate NUMERIC(10,2),
  margin_rule_json JSONB,
  metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS logistics_carriers_tenant_code_key
  ON logistics_carriers (tenant_id, carrier_code);
CREATE INDEX IF NOT EXISTS idx_logistics_carriers_tenant_status
  ON logistics_carriers (tenant_id, status);

CREATE TABLE IF NOT EXISTS logistics_shipment_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  shipment_no TEXT NOT NULL,
  legacy_booking_id TEXT UNIQUE,
  cargo_owner_customer_id TEXT,
  cargo_owner_name TEXT,
  cargo_owner_email TEXT,
  cargo_owner_phone TEXT,
  shipment_type TEXT,
  booking_mode TEXT NOT NULL DEFAULT 'SPOT',
  marketplace_status TEXT NOT NULL DEFAULT 'PRIVATE',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
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
  customer_rate_amount NUMERIC(15,2),
  carrier_cost_amount NUMERIC(15,2),
  platform_commission_amount NUMERIC(15,2),
  margin_amount NUMERIC(15,2),
  assigned_carrier_id TEXT,
  assigned_driver_id TEXT,
  assigned_vehicle_id TEXT,
  source_channel TEXT,
  notes TEXT,
  metadata JSONB,
  created_by TEXT,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_orders_tenant_no_key
  ON logistics_shipment_orders (tenant_id, shipment_no);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_status
  ON logistics_shipment_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_customer
  ON logistics_shipment_orders (tenant_id, cargo_owner_customer_id);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_marketplace
  ON logistics_shipment_orders (tenant_id, marketplace_status);

CREATE TABLE IF NOT EXISTS logistics_consignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  consignment_no TEXT,
  shipper_name TEXT,
  consignee_name TEXT,
  cargo_summary TEXT,
  handling_notes TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_consignments_shipment
  ON logistics_consignments (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_cargo_lines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  consignment_id TEXT,
  description TEXT NOT NULL,
  commodity_code TEXT,
  quantity NUMERIC(14,3),
  package_type TEXT,
  weight_kg NUMERIC(14,3),
  volume_cbm NUMERIC(14,3),
  is_hazmat BOOLEAN NOT NULL DEFAULT FALSE,
  temp_min_c NUMERIC(8,2),
  temp_max_c NUMERIC(8,2),
  cargo_value_amount NUMERIC(15,2),
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_cargo_lines_shipment
  ON logistics_cargo_lines (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_shipment_stops (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  sequence_no INT NOT NULL,
  stop_type TEXT NOT NULL,
  location_name TEXT,
  address TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  planned_arrival_at TIMESTAMPTZ,
  planned_depart_at TIMESTAMPTZ,
  actual_arrival_at TIMESTAMPTZ,
  actual_depart_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  instructions TEXT,
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_stops_order_sequence_key
  ON logistics_shipment_stops (shipment_order_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_stops_shipment
  ON logistics_shipment_stops (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_route_legs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  sequence_no INT NOT NULL,
  from_stop_id TEXT,
  to_stop_id TEXT,
  planned_distance_km NUMERIC(12,3),
  planned_duration_min INT,
  actual_distance_km NUMERIC(12,3),
  actual_duration_min INT,
  toll_amount NUMERIC(15,2),
  status TEXT NOT NULL DEFAULT 'PLANNED',
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_route_legs_order_sequence_key
  ON logistics_route_legs (shipment_order_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_logistics_route_legs_shipment
  ON logistics_route_legs (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_freight_rfqs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  invite_scope TEXT NOT NULL DEFAULT 'SELECTED_CARRIERS',
  bid_deadline_at TIMESTAMPTZ,
  negotiation_round INT NOT NULL DEFAULT 1,
  awarded_bid_id TEXT,
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_freight_rfqs_tenant_no_key
  ON logistics_freight_rfqs (tenant_id, rfq_no);
CREATE INDEX IF NOT EXISTS idx_logistics_freight_rfqs_shipment
  ON logistics_freight_rfqs (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_carrier_bids (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  rfq_id TEXT,
  carrier_id TEXT NOT NULL,
  bid_no TEXT,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  transit_time_hours INT,
  validity_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  charge_breakdown JSONB,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_shipment
  ON logistics_carrier_bids (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_carrier
  ON logistics_carrier_bids (tenant_id, carrier_id);

CREATE TABLE IF NOT EXISTS logistics_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  carrier_id TEXT,
  driver_id TEXT,
  vehicle_id TEXT,
  assignment_type TEXT NOT NULL DEFAULT 'CARRIER',
  status TEXT NOT NULL DEFAULT 'ASSIGNED',
  cost_amount NUMERIC(15,2),
  currency TEXT NOT NULL DEFAULT 'AED',
  accepted_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_assignments_shipment
  ON logistics_assignments (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_assignments_carrier
  ON logistics_assignments (tenant_id, carrier_id);

CREATE TABLE IF NOT EXISTS logistics_tracking_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  assignment_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_tracking_events_shipment_time
  ON logistics_tracking_events (tenant_id, shipment_order_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS logistics_pod_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  assignment_id TEXT,
  delivered_at TIMESTAMPTZ,
  recipient_name TEXT,
  signature_url TEXT,
  photo_urls JSONB,
  document_urls JSONB,
  gps JSONB,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  created_by TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_pod_events_shipment
  ON logistics_pod_events (tenant_id, shipment_order_id);

CREATE TABLE IF NOT EXISTS logistics_freight_charges (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  charge_side TEXT NOT NULL,
  charge_type TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AED',
  billing_status TEXT NOT NULL DEFAULT 'DRAFT',
  invoice_id TEXT,
  settlement_id TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_freight_charges_shipment
  ON logistics_freight_charges (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_freight_charges_side
  ON logistics_freight_charges (tenant_id, charge_side);

CREATE TABLE IF NOT EXISTS logistics_carrier_settlements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  settlement_no TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payment_id TEXT,
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_carrier_settlements_tenant_no_key
  ON logistics_carrier_settlements (tenant_id, settlement_no);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_settlements_carrier
  ON logistics_carrier_settlements (tenant_id, carrier_id);

CREATE TABLE IF NOT EXISTS logistics_shipment_exceptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  assignment_id TEXT,
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  title TEXT NOT NULL,
  description TEXT,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_shipment
  ON logistics_shipment_exceptions (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_status
  ON logistics_shipment_exceptions (tenant_id, status);
