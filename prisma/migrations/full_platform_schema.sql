-- ============================================================
-- Smart Mobility Platform — Full Schema Migration
-- Creates ALL missing platform tables (IF NOT EXISTS)
-- Existing tables are NOT modified or dropped.
-- Run: psql "postgresql://postgres:root@localhost:5433/tripxl" -f full_platform_schema.sql
-- ============================================================

-- Enable uuid extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


CREATE TABLE IF NOT EXISTS "ChecklistItem" (
  "id" VARCHAR PRIMARY KEY,
  "task" VARCHAR,
  "completed" BOOLEAN DEFAULT FALSE,
  "completed_by" VARCHAR,
  "completed_at" TIMESTAMPTZ,
  "notes" VARCHAR,
  "work_order_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "IntegrationConfig" (
  "id" VARCHAR PRIMARY KEY,
  "type" VARCHAR,
  "provider" VARCHAR,
  "host" VARCHAR,
  "port" VARCHAR,
  "username" VARCHAR,
  "password" VARCHAR,
  "api_key" VARCHAR,
  "api_secret" VARCHAR,
  "sender_id" VARCHAR,
  "sender_email" VARCHAR,
  "from_name" VARCHAR,
  "encryption" VARCHAR,
  "account_sid" VARCHAR,
  "auth_token" VARCHAR,
  "from_number" VARCHAR,
  "is_enabled" BOOLEAN DEFAULT TRUE,
  "updated_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "NotificationLog" (
  "id" VARCHAR PRIMARY KEY,
  "recipient" VARCHAR,
  "type" VARCHAR,
  "subject" VARCHAR,
  "body" VARCHAR,
  "status" VARCHAR,
  "sent_at" TIMESTAMPTZ DEFAULT NOW(),
  "trigger_reason" VARCHAR
);

CREATE TABLE IF NOT EXISTS "PartUsage" (
  "id" VARCHAR PRIMARY KEY,
  "part_name" VARCHAR,
  "quantity_used" INTEGER,
  "unit_cost" DOUBLE PRECISION,
  "total_cost" DOUBLE PRECISION,
  "work_order_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "ServiceSchedule" (
  "id" VARCHAR PRIMARY KEY,
  "service_type" VARCHAR,
  "interval_months" INTEGER,
  "interval_mileage" INTEGER,
  "last_service_date" TIMESTAMPTZ,
  "last_service_mileage" INTEGER,
  "next_service_date" TIMESTAMPTZ,
  "next_service_mileage" INTEGER,
  "vehicle_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "User" (
  "id" VARCHAR PRIMARY KEY,
  "username" VARCHAR,
  "email" VARCHAR,
  "mobile_number" VARCHAR,
  "hierarchy" VARCHAR,
  "user_type" VARCHAR,
  "first_name" VARCHAR,
  "last_name" VARCHAR,
  "department" VARCHAR,
  "position" VARCHAR,
  "employee_id" VARCHAR,
  "is_active" BOOLEAN DEFAULT TRUE,
  "module_access" JSONB
);

CREATE TABLE IF NOT EXISTS "WorkLog" (
  "id" VARCHAR PRIMARY KEY,
  "timestamp" TIMESTAMPTZ DEFAULT NOW(),
  "technician_name" VARCHAR,
  "activity" VARCHAR,
  "hours_spent" DOUBLE PRECISION,
  "notes" VARCHAR,
  "work_order_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "WorkOrder" (
  "id" VARCHAR PRIMARY KEY,
  "start_date" TIMESTAMPTZ,
  "estimated_completion_date" TIMESTAMPTZ,
  "actual_completion_date" TIMESTAMPTZ,
  "total_labor_hours" DOUBLE PRECISION,
  "request_id" VARCHAR,
  "garage_id" VARCHAR,
  "attachment" JSONB,
  "checklist_item" JSONB,
  "part_usage" JSONB,
  "work_log" JSONB
);

CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "name" VARCHAR,
  "channel" VARCHAR,
  "subject" VARCHAR,
  "body" VARCHAR,
  "is_active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "rules" JSONB
);

CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "channels" TEXT[],
  "recipient_types" JSONB,
  "specific_recipient_ids" TEXT[],
  "template_id" VARCHAR,
  "is_enabled" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "lessees" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "name" VARCHAR,
  "type" VARCHAR,
  "license_no" VARCHAR,
  "trade_license" VARCHAR,
  "contact_person" VARCHAR,
  "email" VARCHAR,
  "phone" VARCHAR,
  "address" VARCHAR,
  "nationality" VARCHAR,
  "emirates_id" VARCHAR,
  "customer_id" VARCHAR,
  "lease_contracts" JSONB,
  "quotations" JSONB,
  "credit_assessments" JSONB,
  "invoices" JSONB,
  "direct_debits" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_contracts" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "contract_number" VARCHAR,
  "lessee_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "monthly_rate" DECIMAL(18,4),
  "mileage_cap" INTEGER,
  "security_deposit" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'DRAFT',
  "notes" VARCHAR,
  "payments" JSONB,
  "returns" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_payments" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "contract_id" VARCHAR,
  "due_date" TIMESTAMPTZ,
  "amount" DECIMAL(18,4),
  "paid_date" TIMESTAMPTZ,
  "receipt_no" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS "lease_vehicle_returns" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "return_date" TIMESTAMPTZ,
  "mileage" INTEGER,
  "condition" VARCHAR,
  "damages" VARCHAR,
  "inspector" VARCHAR,
  "final_cost" DECIMAL(18,4)
);

