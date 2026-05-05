-- CreateTable: lease_branches
CREATE TABLE IF NOT EXISTS "lease_branches" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'UAE',
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lease_branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_branches_code_key" ON "lease_branches"("code");

-- CreateTable: lease_inquiries
CREATE TABLE IF NOT EXISTS "lease_inquiries" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "inquiry_number" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "company_name" TEXT,
    "vehicle_type" TEXT,
    "vehicle_count" INTEGER DEFAULT 1,
    "lease_type" TEXT,
    "duration_months" INTEGER,
    "start_date" TIMESTAMPTZ(6),
    "requires_driver" BOOLEAN DEFAULT false,
    "requires_insurance" BOOLEAN DEFAULT false,
    "requires_maintenance" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "status" TEXT DEFAULT 'NEW',
    "assigned_to" TEXT,
    "branch_id" TEXT,

    CONSTRAINT "lease_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_inquiries_inquiry_number_key" ON "lease_inquiries"("inquiry_number");

-- CreateTable: lease_quotations
CREATE TABLE IF NOT EXISTS "lease_quotations" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "quotation_number" TEXT,
    "inquiry_id" TEXT,
    "lessee_id" TEXT,
    "lease_type" TEXT,
    "duration_months" INTEGER,
    "start_date" TIMESTAMPTZ(6),
    "end_date" TIMESTAMPTZ(6),
    "vehicle_type" TEXT,
    "vehicle_count" INTEGER DEFAULT 1,
    "base_monthly_rate" DECIMAL,
    "interest_rate" DECIMAL,
    "markup_pct" DECIMAL,
    "accessories_cost" DECIMAL,
    "services_cost" DECIMAL,
    "insurance_cost" DECIMAL,
    "maintenance_cost" DECIMAL,
    "driver_cost" DECIMAL,
    "total_monthly_rate" DECIMAL,
    "total_contract_value" DECIMAL,
    "security_deposit" DECIMAL,
    "mileage_cap" INTEGER,
    "currency" TEXT DEFAULT 'AED',
    "insurance_included" BOOLEAN DEFAULT false,
    "maintenance_included" BOOLEAN DEFAULT false,
    "driver_included" BOOLEAN DEFAULT false,
    "valid_until" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'NEW',
    "internal_approved_by" TEXT,
    "internal_approved_at" TIMESTAMPTZ(6),
    "customer_approved_at" TIMESTAMPTZ(6),
    "credit_approved_by" TEXT,
    "credit_approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "branch_id" TEXT,

    CONSTRAINT "lease_quotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_quotations_quotation_number_key" ON "lease_quotations"("quotation_number");

-- CreateTable: lease_quotation_items
CREATE TABLE IF NOT EXISTS "lease_quotation_items" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER DEFAULT 1,
    "unit_rate" DECIMAL,
    "monthly_amount" DECIMAL,
    "total_amount" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "notes" TEXT,

    CONSTRAINT "lease_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_quotation_vehicles
CREATE TABLE IF NOT EXISTS "lease_quotation_vehicles" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "vehicle_type" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "quantity" INTEGER DEFAULT 1,
    "vehicle_id" TEXT,
    "monthly_rate" DECIMAL,

    CONSTRAINT "lease_quotation_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_contracts_v2
CREATE TABLE IF NOT EXISTS "lease_contracts_v2" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "contract_number" TEXT,
    "agreement_type" TEXT,
    "master_contract_id" TEXT,
    "quotation_id" TEXT,
    "lessee_id" TEXT NOT NULL,
    "lease_type" TEXT,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "monthly_rate" DECIMAL NOT NULL,
    "total_contract_value" DECIMAL,
    "mileage_cap" INTEGER,
    "security_deposit" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "insurance_included" BOOLEAN DEFAULT false,
    "maintenance_included" BOOLEAN DEFAULT false,
    "driver_included" BOOLEAN DEFAULT false,
    "opening_branch_id" TEXT,
    "closing_branch_id" TEXT,
    "status" TEXT DEFAULT 'DRAFT',
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "lease_contracts_v2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_contracts_v2_contract_number_key" ON "lease_contracts_v2"("contract_number");

-- CreateTable: lease_contract_vehicles
CREATE TABLE IF NOT EXISTS "lease_contract_vehicles" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "vehicle_type" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "license_plate" TEXT,
    "vin" TEXT,
    "driver_id" TEXT,
    "monthly_rate" DECIMAL,
    "mileage_start" INTEGER,
    "status" TEXT DEFAULT 'ACTIVE',

    CONSTRAINT "lease_contract_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_payments_v2
CREATE TABLE IF NOT EXISTS "lease_payments_v2" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL,
    "period_month" INTEGER,
    "period_year" INTEGER,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL NOT NULL,
    "vat_amount" DECIMAL,
    "total_amount" DECIMAL,
    "currency" TEXT DEFAULT 'AED',
    "paid_date" TIMESTAMPTZ(6),
    "receipt_id" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "lease_payments_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_receipts
CREATE TABLE IF NOT EXISTS "lease_receipts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "receipt_number" TEXT,
    "contract_id" TEXT NOT NULL,
    "payment_type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED',
    "received_date" TIMESTAMPTZ(6) NOT NULL,
    "payment_method" TEXT,
    "cheque_no" TEXT,
    "bank_ref" TEXT,
    "received_by" TEXT,
    "branch_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "lease_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_receipts_receipt_number_key" ON "lease_receipts"("receipt_number");

-- CreateTable: lease_vehicle_exchanges
CREATE TABLE IF NOT EXISTS "lease_vehicle_exchanges" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL,
    "outgoing_vehicle_id" TEXT,
    "incoming_vehicle_id" TEXT,
    "exchange_date" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "approved_by" TEXT,
    "outgoing_mileage" INTEGER,
    "incoming_mileage" INTEGER,
    "notes" TEXT,

    CONSTRAINT "lease_vehicle_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_alerts
CREATE TABLE IF NOT EXISTS "lease_alerts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "contract_id" TEXT,
    "quotation_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT DEFAULT 'OPEN',
    "acknowledged_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "lease_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lease_approval_steps
CREATE TABLE IF NOT EXISTS "lease_approval_steps" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_role" TEXT,
    "approver_name" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    "action_at" TIMESTAMPTZ(6),
    "comments" TEXT,

    CONSTRAINT "lease_approval_steps_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey constraints
ALTER TABLE "lease_quotations" ADD CONSTRAINT "lease_quotations_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "lease_inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lease_quotation_items" ADD CONSTRAINT "lease_quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "lease_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_quotation_vehicles" ADD CONSTRAINT "lease_quotation_vehicles_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "lease_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_contracts_v2" ADD CONSTRAINT "lease_contracts_v2_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "lease_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lease_contract_vehicles" ADD CONSTRAINT "lease_contract_vehicles_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_payments_v2" ADD CONSTRAINT "lease_payments_v2_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_receipts" ADD CONSTRAINT "lease_receipts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_vehicle_exchanges" ADD CONSTRAINT "lease_vehicle_exchanges_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lease_alerts" ADD CONSTRAINT "lease_alerts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
