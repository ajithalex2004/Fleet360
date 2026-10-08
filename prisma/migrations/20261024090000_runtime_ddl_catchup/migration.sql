-- Catch-up for schema that only runtime code used to create (architecture
-- audit A9 follow-ups). Until now these columns and indexes came from
-- request-time DDL (src/lib/billing.ts, src/lib/branding.ts, tenant
-- provisioning, MFA) or from
-- the platform-admin endpoints /api/admin/migrate/{fleet-phase1,rac-phase1,
-- indexes}, which this release removes. A replay of every migration on an
-- empty database (scripts/fresh-install-migrate.cjs, 2026-10-08) lacked all
-- of them.
--
--   * Production already has most: there every statement below is a no-op
--     (IF NOT EXISTS), so the schema converges without changing live data.
--   * 18 columns that code writes were never created anywhere, because the
--     admin endpoints that add them were never run in production: the
--     rental-agreement close (/api/rental/agreements/[id]/close) and the
--     vehicle edit failed on them. They are added here, nullable or with the
--     defaults the endpoints used.
--   * Index statements are skipped (with a notice) where their table or a
--     column is absent, so this applies on every environment.
--
-- Additive only. Not included: garage_inventory and vehicle_registrations
-- (no code uses them), and the old lease_contracts / lease_payments indexes
-- (those tables are lease_contracts_v2 / lease_payments_v2 now).

-- ── Columns ─────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS vehicles ADD COLUMN IF NOT EXISTS year_of_manufacture INT;
ALTER TABLE IF EXISTS vehicles ADD COLUMN IF NOT EXISTS stop_mode_comm_frequency TEXT;

ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS base_hourly_rate DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS weekend_daily_rate DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS exchange_rate_to_aed DECIMAL DEFAULT 1;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS customer_type TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS corporate_account_id TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS airline_code TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS frequent_flyer_prog TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS credit_card_type TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS pickup_location_code TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS dropoff_location_code TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS is_airport_rate BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS is_domestic BOOLEAN DEFAULT true;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS online_discount DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS grace_period_min INT DEFAULT 30;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS late_fee_per_hour DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS late_fee_cap DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS min_rental_days INT DEFAULT 1;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS min_rental_hours INT DEFAULT 0;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS insurance_plans TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_discount_pct DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_valid_from TIMESTAMPTZ;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_valid_to TIMESTAMPTZ;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_max_uses INT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS promo_used_count INT DEFAULT 0;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS included_km_per_day INT;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS excess_km_rate DECIMAL;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS priority INT DEFAULT 0;
ALTER TABLE IF EXISTS pricing_rules ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE IF EXISTS rental_invoice_payments ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS actual_return_date TIMESTAMPTZ;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS pickup_fuel_level INT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS return_fuel_level INT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS pickup_odometer INT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS return_odometer INT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS late_fee DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS excess_km_fee DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS fuel_surcharge DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS closed_by TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS closing_notes TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS pickup_location_code TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS dropoff_location_code TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'INDIVIDUAL';
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'DIRECT';
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS promo_code TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'SEPARATE';
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS additional_charges TEXT;
ALTER TABLE IF EXISTS rental_agreements ADD COLUMN IF NOT EXISTS customer_name TEXT;

ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS billing_email TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS domain_verification_method TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ;

-- Tenant branding (was src/lib/branding.ts ensureBrandingColumns)
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_product_name TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_tagline TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_logo_url TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_favicon_url TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_primary_color TEXT;
ALTER TABLE IF EXISTS tenants ADD COLUMN IF NOT EXISTS brand_accent_color TEXT;