CREATE TABLE IF NOT EXISTS "rental_customers" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "full_name" VARCHAR,
  "customer_type" VARCHAR DEFAULT 'INDIVIDUAL',
  "nationality" VARCHAR,
  "passport_no" VARCHAR,
  "driving_license_no" VARCHAR,
  "license_expiry" TIMESTAMPTZ,
  "email" VARCHAR,
  "phone" VARCHAR,
  "address" VARCHAR,
  "blacklisted" BOOLEAN DEFAULT FALSE,
  "company_name" VARCHAR,
  "trade_license" VARCHAR,
  "vat_number" VARCHAR,
  "credit_limit" DECIMAL(18,4),
  "credit_used" DECIMAL(18,4) DEFAULT 0,
  "payment_terms_days" INTEGER DEFAULT 0,
  "frequent_flyer_no" VARCHAR,
  "loyalty_points" INTEGER DEFAULT 0,
  "total_rentals" INTEGER DEFAULT 0,
  "total_spend" DECIMAL(18,4) DEFAULT 0,
  "bookings" JSONB
);

CREATE TABLE IF NOT EXISTS "rental_bookings" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "booking_ref" VARCHAR,
  "customer_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "vehicle_category" VARCHAR,
  "pickup_date" TIMESTAMPTZ,
  "dropoff_date" TIMESTAMPTZ,
  "pickup_location" VARCHAR,
  "dropoff_location" VARCHAR,
  "total_days" INTEGER,
  "daily_rate" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'PENDING',
  "channel" VARCHAR,
  "notes" VARCHAR,
  "inspections" JSONB,
  "damage_claims" JSONB
);

CREATE TABLE IF NOT EXISTS "vehicle_inspections" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "booking_id" VARCHAR,
  "type" VARCHAR,
  "mileage" INTEGER,
  "fuel_level" INTEGER,
  "damages" VARCHAR,
  "inspector" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "damage_claims" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "booking_id" VARCHAR,
  "description" VARCHAR,
  "estimated_cost" DECIMAL(18,4),
  "actual_cost" DECIMAL(18,4),
  "status" VARCHAR DEFAULT 'OPEN',
  "insurance_claim" BOOLEAN DEFAULT FALSE,
  "billed_to_customer" BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "PricingRule" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "name" VARCHAR,
  "vehicle_category" VARCHAR,
  "base_daily_rate" DECIMAL(18,4),
  "base_km_rate" DECIMAL(18,4),
  "base_hourly_rate" DECIMAL(18,4),
  "weekly_rate" DECIMAL(18,4),
  "monthly_rate" DECIMAL(18,4),
  "weekend_daily_rate" DECIMAL(18,4),
  "season_from" TIMESTAMPTZ,
  "season_to" TIMESTAMPTZ,
  "multiplier" DECIMAL(18,4) DEFAULT 1,
  "currency" VARCHAR DEFAULT 'AED',
  "exchange_rate_to_aed" DECIMAL(18,4) DEFAULT 1,
  "customer_type" VARCHAR,
  "corporate_account_id" VARCHAR,
  "airline_code" VARCHAR,
  "frequent_flyer_prog" VARCHAR,
  "credit_card_type" VARCHAR,
  "pickup_location_code" VARCHAR,
  "dropoff_location_code" VARCHAR,
  "is_airport_rate" BOOLEAN DEFAULT FALSE,
  "is_domestic" BOOLEAN DEFAULT TRUE,
  "channel" VARCHAR,
  "online_discount" DECIMAL(18,4) DEFAULT 0,
  "grace_period_min" INTEGER DEFAULT 30,
  "late_fee_per_hour" DECIMAL(18,4),
  "late_fee_cap" DECIMAL(18,4),
  "min_rental_days" INTEGER DEFAULT 1,
  "min_rental_hours" INTEGER DEFAULT 0,
  "insurance_plans" VARCHAR
);

CREATE TABLE IF NOT EXISTS "RentalRateQuote" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "booking_id" VARCHAR,
  "vehicle_category" VARCHAR,
  "pickup_date" TIMESTAMPTZ,
  "dropoff_date" TIMESTAMPTZ,
  "total_days" INTEGER,
  "total_hours" INTEGER,
  "applied_rule_id" VARCHAR,
  "currency" VARCHAR DEFAULT 'AED',
  "base_rental_charge" DECIMAL(18,4),
  "insurance_plan_code" VARCHAR,
  "insurance_charge" DECIMAL(18,4) DEFAULT 0,
  "extras" VARCHAR
);

CREATE TABLE IF NOT EXISTS "rental_agreements" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "agreement_no" VARCHAR,
  "booking_id" VARCHAR,
  "customer_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "daily_rate" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "security_deposit" DECIMAL(18,4),
  "deposit_status" VARCHAR DEFAULT 'PENDING',
  "mileage_in" INTEGER,
  "mileage_out" INTEGER,
  "fuel_in" INTEGER,
  "fuel_out" INTEGER,
  "terms" VARCHAR,
  "status" VARCHAR DEFAULT 'DRAFT',
  "signed_at" TIMESTAMPTZ,
  "signed_by" VARCHAR,
  "open_branch_id" VARCHAR,
  "close_branch_id" VARCHAR,
  "source_type" VARCHAR DEFAULT 'BOOKING',
  "rate_quote_id" VARCHAR,
  "insurance_plan_code" VARCHAR,
  "insurance_daily_rate" DECIMAL(18,4),
  "is_corporate" BOOLEAN DEFAULT FALSE,
  "corporate_account_id" VARCHAR,
  "authorization_code" VARCHAR,
  "credit_card_last4" VARCHAR,
  "credit_card_token" VARCHAR,
  "remarks" VARCHAR,
  "language" VARCHAR DEFAULT 'en',
  "payments" JSONB,
  "extensions" JSONB,
  "charges" JSONB,
  "vehicle_exchanges" JSONB,
  "invoices" JSONB
);

