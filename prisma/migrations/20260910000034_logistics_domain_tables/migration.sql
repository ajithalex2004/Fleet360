-- Moves src/lib/logistics/domain.ts's ensureLogisticsDomainTables() runtime
-- DDL (27 tables + 2 columns + ~40 indexes) into a migration. DDL-only, no
-- RLS: every query in domain.ts uses the bare prisma client (0 uses of
-- withTenantRls/withPlatformAdmin across 216 raw SQL calls), so RLS would
-- make the whole logistics engine return zero rows. Every table already
-- carries tenant_id TEXT NOT NULL and callers filter by it explicitly at
-- the app layer (94 WHERE/AND tenant_id occurrences) — same reasoning as
-- workflow-db.ts (20260910000032) and the service-config engine
-- (20260910000033).
--
-- ensureFinanceJournalPostingTables() (domain.ts, also removed) was already
-- a no-op stub — finance_journal_entries/finance_journal_lines are managed
-- by migration 20260809000000_adopt_finance_tables_with_rls. Nothing to do
-- for it here.

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

CREATE TABLE IF NOT EXISTS logistics_carrier_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  document_url TEXT NOT NULL,
  storage_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size NUMERIC(14,0),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  issue_date DATE,
  expiry_date DATE,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_carrier_vehicles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  owner_driver_id TEXT,
  vehicle_code TEXT,
  plate_no TEXT NOT NULL,
  registration_no TEXT,
  vehicle_type TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INT,
  color TEXT,
  capacity_tons NUMERIC(12,3),
  volume_cbm NUMERIC(12,3),
  pallet_capacity INT,
  axle_count INT,
  gps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  gps_provider TEXT,
  home_region TEXT,
  current_region TEXT,
  availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  compliance_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  registration_expiry DATE,
  insurance_expiry DATE,
  permit_expiry DATE,
  inspection_expiry DATE,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  metadata JSONB
);

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

CREATE TABLE IF NOT EXISTS logistics_customer_marketplace_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  rfq_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bid_submission_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  direct_assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  default_procurement_mode TEXT NOT NULL DEFAULT 'RFQ_BIDDING',
  require_rfq_before_award BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  metadata JSONB,
  updated_by TEXT
);

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

CREATE TABLE IF NOT EXISTS logistics_carrier_portal_invites (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  rfq_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_by TEXT,
  metadata JSONB
);

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

CREATE TABLE IF NOT EXISTS logistics_driver_payouts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  assignment_id TEXT,
  driver_id TEXT,
  payout_no TEXT NOT NULL,
  gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  deductions_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payment_id TEXT,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_finance_postings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  posting_type TEXT NOT NULL,
  source_record_id TEXT NOT NULL DEFAULT '',
  finance_invoice_id TEXT,
  finance_journal_entry_id TEXT,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AED',
  status TEXT NOT NULL DEFAULT 'POSTED',
  metadata JSONB
);

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
  assigned_to TEXT,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  escalated_at TIMESTAMPTZ,
  escalated_by TEXT,
  sla_due_at TIMESTAMPTZ,
  sla_breached_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_rate_contracts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT,
  carrier_id TEXT,
  contract_no TEXT NOT NULL,
  lane_origin TEXT NOT NULL,
  lane_destination TEXT NOT NULL,
  vehicle_type TEXT,
  service_level TEXT,
  currency TEXT NOT NULL DEFAULT 'AED',
  base_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
  min_charge NUMERIC(15,2),
  fuel_surcharge_pct NUMERIC(8,2),
  accessorial_rules JSONB,
  effective_from DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_carrier_scorecards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  carrier_id TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  on_time_rate NUMERIC(6,2),
  acceptance_rate NUMERIC(6,2),
  cancellation_rate NUMERIC(6,2),
  claim_rate NUMERIC(6,2),
  compliance_score NUMERIC(6,2),
  average_rating NUMERIC(4,2),
  shipments_completed INT NOT NULL DEFAULT 0,
  preferred BOOLEAN NOT NULL DEFAULT FALSE,
  blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
  blacklist_reason TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_telematics_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shipment_order_id TEXT NOT NULL,
  assignment_id TEXT,
  vehicle_id TEXT,
  provider TEXT,
  device_id TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  speed_kph NUMERIC(10,2),
  heading NUMERIC(7,2),
  odometer_km NUMERIC(14,2),
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eta_at TIMESTAMPTZ,
  eta_confidence NUMERIC(5,2),
  raw_payload JSONB
);