-- ── Indexes ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('vehicle_types') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_types_code ON vehicle_types(code)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_types_code: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicle_types') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_types_group ON vehicle_types(vehicle_group)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_types_group: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicle_types') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_types_is_active ON vehicle_types(is_active)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_types_is_active: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_code ON vehicles(vehicle_code)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicles_vehicle_code: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_type_id ON vehicles(vehicle_type_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicles_vehicle_type_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_usage ON vehicles(vehicle_usage)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicles_vehicle_usage: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_lifecycle_stage ON vehicles(lifecycle_stage)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicles_lifecycle_stage: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_lifecycle_events') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_vehicle_id ON fleet_lifecycle_events(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_lifecycle_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_lifecycle_events') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_event_type ON fleet_lifecycle_events(event_type)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_lifecycle_event_type: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_lifecycle_events') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_lifecycle_event_date ON fleet_lifecycle_events(event_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_lifecycle_event_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_allocations') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_allocations_vehicle_id ON fleet_allocations(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_allocations_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_allocations') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_allocations_status ON fleet_allocations(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_allocations_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_transfers') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_transfers_vehicle_id ON fleet_transfers(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_transfers_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_transfers') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_transfers_status ON fleet_transfers(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_transfers_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_vehicle_insurance') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_insurance_vehicle_id ON fleet_vehicle_insurance(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_insurance_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_vehicle_insurance') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_insurance_status ON fleet_vehicle_insurance(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_insurance_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_vehicle_insurance') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_insurance_end_date ON fleet_vehicle_insurance(end_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_insurance_end_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_work_orders') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_wo_vehicle_id ON fleet_work_orders(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_wo_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_work_orders') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_wo_status ON fleet_work_orders(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_wo_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fleet_work_orders') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_wo_type ON fleet_work_orders(wo_type)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fleet_wo_type: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('maintenance_requests') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_maintenance_requests_vehicle_id ON maintenance_requests(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_maintenance_requests_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('maintenance_requests') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_maintenance_requests_driver_id ON maintenance_requests(driver_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_maintenance_requests_driver_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('maintenance_requests') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_maintenance_requests_garage_id ON maintenance_requests(garage_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_maintenance_requests_garage_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('maintenance_requests') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON maintenance_requests(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_maintenance_requests_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('quotation_labors') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotation_labors_quotation_id ON quotation_labors(quotation_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_quotation_labors_quotation_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('quotation_parts') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotation_parts_quotation_id ON quotation_parts(quotation_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_quotation_parts_quotation_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('quotations') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotations_maintenance_request_id ON quotations(maintenance_request_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_quotations_maintenance_request_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('quotations') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotations_garage_id ON quotations(garage_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_quotations_garage_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('quotations') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_quotations_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('invoices') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoices_garage_id ON invoices(garage_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_invoices_garage_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('invoices') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_invoices_payment_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_bookings') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_bookings_customer_id ON rental_bookings(customer_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_bookings_customer_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_bookings') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_bookings_vehicle_id ON rental_bookings(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_bookings_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_bookings') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_bookings_status ON rental_bookings(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_bookings_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_bookings') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_bookings_pickup_date ON rental_bookings(pickup_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_bookings_pickup_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_bookings') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_bookings_deleted_at ON rental_bookings(deleted_at)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_bookings_deleted_at: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_agreements') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_agreements_customer_id ON rental_agreements(customer_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_agreements_customer_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_agreements') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_agreements_vehicle_id ON rental_agreements(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_agreements_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_agreements') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_agreements_status ON rental_agreements(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_agreements_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicle_documents') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle_id ON vehicle_documents(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_documents_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicle_documents') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_documents_status ON vehicle_documents(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_documents_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('vehicle_documents') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicle_documents_expiry_date ON vehicle_documents(expiry_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_vehicle_documents_expiry_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fuel_logs') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle_id ON fuel_logs(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fuel_logs_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fuel_logs') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fuel_logs_driver_id ON fuel_logs(driver_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fuel_logs_driver_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('fuel_logs') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fuel_logs_fuel_date ON fuel_logs(fuel_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_fuel_logs_fuel_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('traffic_fines') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_traffic_fines_vehicle_id ON traffic_fines(vehicle_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_traffic_fines_vehicle_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('traffic_fines') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_traffic_fines_driver_id ON traffic_fines(driver_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_traffic_fines_driver_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('traffic_fines') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_traffic_fines_status ON traffic_fines(status)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_traffic_fines_status: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('driver_documents') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_id ON driver_documents(driver_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_driver_documents_driver_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('driver_documents') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry_date ON driver_documents(expiry_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_driver_documents_expiry_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('driver_shifts') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_driver_shifts_driver_id ON driver_shifts(driver_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_driver_shifts_driver_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('driver_shifts') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_driver_shifts_shift_date ON driver_shifts(shift_date)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_driver_shifts_shift_date: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('pricing_rules') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pricing_rules_customer_type ON pricing_rules(customer_type)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_pricing_rules_customer_type: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('pricing_rules') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pricing_rules_channel ON pricing_rules(channel)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_pricing_rules_channel: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('pricing_rules') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pricing_rules_promo_code ON pricing_rules(promo_code)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_pricing_rules_promo_code: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('pricing_rules') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pricing_rules_is_active ON pricing_rules(is_active)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_pricing_rules_is_active: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_agreements') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_agreements_open_branch_id ON rental_agreements(open_branch_id)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_agreements_open_branch_id: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('rental_customers') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rental_customers_customer_type ON rental_customers(customer_type)'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_rental_customers_customer_type: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('tenants') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_tenants_stripe_customer: %', SQLERRM;
END $$;
DO $$ BEGIN
  IF to_regclass('tenants') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tenants_stripe_sub ON tenants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL'; END IF;
EXCEPTION WHEN undefined_column OR undefined_table THEN
  RAISE NOTICE 'skipped index idx_tenants_stripe_sub: %', SQLERRM;
END $$;