CREATE TABLE IF NOT EXISTS "rental_vehicle_exchanges" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "agreement_id" VARCHAR,
  "from_vehicle_id" VARCHAR,
  "to_vehicle_id" VARCHAR,
  "exchange_date" TIMESTAMPTZ,
  "reason" VARCHAR,
  "mileage_at_exchange" INTEGER,
  "fuel_at_exchange" INTEGER,
  "rate_difference" DECIMAL(18,4),
  "authorized_by" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "rental_extensions" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "agreement_id" VARCHAR,
  "original_end_date" TIMESTAMPTZ,
  "new_end_date" TIMESTAMPTZ,
  "extra_days" INTEGER,
  "extra_amount" DECIMAL(18,4),
  "reason" VARCHAR,
  "approved_by" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS "rental_payments" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "agreement_id" VARCHAR,
  "amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "payment_method" VARCHAR,
  "reference_no" VARCHAR,
  "payment_type" VARCHAR,
  "paid_at" TIMESTAMPTZ,
  "received_by" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "rental_additional_charges" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "agreement_id" VARCHAR,
  "charge_type" VARCHAR,
  "description" VARCHAR,
  "amount" DECIMAL(18,4),
  "quantity" INTEGER DEFAULT 1,
  "total_amount" DECIMAL(18,4),
  "billed_to_customer" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "rental_invoices" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "invoice_no" VARCHAR,
  "agreement_id" VARCHAR,
  "customer_id" VARCHAR,
  "invoice_type" VARCHAR DEFAULT 'STANDARD',
  "invoice_date" TIMESTAMPTZ,
  "due_date" TIMESTAMPTZ,
  "period_from" TIMESTAMPTZ,
  "period_to" TIMESTAMPTZ,
  "currency" VARCHAR DEFAULT 'AED',
  "subtotal" DECIMAL(18,4),
  "discount_amount" DECIMAL(18,4) DEFAULT 0,
  "taxable_amount" DECIMAL(18,4) DEFAULT 0,
  "tax_rate" DECIMAL(18,4) DEFAULT 5,
  "tax_amount" DECIMAL(18,4) DEFAULT 0,
  "total_amount" DECIMAL(18,4),
  "paid_amount" DECIMAL(18,4) DEFAULT 0,
  "balance_due" DECIMAL(18,4),
  "status" VARCHAR DEFAULT 'DRAFT',
  "is_corporate" BOOLEAN DEFAULT FALSE,
  "corporate_account_id" VARCHAR,
  "billing_mode" VARCHAR DEFAULT 'SEPARATE',
  "payment_terms_days" INTEGER DEFAULT 30,
  "sent_at" TIMESTAMPTZ,
  "paid_at" TIMESTAMPTZ,
  "voided_at" TIMESTAMPTZ,
  "void_reason" VARCHAR,
  "parent_invoice_id" VARCHAR,
  "notes" VARCHAR,
  "internal_notes" VARCHAR,
  "line_items" JSONB,
  "receipt_payments" JSONB
);

CREATE TABLE IF NOT EXISTS "rental_invoice_line_items" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "invoice_id" VARCHAR,
  "line_type" VARCHAR,
  "description" VARCHAR,
  "quantity" DECIMAL(18,4),
  "unit_price" DECIMAL(18,4),
  "unit_label" VARCHAR DEFAULT 'day',
  "discount_pct" DECIMAL(18,4) DEFAULT 0,
  "taxable" BOOLEAN DEFAULT TRUE,
  "amount" DECIMAL(18,4),
  "sort_order" INTEGER DEFAULT 0,
  "reference_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "rental_invoice_payments" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "invoice_id" VARCHAR,
  "amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "payment_method" VARCHAR,
  "reference_no" VARCHAR,
  "receipt_no" VARCHAR,
  "paid_at" TIMESTAMPTZ,
  "received_by" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "bus_routes" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "name" VARCHAR,
  "origin" VARCHAR,
  "destination" VARCHAR,
  "route_type" VARCHAR DEFAULT 'STAFF',
  "total_distance_km" DOUBLE PRECISION,
  "estimated_duration_mins" INTEGER,
  "capacity" INTEGER DEFAULT 30,
  "is_active" BOOLEAN DEFAULT TRUE,
  "notes" VARCHAR,
  "stops" JSONB,
  "schedules" JSONB
);

CREATE TABLE IF NOT EXISTS "route_stops" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "route_id" VARCHAR,
  "stop_name" VARCHAR,
  "sequence" INTEGER,
  "gps_lat" DOUBLE PRECISION,
  "gps_lng" DOUBLE PRECISION,
  "estimated_arrival_mins" INTEGER,
  "landmark" VARCHAR
);

CREATE TABLE IF NOT EXISTS "trip_schedules" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "trip_number" VARCHAR,
  "route_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "departure_time" TIMESTAMPTZ,
  "arrival_time" TIMESTAMPTZ,
  "frequency" VARCHAR DEFAULT 'DAILY',
  "shift_type" VARCHAR,
  "direction" VARCHAR DEFAULT 'INBOUND',
  "capacity" INTEGER DEFAULT 30,
  "confirmed_count" INTEGER DEFAULT 0,
  "status" VARCHAR DEFAULT 'SCHEDULED',
  "notes" VARCHAR,
  "passengers" JSONB,
  "trip_logs" JSONB
);

CREATE TABLE IF NOT EXISTS "trip_passengers" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "trip_id" VARCHAR,
  "staff_member_id" VARCHAR,
  "employee_id" VARCHAR,
  "employee_name" VARCHAR,
  "department" VARCHAR,
  "boarding_stop_id" VARCHAR,
  "alighting_stop_id" VARCHAR,
  "boarding_stop_name" VARCHAR,
  "alighting_stop_name" VARCHAR,
  "boarded_at" TIMESTAMPTZ,
  "status" VARCHAR DEFAULT 'CONFIRMED',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "trip_logs" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "schedule_id" VARCHAR,
  "logged_by" VARCHAR,
  "actual_departure_time" TIMESTAMPTZ,
  "actual_arrival_time" TIMESTAMPTZ,
  "start_mileage" DOUBLE PRECISION,
  "end_mileage" DOUBLE PRECISION,
  "fuel_used" DOUBLE PRECISION,
  "passengers_boarded" INTEGER,
  "incidents" VARCHAR,
  "driver_notes" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "staff_members" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "employee_id" VARCHAR,
  "name" VARCHAR,
  "department" VARCHAR,
  "designation" VARCHAR,
  "contact_number" VARCHAR,
  "email" VARCHAR,
  "residence_area" VARCHAR,
  "default_route_id" VARCHAR,
  "default_stop_id" VARCHAR,
  "default_stop_name" VARCHAR,
  "shift_type" VARCHAR,
  "transport_type" VARCHAR DEFAULT 'BUS',
  "is_active" BOOLEAN DEFAULT TRUE,
  "transport_requests" JSONB
);