CREATE TABLE IF NOT EXISTS logistics_accessorial_catalog (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  charge_type TEXT NOT NULL DEFAULT 'ACCESSORIAL',
  default_amount NUMERIC(15,2),
  currency TEXT NOT NULL DEFAULT 'AED',
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  auto_apply_rule JSONB,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_master_data (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  sort_order INT NOT NULL DEFAULT 0,
  metadata JSONB,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS logistics_shift_handovers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  shift_date DATE NOT NULL,
  shift_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  outgoing_user_id TEXT,
  incoming_user_id TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by TEXT,
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS logistics_change_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  before_json JSONB,
  after_json JSONB,
  summary TEXT,
  metadata JSONB
);

ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS escalated_by TEXT;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;
ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Day 4 of the rate-matrix gap-closure: store the contract id that priced
-- the shipment so dispatch can group "shipments under contract RC-123"
-- without parsing metadata.rateQuote out of JSONB. Nullable on purpose —
-- spot/marketplace shipments and quote-misses both leave it null and
-- that's the signal "this needs manual pricing review".
ALTER TABLE logistics_shipment_orders ADD COLUMN IF NOT EXISTS quoted_contract_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS logistics_carriers_tenant_code_key ON logistics_carriers (tenant_id, carrier_code);
CREATE INDEX IF NOT EXISTS idx_logistics_carriers_tenant_status ON logistics_carriers (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_documents_carrier ON logistics_carrier_documents (tenant_id, carrier_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_documents_expiry ON logistics_carrier_documents (tenant_id, expiry_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS logistics_carrier_vehicles_plate_key ON logistics_carrier_vehicles (tenant_id, carrier_id, plate_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_vehicles_carrier ON logistics_carrier_vehicles (tenant_id, carrier_id, status, availability_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_vehicles_compliance ON logistics_carrier_vehicles (tenant_id, compliance_status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_orders_tenant_no_key ON logistics_shipment_orders (tenant_id, shipment_no);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_status ON logistics_shipment_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_customer ON logistics_shipment_orders (tenant_id, cargo_owner_customer_id);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_marketplace ON logistics_shipment_orders (tenant_id, marketplace_status);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_customer_marketplace_settings_customer_key ON logistics_customer_marketplace_settings (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_logistics_customer_marketplace_settings_policy ON logistics_customer_marketplace_settings (tenant_id, rfq_enabled, bid_submission_enabled);
CREATE INDEX IF NOT EXISTS idx_logistics_consignments_shipment ON logistics_consignments (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_cargo_lines_shipment ON logistics_cargo_lines (tenant_id, shipment_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_stops_order_sequence_key ON logistics_shipment_stops (shipment_order_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_stops_shipment ON logistics_shipment_stops (tenant_id, shipment_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_route_legs_order_sequence_key ON logistics_route_legs (shipment_order_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_logistics_route_legs_shipment ON logistics_route_legs (tenant_id, shipment_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_freight_rfqs_tenant_no_key ON logistics_freight_rfqs (tenant_id, rfq_no);
CREATE INDEX IF NOT EXISTS idx_logistics_freight_rfqs_shipment ON logistics_freight_rfqs (tenant_id, shipment_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_carrier_portal_invites_token_key ON logistics_carrier_portal_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_portal_invites_scope ON logistics_carrier_portal_invites (tenant_id, rfq_id, carrier_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_shipment ON logistics_carrier_bids (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_carrier ON logistics_carrier_bids (tenant_id, carrier_id);
CREATE INDEX IF NOT EXISTS idx_logistics_assignments_shipment ON logistics_assignments (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_tracking_events_shipment_time ON logistics_tracking_events (tenant_id, shipment_order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_logistics_pod_events_shipment ON logistics_pod_events (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_freight_charges_shipment ON logistics_freight_charges (tenant_id, shipment_order_id);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_settlements_carrier ON logistics_carrier_settlements (tenant_id, carrier_id);
CREATE INDEX IF NOT EXISTS idx_logistics_driver_payouts_shipment ON logistics_driver_payouts (tenant_id, shipment_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_finance_postings_unique_source ON logistics_finance_postings (tenant_id, shipment_order_id, posting_type, source_record_id);
CREATE INDEX IF NOT EXISTS idx_logistics_finance_postings_shipment ON logistics_finance_postings (tenant_id, shipment_order_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_status ON logistics_shipment_exceptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_shipment_status ON logistics_shipment_exceptions (tenant_id, shipment_order_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_rate_contracts_tenant_no_key ON logistics_rate_contracts (tenant_id, contract_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_rate_contracts_lane ON logistics_rate_contracts (tenant_id, lane_origin, lane_destination, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_rate_contracts_carrier_customer ON logistics_rate_contracts (tenant_id, carrier_id, customer_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_scorecards_carrier ON logistics_carrier_scorecards (tenant_id, carrier_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_logistics_carrier_scorecards_rules ON logistics_carrier_scorecards (tenant_id, preferred, blacklisted, status);
CREATE INDEX IF NOT EXISTS idx_logistics_telematics_shipment_time ON logistics_telematics_events (tenant_id, shipment_order_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_logistics_telematics_vehicle_time ON logistics_telematics_events (tenant_id, vehicle_id, event_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS logistics_accessorial_catalog_code_key ON logistics_accessorial_catalog (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_accessorial_catalog_status ON logistics_accessorial_catalog (tenant_id, status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS logistics_master_data_code_key ON logistics_master_data (tenant_id, type, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_master_data_type_status ON logistics_master_data (tenant_id, type, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_logistics_shift_handovers_scope ON logistics_shift_handovers (tenant_id, shift_date DESC, shift_code);
CREATE INDEX IF NOT EXISTS idx_logistics_change_history_scope ON logistics_change_history (tenant_id, entity_type, entity_id, created_at DESC);
