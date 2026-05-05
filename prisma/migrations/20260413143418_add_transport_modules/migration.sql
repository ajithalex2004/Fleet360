/*
  Warnings:

  - You are about to drop the `Alert` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AlertConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Attachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Comment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Driver` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Garage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Invoice` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InvoiceLineItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MaintenanceRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Quotation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuotationLabor` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuotationPart` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StatusHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Vehicle` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('SR_CREATED', 'SR_ASSIGNED', 'SR_COMPLETED', 'MAINTENANCE_REQUESTED', 'MAINTENANCE_APPROVED', 'MAINTENANCE_REJECTED', 'MAINTENANCE_COMPLETED', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED', 'QUOTATION_REJECTED', 'INVOICE_GENERATED', 'ALERT_TRIGGERED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('REQUESTER', 'ASSIGNEE', 'FLEET_MANAGER', 'ADMIN', 'CUSTOM');

-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_driverId_fkey";

-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_requestId_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_requestId_fkey";

-- DropForeignKey
ALTER TABLE "Driver" DROP CONSTRAINT "Driver_assignedVehicleId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_garageId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_requestId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceLineItem" DROP CONSTRAINT "InvoiceLineItem_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT "MaintenanceRequest_driverId_fkey";

-- DropForeignKey
ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT "MaintenanceRequest_garageId_fkey";

-- DropForeignKey
ALTER TABLE "MaintenanceRequest" DROP CONSTRAINT "MaintenanceRequest_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_garageId_fkey";

-- DropForeignKey
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_requestId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationLabor" DROP CONSTRAINT "QuotationLabor_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPart" DROP CONSTRAINT "QuotationPart_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceSchedule" DROP CONSTRAINT "ServiceSchedule_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "StatusHistory" DROP CONSTRAINT "StatusHistory_requestId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_garageId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_requestId_fkey";

-- DropTable
DROP TABLE "Alert";

-- DropTable
DROP TABLE "AlertConfig";

-- DropTable
DROP TABLE "Attachment";

-- DropTable
DROP TABLE "Comment";

-- DropTable
DROP TABLE "Driver";

-- DropTable
DROP TABLE "Garage";

-- DropTable
DROP TABLE "Invoice";

-- DropTable
DROP TABLE "InvoiceLineItem";

-- DropTable
DROP TABLE "MaintenanceRequest";

-- DropTable
DROP TABLE "Quotation";

-- DropTable
DROP TABLE "QuotationLabor";

-- DropTable
DROP TABLE "QuotationPart";

-- DropTable
DROP TABLE "StatusHistory";

-- DropTable
DROP TABLE "Vehicle";

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "host" TEXT,
    "port" TEXT,
    "username" TEXT,
    "password" TEXT,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "senderId" TEXT,
    "senderEmail" TEXT,
    "fromName" TEXT,
    "encryption" TEXT,
    "accountSid" TEXT,
    "authToken" TEXT,
    "fromNumber" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggerReason" TEXT,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_configs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "alert_for" TEXT,
    "alert_type" TEXT,
    "frequency" TEXT,
    "frequency_value" BIGINT,
    "due_alert_threshold" TEXT,
    "threshold_value" BIGINT,
    "notification_enabled" BOOLEAN,
    "whatsapp_enabled" BOOLEAN,
    "assigned_ids" TEXT[],

    CONSTRAINT "alert_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "type" TEXT,
    "title" TEXT,
    "description" TEXT,
    "severity" TEXT,
    "date_created" TIMESTAMPTZ(6),
    "related_entity_id" TEXT,
    "status" TEXT,
    "assigned_to" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "maintenance_request_id" TEXT,
    "service_request_id" TEXT,
    "quotation_id" TEXT,
    "work_order_id" TEXT,
    "invoice_id" TEXT,
    "type" TEXT,
    "file_name" TEXT,
    "url" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "maintenance_request_id" TEXT,
    "author" TEXT,
    "text" TEXT,
    "timestamp" TIMESTAMPTZ(6),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "name" TEXT,
    "license_number" TEXT,
    "license_expiry" TIMESTAMPTZ(6),
    "assigned_vehicle_id" TEXT,
    "contact_number" TEXT,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "hierarchy" TEXT,
    "driver_type" TEXT,
    "nationality" TEXT,
    "dob" TIMESTAMPTZ(6),
    "emirates_id" TEXT,
    "communication_language" TEXT,
    "date_of_join" TIMESTAMPTZ(6),
    "dallas_id" TEXT,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garages" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "name" TEXT,
    "location" TEXT,
    "contact_person" TEXT,
    "designation" TEXT,
    "email" TEXT,
    "contact_number" TEXT,
    "specialties" TEXT[],
    "is_internal" BOOLEAN,

    CONSTRAINT "garages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "histories" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "maintenance_request_id" TEXT,
    "service_request_id" TEXT,
    "status" TEXT,
    "date" TIMESTAMPTZ(6),
    "note" TEXT,
    "actor" TEXT,

    CONSTRAINT "histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "invoice_id" TEXT,
    "description" TEXT,
    "quantity" BIGINT,
    "unit_price" DECIMAL,
    "total_price" DECIMAL,
    "category" TEXT,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "invoice_number" TEXT,
    "request_id" TEXT,
    "garage_id" TEXT,
    "invoice_date" TIMESTAMPTZ(6),
    "due_date" TIMESTAMPTZ(6),
    "total_amount" DECIMAL,
    "paid_amount" DECIMAL,
    "payment_status" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "request_date" TIMESTAMPTZ(6),
    "description" TEXT,
    "status" TEXT,
    "expected_end_date" TIMESTAMPTZ(6),
    "garage_id" TEXT,
    "estimated_cost" DECIMAL,
    "actual_cost" DECIMAL,
    "actual_parts_cost" DECIMAL,
    "actual_labor_cost" DECIMAL,
    "actual_other_cost" DECIMAL,
    "completion_date" TIMESTAMPTZ(6),
    "maintenance_type" TEXT,
    "priority" TEXT,
    "work_order_no" TEXT,
    "odometer" BIGINT,
    "candidate_garage_ids" TEXT,
    "maintenance_jobs" TEXT[],
    "estimate_approval" TEXT,
    "work_log" TEXT,
    "parts_used" TEXT,
    "checklist_items" TEXT,
    "assigned_technicians" TEXT,
    "actual_costs_data" TEXT,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_labors" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "description" TEXT,
    "hours" DECIMAL,
    "rate_per_hour" DECIMAL,
    "total_price" DECIMAL,
    "quotation_id" TEXT,

    CONSTRAINT "quotation_labors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_parts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "name" TEXT,
    "quantity" BIGINT,
    "unit_price" DECIMAL,
    "total_price" DECIMAL,
    "quotation_id" TEXT,

    CONSTRAINT "quotation_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "quotation_date" TIMESTAMPTZ(6),
    "valid_until" TIMESTAMPTZ(6),
    "labor_cost" DECIMAL,
    "parts_cost" DECIMAL,
    "consumables_cost" DECIMAL,
    "vat_amount" DECIMAL,
    "total_cost" DECIMAL,
    "grand_total" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "estimated_duration" BIGINT,
    "estimated_completion_date" TIMESTAMPTZ(6),
    "status" TEXT,
    "submitted_by" TEXT,
    "notes" TEXT,
    "maintenance_request_id" TEXT,
    "garage_id" TEXT,
    "revision" BIGINT DEFAULT 0,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "requestor_id" TEXT,
    "service_type" TEXT,
    "vehicle_id" TEXT,
    "priority" TEXT,
    "description" TEXT,
    "date" TIMESTAMPTZ(6),
    "status" TEXT,
    "maintenance_request_id" TEXT,
    "assigned_to" TEXT,
    "related_driver_id" TEXT,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "make" TEXT,
    "model" TEXT,
    "type" TEXT,
    "year" BIGINT,
    "license_plate" TEXT,
    "vin" TEXT,
    "current_mileage" BIGINT,
    "status" TEXT,
    "registration_expiry" TIMESTAMPTZ(6),
    "insurance_expiry" TIMESTAMPTZ(6),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "channels" TEXT[],
    "recipientTypes" "RecipientType"[],
    "specificRecipientIds" TEXT[],
    "templateId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessees" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "license_no" TEXT,
    "trade_license" TEXT,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "nationality" TEXT,
    "emirates_id" TEXT,

    CONSTRAINT "lessees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_contracts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "contract_number" TEXT,
    "lessee_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "monthly_rate" DECIMAL NOT NULL,
    "mileage_cap" INTEGER,
    "security_deposit" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "status" TEXT DEFAULT 'DRAFT',
    "notes" TEXT,

    CONSTRAINT "lease_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_payments" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "contract_id" TEXT NOT NULL,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL NOT NULL,
    "paid_date" TIMESTAMPTZ(6),
    "receipt_no" TEXT,
    "status" TEXT DEFAULT 'PENDING',

    CONSTRAINT "lease_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_vehicle_returns" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL,
    "return_date" TIMESTAMPTZ(6) NOT NULL,
    "mileage" INTEGER,
    "condition" TEXT,
    "damages" TEXT,
    "inspector" TEXT,
    "final_cost" DECIMAL,

    CONSTRAINT "lease_vehicle_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_customers" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "full_name" TEXT NOT NULL,
    "nationality" TEXT,
    "passport_no" TEXT,
    "driving_license_no" TEXT,
    "license_expiry" TIMESTAMPTZ(6),
    "email" TEXT,
    "phone" TEXT,
    "blacklisted" BOOLEAN DEFAULT false,

    CONSTRAINT "rental_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_bookings" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "booking_ref" TEXT,
    "customer_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "vehicle_category" TEXT,
    "pickup_date" TIMESTAMPTZ(6) NOT NULL,
    "dropoff_date" TIMESTAMPTZ(6) NOT NULL,
    "pickup_location" TEXT,
    "dropoff_location" TEXT,
    "total_days" INTEGER,
    "daily_rate" DECIMAL,
    "total_amount" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "status" TEXT DEFAULT 'PENDING',
    "channel" TEXT,
    "notes" TEXT,

    CONSTRAINT "rental_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_inspections" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "booking_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mileage" INTEGER,
    "fuel_level" INTEGER,
    "damages" TEXT,
    "inspector" TEXT,
    "notes" TEXT,

    CONSTRAINT "vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_claims" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "booking_id" TEXT NOT NULL,
    "description" TEXT,
    "estimated_cost" DECIMAL,
    "actual_cost" DECIMAL,
    "status" TEXT DEFAULT 'OPEN',
    "insurance_claim" BOOLEAN DEFAULT false,
    "billed_to_customer" BOOLEAN DEFAULT false,

    CONSTRAINT "damage_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "vehicle_category" TEXT NOT NULL,
    "base_daily_rate" DECIMAL NOT NULL,
    "base_km_rate" DECIMAL,
    "season_from" TIMESTAMPTZ(6),
    "season_to" TIMESTAMPTZ(6),
    "multiplier" DECIMAL DEFAULT 1,
    "currency" TEXT DEFAULT 'AED',
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_routes" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "total_distance_km" DOUBLE PRECISION,
    "estimated_duration_mins" INTEGER,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "bus_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "stop_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "gps_lat" DOUBLE PRECISION,
    "gps_lng" DOUBLE PRECISION,
    "estimated_arrival_mins" INTEGER,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_schedules" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "route_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "departure_time" TIMESTAMPTZ(6) NOT NULL,
    "frequency" TEXT,
    "shift_type" TEXT,
    "status" TEXT DEFAULT 'SCHEDULED',

    CONSTRAINT "trip_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_passengers" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "employee_name" TEXT,
    "boarding_stop_id" TEXT,
    "alighting_stop_id" TEXT,
    "status" TEXT DEFAULT 'CONFIRMED',

    CONSTRAINT "trip_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "schedule_id" TEXT NOT NULL,
    "actual_departure_time" TIMESTAMPTZ(6),
    "actual_arrival_time" TIMESTAMPTZ(6),
    "mileage" DOUBLE PRECISION,
    "fuel_used" DOUBLE PRECISION,
    "incidents" TEXT,
    "notes" TEXT,

    CONSTRAINT "trip_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "employee_id" TEXT,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "contact_number" TEXT,
    "email" TEXT,
    "default_route_id" TEXT,
    "default_stop_id" TEXT,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "vehicle_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_number" TEXT,
    "issue_date" TIMESTAMPTZ(6),
    "expiry_date" TIMESTAMPTZ(6),
    "issued_by" TEXT,
    "file_url" TEXT,
    "status" TEXT DEFAULT 'ACTIVE',
    "notes" TEXT,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "fuel_date" TIMESTAMPTZ(6) NOT NULL,
    "liters" DOUBLE PRECISION NOT NULL,
    "cost_per_liter" DOUBLE PRECISION,
    "total_cost" DOUBLE PRECISION,
    "mileage" INTEGER,
    "station" TEXT,
    "fuel_card_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_cards" (
    "id" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "monthly_limit" DOUBLE PRECISION,
    "current_balance" DOUBLE PRECISION,
    "is_active" BOOLEAN DEFAULT true,
    "expiry_date" TIMESTAMPTZ(6),

    CONSTRAINT "fuel_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_fines" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "fine_date" TIMESTAMPTZ(6) NOT NULL,
    "fine_amount" DOUBLE PRECISION NOT NULL,
    "authority" TEXT,
    "fine_ref" TEXT,
    "offence_type" TEXT,
    "status" TEXT DEFAULT 'UNPAID',
    "paid_date" TIMESTAMPTZ(6),
    "assigned_to" TEXT,

    CONSTRAINT "traffic_fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "driver_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_number" TEXT,
    "expiry_date" TIMESTAMPTZ(6),
    "file_url" TEXT,
    "status" TEXT DEFAULT 'ACTIVE',

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_shifts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "driver_id" TEXT NOT NULL,
    "shift_date" TIMESTAMPTZ(6) NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6),
    "total_hours" DOUBLE PRECISION,
    "status" TEXT DEFAULT 'SCHEDULED',
    "vehicle_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "driver_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_trainings" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "driver_id" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "provider" TEXT,
    "completed_date" TIMESTAMPTZ(6),
    "expiry_date" TIMESTAMPTZ(6),
    "certificate_url" TEXT,
    "status" TEXT DEFAULT 'PENDING',

    CONSTRAINT "driver_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_performance" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "driver_id" TEXT NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "on_time_pct" DOUBLE PRECISION,
    "incident_count" INTEGER,
    "customer_rating" DOUBLE PRECISION,
    "fuel_efficiency" DOUBLE PRECISION,
    "total_trips" INTEGER,
    "total_km" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,

    CONSTRAINT "driver_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "booking_ref" TEXT,
    "service_type" TEXT NOT NULL,
    "requestor_id" TEXT,
    "requestor_name" TEXT,
    "requestor_email" TEXT,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6),
    "vehicle_category" TEXT,
    "vehicle_id" TEXT,
    "notes" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "invoice_id" TEXT,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED',
    "payment_method" TEXT,
    "gateway_ref" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "credit_note_no" TEXT,
    "invoice_id" TEXT,
    "reason" TEXT,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED',
    "approved_by" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'DRAFT',

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budgets" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "budget_amount" DECIMAL NOT NULL,
    "actual_amount" DECIMAL,
    "currency" TEXT DEFAULT 'AED',

    CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_returns" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "total_sales" DECIMAL,
    "total_vat_output" DECIMAL,
    "total_vat_input" DECIMAL,
    "net_vat_due" DECIMAL,
    "status" TEXT DEFAULT 'DRAFT',
    "filed_at" TIMESTAMPTZ(6),

    CONSTRAINT "vat_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_number" TEXT,
    "authority" TEXT,
    "issue_date" TIMESTAMPTZ(6),
    "expiry_date" TIMESTAMPTZ(6),
    "file_url" TEXT,
    "status" TEXT DEFAULT 'ACTIVE',
    "reminder_days" INTEGER DEFAULT 30,
    "notes" TEXT,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "policy_number" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "provider" TEXT NOT NULL,
    "policy_type" TEXT NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "premium" DECIMAL,
    "sum_insured" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "status" TEXT DEFAULT 'ACTIVE',
    "file_url" TEXT,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salik_accounts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "tag_number" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "balance" DOUBLE PRECISION DEFAULT 0,
    "auto_recharge" BOOLEAN DEFAULT false,
    "recharge_amount" DOUBLE PRECISION,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "salik_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "report_name" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT[],
    "format" TEXT DEFAULT 'PDF',
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_type_key" ON "IntegrationConfig"("type");

-- CreateIndex
CREATE INDEX "idx_alert_configs_deleted_at" ON "alert_configs"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_alerts_deleted_at" ON "alerts"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_attachments_deleted_at" ON "attachments"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_comments_deleted_at" ON "comments"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_drivers_license_number" ON "drivers"("license_number");

-- CreateIndex
CREATE INDEX "idx_drivers_deleted_at" ON "drivers"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_garages_deleted_at" ON "garages"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_histories_deleted_at" ON "histories"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_invoice_line_items_deleted_at" ON "invoice_line_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_invoices_invoice_number" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "idx_invoices_deleted_at" ON "invoices"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_maintenance_requests_deleted_at" ON "maintenance_requests"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_quotation_labors_deleted_at" ON "quotation_labors"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_quotation_parts_deleted_at" ON "quotation_parts"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_quotations_deleted_at" ON "quotations"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_service_requests_deleted_at" ON "service_requests"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_vehicles_license_plate" ON "vehicles"("license_plate");

-- CreateIndex
CREATE UNIQUE INDEX "idx_vehicles_vin" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "idx_vehicles_deleted_at" ON "vehicles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rules_event_key" ON "notification_rules"("event");

-- CreateIndex
CREATE UNIQUE INDEX "lease_contracts_contract_number_key" ON "lease_contracts"("contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "rental_bookings_booking_ref_key" ON "rental_bookings"("booking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_employee_id_key" ON "staff_members"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_cards_card_number_key" ON "fuel_cards"("card_number");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_ref_key" ON "bookings"("booking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_credit_note_no_key" ON "credit_notes"("credit_note_no");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_policy_number_key" ON "insurance_policies"("policy_number");

-- CreateIndex
CREATE UNIQUE INDEX "salik_accounts_tag_number_key" ON "salik_accounts"("tag_number");

-- AddForeignKey
ALTER TABLE "ServiceSchedule" ADD CONSTRAINT "ServiceSchedule_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "fk_maintenance_requests_attachments" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "fk_quotations_attachments" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "fk_service_requests_attachments" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "fk_maintenance_requests_comments" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_assigned_vehicle_id_fkey" FOREIGN KEY ("assigned_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "histories" ADD CONSTRAINT "fk_maintenance_requests_history" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "histories" ADD CONSTRAINT "fk_service_requests_history" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "fk_invoices_line_items" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "fk_maintenance_requests_driver" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "fk_maintenance_requests_garage" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "fk_maintenance_requests_vehicle" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotation_labors" ADD CONSTRAINT "fk_quotations_labor" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotation_parts" ADD CONSTRAINT "fk_quotations_parts" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "fk_maintenance_requests_quotations" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "fk_quotations_garage" FOREIGN KEY ("garage_id") REFERENCES "garages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_contracts" ADD CONSTRAINT "lease_contracts_lessee_id_fkey" FOREIGN KEY ("lessee_id") REFERENCES "lessees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_payments" ADD CONSTRAINT "lease_payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_vehicle_returns" ADD CONSTRAINT "lease_vehicle_returns_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "rental_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_claims" ADD CONSTRAINT "damage_claims_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_schedules" ADD CONSTRAINT "trip_schedules_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_logs" ADD CONSTRAINT "trip_logs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "trip_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