CREATE TABLE IF NOT EXISTS "staff_transport_requests" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "request_no" VARCHAR,
  "staff_member_id" VARCHAR,
  "request_type" VARCHAR,
  "trip_date" TIMESTAMPTZ,
  "pickup_location" VARCHAR,
  "drop_location" VARCHAR,
  "reason" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING',
  "approved_by" VARCHAR,
  "approved_at" TIMESTAMPTZ,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "trip_incidents" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "incident_no" VARCHAR,
  "schedule_id" VARCHAR,
  "route_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "incident_date" TIMESTAMPTZ,
  "incident_type" VARCHAR,
  "severity" VARCHAR DEFAULT 'LOW',
  "location" VARCHAR,
  "description" VARCHAR,
  "injuries_reported" BOOLEAN DEFAULT FALSE,
  "police_report" BOOLEAN DEFAULT FALSE,
  "police_report_no" VARCHAR,
  "action_taken" VARCHAR,
  "status" VARCHAR DEFAULT 'OPEN',
  "resolved_at" TIMESTAMPTZ,
  "resolved_by" VARCHAR
);

CREATE TABLE IF NOT EXISTS "vehicle_documents" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "vehicle_id" VARCHAR,
  "doc_type" VARCHAR,
  "doc_number" VARCHAR,
  "issue_date" TIMESTAMPTZ,
  "expiry_date" TIMESTAMPTZ,
  "issued_by" VARCHAR,
  "file_url" VARCHAR,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "fuel_logs" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "fuel_date" TIMESTAMPTZ,
  "liters" DOUBLE PRECISION,
  "cost_per_liter" DOUBLE PRECISION,
  "total_cost" DOUBLE PRECISION,
  "mileage" INTEGER,
  "station" VARCHAR,
  "fuel_card_id" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "fuel_cards" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "card_number" VARCHAR,
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "monthly_limit" DOUBLE PRECISION,
  "current_balance" DOUBLE PRECISION,
  "is_active" BOOLEAN DEFAULT TRUE,
  "expiry_date" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "traffic_fines" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "fine_date" TIMESTAMPTZ,
  "fine_amount" DOUBLE PRECISION,
  "authority" VARCHAR,
  "fine_ref" VARCHAR,
  "offence_type" VARCHAR,
  "status" VARCHAR DEFAULT 'UNPAID',
  "paid_date" TIMESTAMPTZ,
  "assigned_to" VARCHAR
);

CREATE TABLE IF NOT EXISTS "driver_documents" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "driver_id" VARCHAR,
  "doc_type" VARCHAR,
  "doc_number" VARCHAR,
  "expiry_date" TIMESTAMPTZ,
  "file_url" VARCHAR,
  "status" VARCHAR DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS "driver_shifts" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "driver_id" VARCHAR,
  "shift_date" TIMESTAMPTZ,
  "start_time" TIMESTAMPTZ,
  "end_time" TIMESTAMPTZ,
  "total_hours" DOUBLE PRECISION,
  "status" VARCHAR DEFAULT 'SCHEDULED',
  "vehicle_id" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "driver_trainings" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "driver_id" VARCHAR,
  "course_name" VARCHAR,
  "provider" VARCHAR,
  "completed_date" TIMESTAMPTZ,
  "expiry_date" TIMESTAMPTZ,
  "certificate_url" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS "driver_performance" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "driver_id" VARCHAR,
  "period_month" INTEGER,
  "period_year" INTEGER,
  "on_time_pct" DOUBLE PRECISION,
  "incident_count" INTEGER,
  "customer_rating" DOUBLE PRECISION,
  "fuel_efficiency" DOUBLE PRECISION,
  "total_trips" INTEGER,
  "total_km" DOUBLE PRECISION,
  "score" DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "booking_ref" VARCHAR,
  "service_type" VARCHAR,
  "requestor_id" VARCHAR,
  "requestor_name" VARCHAR,
  "requestor_email" VARCHAR,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "vehicle_category" VARCHAR,
  "vehicle_id" VARCHAR,
  "notes" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING',
  "approved_by" VARCHAR,
  "approved_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "invoice_id" VARCHAR,
  "amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "payment_method" VARCHAR,
  "gateway_ref" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING',
  "paid_at" TIMESTAMPTZ,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "credit_note_no" VARCHAR,
  "invoice_id" VARCHAR,
  "reason" VARCHAR,
  "amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "approved_by" VARCHAR,
  "issued_at" TIMESTAMPTZ,
  "status" VARCHAR DEFAULT 'DRAFT'
);

CREATE TABLE IF NOT EXISTS "finance_budgets" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "year" INTEGER,
  "month" INTEGER,
  "category" VARCHAR,
  "budget_amount" DECIMAL(18,4),
  "actual_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED'
);

CREATE TABLE IF NOT EXISTS "vat_returns" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "period_from" TIMESTAMPTZ,
  "period_to" TIMESTAMPTZ,
  "total_sales" DECIMAL(18,4),
  "total_vat_output" DECIMAL(18,4),
  "total_vat_input" DECIMAL(18,4),
  "net_vat_due" DECIMAL(18,4),
  "status" VARCHAR DEFAULT 'DRAFT',
  "filed_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "compliance_documents" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "entity_type" VARCHAR,
  "entity_id" VARCHAR,
  "doc_type" VARCHAR,
  "doc_number" VARCHAR,
  "authority" VARCHAR,
  "issue_date" TIMESTAMPTZ,
  "expiry_date" TIMESTAMPTZ,
  "file_url" VARCHAR,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "reminder_days" INTEGER DEFAULT 30,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "insurance_policies" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "policy_number" VARCHAR,
  "vehicle_id" VARCHAR,
  "provider" VARCHAR,
  "policy_type" VARCHAR,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "premium" DECIMAL(18,4),
  "sum_insured" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'ACTIVE',
  "file_url" VARCHAR
);

CREATE TABLE IF NOT EXISTS "salik_accounts" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "tag_number" VARCHAR,
  "vehicle_id" VARCHAR,
  "balance" DOUBLE PRECISION DEFAULT 0,
  "auto_recharge" BOOLEAN DEFAULT FALSE,
  "recharge_amount" DOUBLE PRECISION,
  "is_active" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "report_schedules" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "report_name" VARCHAR,
  "report_type" VARCHAR,
  "frequency" VARCHAR,
  "recipients" TEXT[],
  "format" VARCHAR DEFAULT 'PDF',
  "last_run_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ,
  "is_active" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "lease_branches" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "name" VARCHAR,
  "code" VARCHAR,
  "address" VARCHAR,
  "city" VARCHAR,
  "country" VARCHAR DEFAULT 'UAE',
  "contact_person" VARCHAR,
  "phone" VARCHAR,
  "email" VARCHAR,
  "is_active" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "lease_inquiries" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "inquiry_number" VARCHAR,
  "customer_name" VARCHAR,
  "customer_email" VARCHAR,
  "customer_phone" VARCHAR,
  "company_name" VARCHAR,
  "vehicle_type" VARCHAR,
  "vehicle_groups" VARCHAR,
  "vehicle_makes" VARCHAR,
  "vehicle_models" VARCHAR,
  "vehicle_count" INTEGER DEFAULT 1,
  "lease_type" VARCHAR,
  "duration_months" INTEGER,
  "start_date" TIMESTAMPTZ,
  "requires_driver" BOOLEAN DEFAULT FALSE,
  "requires_insurance" BOOLEAN DEFAULT FALSE,
  "requires_maintenance" BOOLEAN DEFAULT FALSE,
  "notes" VARCHAR,
  "status" VARCHAR DEFAULT 'NEW',
  "assigned_to" VARCHAR,
  "branch_id" VARCHAR,
  "quotations" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_quotations" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "quotation_number" VARCHAR,
  "inquiry_id" VARCHAR,
  "lessee_id" VARCHAR,
  "lease_type" VARCHAR,
  "duration_months" INTEGER,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "vehicle_type" VARCHAR,
  "vehicle_count" INTEGER DEFAULT 1,
  "base_monthly_rate" DECIMAL(18,4),
  "interest_rate" DECIMAL(18,4),
  "markup_pct" DECIMAL(18,4),
  "accessories_cost" DECIMAL(18,4),
  "services_cost" DECIMAL(18,4),
  "insurance_cost" DECIMAL(18,4),
  "maintenance_cost" DECIMAL(18,4),
  "driver_cost" DECIMAL(18,4),
  "total_monthly_rate" DECIMAL(18,4),
  "total_contract_value" DECIMAL(18,4),
  "security_deposit" DECIMAL(18,4),
  "mileage_cap" INTEGER,
  "currency" VARCHAR DEFAULT 'AED',
  "insurance_included" BOOLEAN DEFAULT FALSE,
  "maintenance_included" BOOLEAN DEFAULT FALSE,
  "driver_included" BOOLEAN DEFAULT FALSE,
  "valid_until" TIMESTAMPTZ,
  "status" VARCHAR DEFAULT 'NEW',
  "internal_approved_by" VARCHAR,
  "internal_approved_at" TIMESTAMPTZ,
  "customer_approved_at" TIMESTAMPTZ,
  "credit_approved_by" VARCHAR,
  "credit_approved_at" TIMESTAMPTZ,
  "notes" VARCHAR,
  "branch_id" VARCHAR,
  "line_items" JSONB,
  "vehicles" JSONB,
  "contracts" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_quotation_items" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "quotation_id" VARCHAR,
  "item_type" VARCHAR,
  "description" VARCHAR,
  "quantity" INTEGER DEFAULT 1,
  "unit_rate" DECIMAL(18,4),
  "monthly_amount" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_quotation_vehicles" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "quotation_id" VARCHAR,
  "vehicle_type" VARCHAR,
  "make" VARCHAR,
  "model" VARCHAR,
  "year" INTEGER,
  "quantity" INTEGER DEFAULT 1,
  "vehicle_id" VARCHAR,
  "monthly_rate" DECIMAL(18,4)
);

CREATE TABLE IF NOT EXISTS "lease_contracts_v2" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "contract_number" VARCHAR,
  "agreement_type" VARCHAR,
  "master_contract_id" VARCHAR,
  "quotation_id" VARCHAR,
  "lessee_id" VARCHAR,
  "lease_type" VARCHAR,
  "start_date" TIMESTAMPTZ,
  "end_date" TIMESTAMPTZ,
  "monthly_rate" DECIMAL(18,4),
  "total_contract_value" DECIMAL(18,4),
  "mileage_cap" INTEGER,
  "security_deposit" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "insurance_included" BOOLEAN DEFAULT FALSE,
  "maintenance_included" BOOLEAN DEFAULT FALSE,
  "driver_included" BOOLEAN DEFAULT FALSE,
  "opening_branch_id" VARCHAR,
  "closing_branch_id" VARCHAR,
  "status" VARCHAR DEFAULT 'DRAFT',
  "approved_by" VARCHAR,
  "approved_at" TIMESTAMPTZ,
  "notes" VARCHAR,
  "vehicles" JSONB,
  "payments2" JSONB,
  "receipts" JSONB,
  "exchanges" JSONB,
  "insurance_policies" JSONB,
  "mileage_readings" JSONB,
  "mileage_overages" JSONB,
  "traffic_fines" JSONB,
  "fuel_logs" JSONB,
  "early_terminations" JSONB,
  "renewals" JSONB,
  "pre_billing_statements" JSONB,
  "dunning_activities" JSONB,
  "alerts" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_contract_vehicles" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "vehicle_type" VARCHAR,
  "make" VARCHAR,
  "model" VARCHAR,
  "year" INTEGER,
  "license_plate" VARCHAR,
  "vin" VARCHAR,
  "driver_id" VARCHAR,
  "monthly_rate" DECIMAL(18,4),
  "mileage_start" INTEGER,
  "status" VARCHAR DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS "lease_payments_v2" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "period_month" INTEGER,
  "period_year" INTEGER,
  "due_date" TIMESTAMPTZ,
  "amount" DECIMAL(18,4),
  "vat_amount" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "paid_date" TIMESTAMPTZ,
  "receipt_id" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_receipts" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "receipt_number" VARCHAR,
  "contract_id" VARCHAR,
  "payment_type" VARCHAR,
  "amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "received_date" TIMESTAMPTZ,
  "payment_method" VARCHAR,
  "cheque_no" VARCHAR,
  "bank_ref" VARCHAR,
  "received_by" VARCHAR,
  "branch_id" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_vehicle_exchanges" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "outgoing_vehicle_id" VARCHAR,
  "incoming_vehicle_id" VARCHAR,
  "exchange_date" TIMESTAMPTZ,
  "reason" VARCHAR,
  "approved_by" VARCHAR,
  "outgoing_mileage" INTEGER,
  "incoming_mileage" INTEGER,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_alerts" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "quotation_id" VARCHAR,
  "alert_type" VARCHAR,
  "severity" VARCHAR DEFAULT 'WARNING',
  "title" VARCHAR,
  "message" VARCHAR,
  "status" VARCHAR DEFAULT 'OPEN',
  "acknowledged_by" VARCHAR,
  "resolved_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "lease_approval_steps" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "entity_type" VARCHAR,
  "entity_id" VARCHAR,
  "step_name" VARCHAR,
  "step_order" INTEGER,
  "approver_role" VARCHAR,
  "approver_name" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING',
  "action_at" TIMESTAMPTZ,
  "comments" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_insurance_policies" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "policy_no" VARCHAR,
  "contract_id" VARCHAR,
  "lessee_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "insurer" VARCHAR,
  "coverage_type" VARCHAR,
  "premium" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "start_date" TIMESTAMPTZ,
  "expiry_date" TIMESTAMPTZ,
  "renewal_reminder_days" INTEGER DEFAULT 30,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "deductible" DECIMAL(18,4),
  "notes" VARCHAR,
  "claims" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_insurance_claims" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "claim_no" VARCHAR,
  "policy_id" VARCHAR,
  "contract_id" VARCHAR,
  "claim_date" TIMESTAMPTZ,
  "incident_date" TIMESTAMPTZ,
  "claim_type" VARCHAR,
  "description" VARCHAR,
  "claim_amount" DECIMAL(18,4),
  "approved_amount" DECIMAL(18,4),
  "deductible" DECIMAL(18,4),
  "status" VARCHAR DEFAULT 'SUBMITTED',
  "settled_at" TIMESTAMPTZ,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_mileage_readings" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "contract_vehicle_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "reading_date" TIMESTAMPTZ,
  "mileage" INTEGER,
  "reading_type" VARCHAR,
  "captured_by" VARCHAR,
  "source" VARCHAR DEFAULT 'MANUAL',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_mileage_overages" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "period_from" TIMESTAMPTZ,
  "period_to" TIMESTAMPTZ,
  "allowed_km" INTEGER,
  "actual_km" INTEGER,
  "overage_km" INTEGER,
  "rate_per_km" DECIMAL(18,4),
  "overage_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "invoiced" BOOLEAN DEFAULT FALSE,
  "invoice_ref" VARCHAR,
  "status" VARCHAR DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS "lease_traffic_fines" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "fine_no" VARCHAR,
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "lessee_id" VARCHAR,
  "violation_date" TIMESTAMPTZ,
  "violation_type" VARCHAR,
  "authority" VARCHAR,
  "location" VARCHAR,
  "fine_amount" DECIMAL(18,4),
  "discount_amount" DECIMAL(18,4),
  "final_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "due_date" TIMESTAMPTZ,
  "billed_to_lessee" BOOLEAN DEFAULT TRUE,
  "billing_status" VARCHAR DEFAULT 'PENDING',
  "paid_date" TIMESTAMPTZ,
  "payment_ref" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_fuel_logs" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "driver_id" VARCHAR,
  "fuel_date" TIMESTAMPTZ,
  "liters" DECIMAL(18,4),
  "cost_per_liter" DECIMAL(18,4),
  "total_cost" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "station" VARCHAR,
  "mileage_at_fuel" INTEGER,
  "fuel_card_no" VARCHAR,
  "billed_to_lessee" BOOLEAN DEFAULT TRUE,
  "billing_status" VARCHAR DEFAULT 'PENDING',
  "receipt_ref" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_documents" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "entity_type" VARCHAR,
  "entity_id" VARCHAR,
  "doc_type" VARCHAR,
  "doc_name" VARCHAR,
  "file_name" VARCHAR,
  "file_url" VARCHAR,
  "file_size" INTEGER,
  "mime_type" VARCHAR,
  "issue_date" TIMESTAMPTZ,
  "expiry_date" TIMESTAMPTZ,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "uploaded_by" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_early_terminations" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "termination_no" VARCHAR,
  "contract_id" VARCHAR,
  "requested_by" VARCHAR,
  "request_date" TIMESTAMPTZ,
  "effective_date" TIMESTAMPTZ,
  "reason" VARCHAR,
  "remaining_months" INTEGER,
  "monthly_rate" DECIMAL(18,4),
  "penalty_pct" DECIMAL(18,4),
  "penalty_amount" DECIMAL(18,4),
  "outstanding_payments" DECIMAL(18,4),
  "deposit_refund" DECIMAL(18,4),
  "total_settlement" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'DRAFT',
  "approved_by" VARCHAR,
  "approved_at" TIMESTAMPTZ,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_renewals" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "renewal_no" VARCHAR,
  "original_contract_id" VARCHAR,
  "new_contract_id" VARCHAR,
  "new_quotation_id" VARCHAR,
  "renewal_type" VARCHAR,
  "proposed_start_date" TIMESTAMPTZ,
  "proposed_end_date" TIMESTAMPTZ,
  "proposed_monthly_rate" DECIMAL(18,4),
  "status" VARCHAR DEFAULT 'PROPOSED',
  "customer_response_at" TIMESTAMPTZ,
  "initiated_by" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_pre_billing_statements" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "statement_no" VARCHAR,
  "contract_id" VARCHAR,
  "lessee_id" VARCHAR,
  "billing_period" VARCHAR,
  "due_date" TIMESTAMPTZ,
  "base_rent" DECIMAL(18,4),
  "fuel_charges" DECIMAL(18,4) DEFAULT 0,
  "fine_charges" DECIMAL(18,4) DEFAULT 0,
  "maintenance_charges" DECIMAL(18,4) DEFAULT 0,
  "overage_charges" DECIMAL(18,4) DEFAULT 0,
  "other_charges" DECIMAL(18,4) DEFAULT 0,
  "vat_amount" DECIMAL(18,4) DEFAULT 0,
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'DRAFT',
  "sent_at" TIMESTAMPTZ,
  "confirmed_at" TIMESTAMPTZ,
  "dispute_notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_dunning_activities" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "lessee_id" VARCHAR,
  "activity_type" VARCHAR,
  "days_overdue" INTEGER,
  "outstanding_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "performed_by" VARCHAR,
  "response" VARCHAR,
  "next_action_date" TIMESTAMPTZ,
  "next_action_type" VARCHAR,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_credit_assessments" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "lessee_id" VARCHAR,
  "assessment_date" TIMESTAMPTZ,
  "credit_limit" DECIMAL(18,4),
  "credit_score" INTEGER,
  "risk_rating" VARCHAR,
  "annual_revenue" DECIMAL(18,4),
  "years_in_business" INTEGER,
  "payment_history" VARCHAR,
  "current_exposure" DECIMAL(18,4),
  "recommended_limit" DECIMAL(18,4),
  "assessed_by" VARCHAR,
  "valid_until" TIMESTAMPTZ,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_invoices" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "invoice_no" VARCHAR,
  "lessee_id" VARCHAR,
  "billing_period" VARCHAR,
  "issue_date" TIMESTAMPTZ,
  "due_date" TIMESTAMPTZ,
  "sub_total" DECIMAL(18,4),
  "vat_pct" DECIMAL(18,4) DEFAULT 5,
  "vat_amount" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'DRAFT',
  "sent_at" TIMESTAMPTZ,
  "paid_at" TIMESTAMPTZ,
  "payment_ref" VARCHAR,
  "notes" VARCHAR,
  "lines" JSONB
);

CREATE TABLE IF NOT EXISTS "lease_invoice_lines" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "invoice_id" VARCHAR,
  "contract_id" VARCHAR,
  "vehicle_ref" VARCHAR,
  "description" VARCHAR,
  "line_type" VARCHAR,
  "quantity" INTEGER DEFAULT 1,
  "unit_amount" DECIMAL(18,4),
  "total_amount" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED'
);

CREATE TABLE IF NOT EXISTS "lease_direct_debits" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "lessee_id" VARCHAR,
  "contract_id" VARCHAR,
  "bank_name" VARCHAR,
  "account_name" VARCHAR,
  "iban" VARCHAR,
  "mandate_ref" VARCHAR,
  "collection_day" INTEGER,
  "currency" VARCHAR DEFAULT 'AED',
  "status" VARCHAR DEFAULT 'PENDING',
  "activated_at" TIMESTAMPTZ,
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_remarketing" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "remarketing_no" VARCHAR,
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "make" VARCHAR,
  "model" VARCHAR,
  "year" INTEGER,
  "plate_no" VARCHAR,
  "return_date" TIMESTAMPTZ,
  "return_mileage" INTEGER,
  "condition" VARCHAR,
  "book_value" DECIMAL(18,4),
  "residual_value" DECIMAL(18,4),
  "asking_price" DECIMAL(18,4),
  "sale_price" DECIMAL(18,4),
  "buyer_name" VARCHAR,
  "buyer_type" VARCHAR,
  "sale_date" TIMESTAMPTZ,
  "sale_profit" DECIMAL(18,4),
  "currency" VARCHAR DEFAULT 'AED',
  "stage" VARCHAR DEFAULT 'AVAILABLE',
  "notes" VARCHAR
);

CREATE TABLE IF NOT EXISTS "lease_telematics" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "contract_id" VARCHAR,
  "vehicle_id" VARCHAR,
  "provider" VARCHAR,
  "device_id" VARCHAR,
  "last_odometer" INTEGER,
  "last_update_at" TIMESTAMPTZ,
  "last_lat" DOUBLE PRECISION,
  "last_lng" DOUBLE PRECISION,
  "status" VARCHAR DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "name" VARCHAR,
  "code" VARCHAR,
  "plan" VARCHAR DEFAULT 'STANDARD',
  "industry" VARCHAR,
  "domain" VARCHAR,
  "address" VARCHAR,
  "contact_name" VARCHAR,
  "contact_email" VARCHAR,
  "contact_phone" VARCHAR,
  "default_language" VARCHAR DEFAULT 'en',
  "supported_languages" VARCHAR DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS "tenant_modules" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "tenant_id" VARCHAR,
  "module" VARCHAR,
  "is_enabled" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "roles" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "tenant_id" VARCHAR,
  "name" VARCHAR,
  "code" VARCHAR,
  "description" VARCHAR,
  "is_system" BOOLEAN DEFAULT FALSE,
  "permissions" JSONB,
  "user_tenants" JSONB
);

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "module" VARCHAR,
  "action" VARCHAR,
  "resource" VARCHAR DEFAULT '*',
  "label" VARCHAR,
  "description" VARCHAR,
  "roles" JSONB
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "role_id" VARCHAR,
  "permission_id" VARCHAR
);

CREATE TABLE IF NOT EXISTS "user_tenants" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "user_id" VARCHAR,
  "tenant_id" VARCHAR,
  "role_id" VARCHAR,
  "is_active" BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "tenant_settings" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "tenant_id" VARCHAR,
  "trip_merging_enabled" BOOLEAN DEFAULT FALSE,
  "pickup_match_type" VARCHAR DEFAULT 'DISTANCE',
  "pickup_distance_km" DECIMAL(18,4) DEFAULT 7,
  "pickup_time_window_min" INTEGER DEFAULT 30,
  "require_dropoff_match" BOOLEAN DEFAULT TRUE,
  "dropoff_match_type" VARCHAR DEFAULT 'DISTANCE',
  "dropoff_distance_km" DECIMAL(18,4) DEFAULT 25,
  "dropoff_time_window_min" INTEGER DEFAULT 30,
  "max_passengers" INTEGER DEFAULT 5,
  "travel_speed_kmh" DECIMAL(18,4) DEFAULT 40,
  "stop_duration_min" INTEGER DEFAULT 10,
  "max_pickup_delay_min" INTEGER DEFAULT 30,
  "auto_merge_enabled" BOOLEAN DEFAULT FALSE,
  "trigger_before_pickup_min" INTEGER DEFAULT 30,
  "look_ahead_hours" INTEGER DEFAULT 24,
  "auto_dispatch_enabled" BOOLEAN DEFAULT FALSE,
  "max_driver_attempts" INTEGER DEFAULT 3,
  "driver_response_timeout_min" INTEGER DEFAULT 6,
  "dispatch_radius" DECIMAL(18,4) DEFAULT 10,
  "prefer_nearest_driver" BOOLEAN DEFAULT TRUE,
  "route_optimization_enabled" BOOLEAN DEFAULT FALSE,
  "routing_engine" VARCHAR DEFAULT 'GOOGLE_MAPS',
  "google_maps_api_key" VARCHAR,
  "max_api_calls_per_hour" INTEGER DEFAULT 500,
  "max_api_calls_per_day" INTEGER DEFAULT 5000,
  "road_distance_multiplier" DECIMAL(18,4),
  "fallback_to_straight_line" BOOLEAN DEFAULT TRUE,
  "email_notifications_enabled" BOOLEAN DEFAULT FALSE,
  "smtp_host" VARCHAR,
  "smtp_port" VARCHAR DEFAULT '587',
  "smtp_user" VARCHAR,
  "smtp_pass" VARCHAR,
  "smtp_from_email" VARCHAR,
  "smtp_from_name" VARCHAR,
  "sms_notifications_enabled" BOOLEAN DEFAULT FALSE,
  "sms_provider" VARCHAR,
  "sms_api_key" VARCHAR,
  "sms_from_number" VARCHAR,
  "push_notifications_enabled" BOOLEAN DEFAULT TRUE,
  "notification_preferences" VARCHAR,
  "trip_reminder_timing_min" INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS "customers" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ,
  "deleted_at" TIMESTAMPTZ,
  "tenant_id" VARCHAR,
  "customer_code" VARCHAR,
  "customer_type" VARCHAR,
  "priority" VARCHAR,
  "account_code" VARCHAR,
  "trade_license" VARCHAR,
  "mobile_number" VARCHAR,
  "mobile_country_code" VARCHAR DEFAULT '+971',
  "email" VARCHAR,
  "communication_language" VARCHAR DEFAULT 'en',
  "name_en" VARCHAR,
  "name_ar" VARCHAR,
  "description_en" VARCHAR,
  "description_ar" VARCHAR,
  "region_id" VARCHAR,
  "department_id" VARCHAR,
  "unit_id" VARCHAR,
  "contact_person" VARCHAR,
  "contact_person_phone" VARCHAR,
  "contact_person_email" VARCHAR,
  "address_line1" VARCHAR,
  "address_line2" VARCHAR,
  "city" VARCHAR,
  "state" VARCHAR,
  "country" VARCHAR DEFAULT 'UAE',
  "po_box" VARCHAR,
  "latitude" DECIMAL(18,4),
  "longitude" DECIMAL(18,4),
  "tax_registration_number" VARCHAR,
  "tax_applicable" BOOLEAN DEFAULT TRUE,
  "toll_exempt" BOOLEAN DEFAULT FALSE,
  "credit_limit" DECIMAL(18,4),
  "credit_days" INTEGER,
  "allowed_payment_methods" VARCHAR,
  "default_payment_method" VARCHAR,
  "billing_cycle" VARCHAR,
  "invoice_frequency" VARCHAR,
  "invoice_delivery_method" VARCHAR,
  "payment_reminder_days" INTEGER,
  "late_fee_percentage" DECIMAL(18,4),
  "auto_invoice" BOOLEAN DEFAULT FALSE,
  "allowed_waiting_time_min" INTEGER,
  "cancellation_allowed_min" INTEGER,
  "allowed_booking_modifications" INTEGER,
  "skip_approval" BOOLEAN DEFAULT FALSE,
  "preferred_channel" VARCHAR,
  "notification_email" VARCHAR,
  "notification_sms_code" VARCHAR DEFAULT '+971',
  "notification_sms" VARCHAR,
  "marketing_communications" BOOLEAN DEFAULT FALSE,
  "booking_notifications" BOOLEAN DEFAULT TRUE,
  "status" VARCHAR DEFAULT 'ACTIVE',
  "documents" JSONB
);

CREATE TABLE IF NOT EXISTS "customer_hierarchy" (
  "id" VARCHAR DEFAULT gen_random_uuid() PRIMARY KEY,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "tenant_id" VARCHAR,
  "level" VARCHAR,
  "parent_id" VARCHAR,
  "name" VARCHAR,
  "code" VARCHAR,
  "description" VARCHAR,
  "is_active" BOOLEAN DEFAULT TRUE,
  "children" JSONB,
  "customers_as_region" JSONB,
  "customers_as_department" JSONB,
  "customers_as_unit" JSONB
);

-- ── Done ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE 'Full platform schema migration complete.'; END $$;
