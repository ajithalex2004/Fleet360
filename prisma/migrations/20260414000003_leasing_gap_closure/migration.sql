-- Leasing Gap Closure Migration

-- lease_insurance_policies
CREATE TABLE IF NOT EXISTS "lease_insurance_policies" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "deleted_at" TIMESTAMPTZ(6), "policy_no" TEXT,
    "contract_id" TEXT, "lessee_id" TEXT, "vehicle_id" TEXT,
    "insurer" TEXT NOT NULL, "coverage_type" TEXT NOT NULL, "premium" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED', "start_date" TIMESTAMPTZ(6) NOT NULL,
    "expiry_date" TIMESTAMPTZ(6) NOT NULL, "renewal_reminder_days" INTEGER DEFAULT 30,
    "status" TEXT DEFAULT 'ACTIVE', "deductible" DECIMAL, "notes" TEXT,
    CONSTRAINT "lease_insurance_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_insurance_policies_policy_no_key" ON "lease_insurance_policies"("policy_no");
ALTER TABLE "lease_insurance_policies" DROP CONSTRAINT IF EXISTS "lip_contract_fk";
ALTER TABLE "lease_insurance_policies" ADD CONSTRAINT "lip_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- lease_insurance_claims
CREATE TABLE IF NOT EXISTS "lease_insurance_claims" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "claim_no" TEXT, "policy_id" TEXT NOT NULL,
    "contract_id" TEXT, "claim_date" TIMESTAMPTZ(6) NOT NULL, "incident_date" TIMESTAMPTZ(6),
    "claim_type" TEXT NOT NULL, "description" TEXT, "claim_amount" DECIMAL,
    "approved_amount" DECIMAL, "deductible" DECIMAL, "status" TEXT DEFAULT 'SUBMITTED',
    "settled_at" TIMESTAMPTZ(6), "notes" TEXT,
    CONSTRAINT "lease_insurance_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_insurance_claims_claim_no_key" ON "lease_insurance_claims"("claim_no");
ALTER TABLE "lease_insurance_claims" DROP CONSTRAINT IF EXISTS "lic_policy_fk";
ALTER TABLE "lease_insurance_claims" ADD CONSTRAINT "lic_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "lease_insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_mileage_readings
CREATE TABLE IF NOT EXISTS "lease_mileage_readings" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL, "contract_vehicle_id" TEXT, "vehicle_id" TEXT,
    "reading_date" TIMESTAMPTZ(6) NOT NULL, "mileage" INTEGER NOT NULL,
    "reading_type" TEXT NOT NULL, "captured_by" TEXT, "source" TEXT DEFAULT 'MANUAL', "notes" TEXT,
    CONSTRAINT "lease_mileage_readings_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_mileage_readings" DROP CONSTRAINT IF EXISTS "lmr_contract_fk";
ALTER TABLE "lease_mileage_readings" ADD CONSTRAINT "lmr_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_mileage_overages
CREATE TABLE IF NOT EXISTS "lease_mileage_overages" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL, "vehicle_id" TEXT,
    "period_from" TIMESTAMPTZ(6) NOT NULL, "period_to" TIMESTAMPTZ(6) NOT NULL,
    "allowed_km" INTEGER NOT NULL, "actual_km" INTEGER NOT NULL, "overage_km" INTEGER NOT NULL,
    "rate_per_km" DECIMAL NOT NULL, "overage_amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED', "invoiced" BOOLEAN DEFAULT false, "invoice_ref" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    CONSTRAINT "lease_mileage_overages_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_mileage_overages" DROP CONSTRAINT IF EXISTS "lmo_contract_fk";
ALTER TABLE "lease_mileage_overages" ADD CONSTRAINT "lmo_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_traffic_fines
CREATE TABLE IF NOT EXISTS "lease_traffic_fines" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "fine_no" TEXT, "contract_id" TEXT, "vehicle_id" TEXT,
    "driver_id" TEXT, "lessee_id" TEXT, "violation_date" TIMESTAMPTZ(6) NOT NULL,
    "violation_type" TEXT NOT NULL, "authority" TEXT, "location" TEXT,
    "fine_amount" DECIMAL NOT NULL, "discount_amount" DECIMAL, "final_amount" DECIMAL,
    "currency" TEXT DEFAULT 'AED', "due_date" TIMESTAMPTZ(6), "billed_to_lessee" BOOLEAN DEFAULT true,
    "billing_status" TEXT DEFAULT 'PENDING', "paid_date" TIMESTAMPTZ(6), "payment_ref" TEXT, "notes" TEXT,
    CONSTRAINT "lease_traffic_fines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_traffic_fines_fine_no_key" ON "lease_traffic_fines"("fine_no");
ALTER TABLE "lease_traffic_fines" DROP CONSTRAINT IF EXISTS "ltf_contract_fk";
ALTER TABLE "lease_traffic_fines" ADD CONSTRAINT "ltf_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- lease_fuel_logs
CREATE TABLE IF NOT EXISTS "lease_fuel_logs" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL, "vehicle_id" TEXT, "driver_id" TEXT,
    "fuel_date" TIMESTAMPTZ(6) NOT NULL, "liters" DECIMAL NOT NULL,
    "cost_per_liter" DECIMAL, "total_cost" DECIMAL, "currency" TEXT DEFAULT 'AED',
    "station" TEXT, "mileage_at_fuel" INTEGER, "fuel_card_no" TEXT,
    "billed_to_lessee" BOOLEAN DEFAULT true, "billing_status" TEXT DEFAULT 'PENDING',
    "receipt_ref" TEXT, "notes" TEXT,
    CONSTRAINT "lease_fuel_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_fuel_logs" DROP CONSTRAINT IF EXISTS "lfl_contract_fk";
ALTER TABLE "lease_fuel_logs" ADD CONSTRAINT "lfl_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_documents
CREATE TABLE IF NOT EXISTS "lease_documents" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "entity_type" TEXT NOT NULL, "entity_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL, "doc_name" TEXT NOT NULL, "file_name" TEXT,
    "file_url" TEXT, "file_size" INTEGER, "mime_type" TEXT,
    "issue_date" TIMESTAMPTZ(6), "expiry_date" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'ACTIVE', "uploaded_by" TEXT, "notes" TEXT,
    CONSTRAINT "lease_documents_pkey" PRIMARY KEY ("id")
);

-- lease_early_terminations
CREATE TABLE IF NOT EXISTS "lease_early_terminations" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "termination_no" TEXT, "contract_id" TEXT NOT NULL,
    "requested_by" TEXT, "request_date" TIMESTAMPTZ(6) NOT NULL,
    "effective_date" TIMESTAMPTZ(6) NOT NULL, "reason" TEXT,
    "remaining_months" INTEGER NOT NULL, "monthly_rate" DECIMAL NOT NULL,
    "penalty_pct" DECIMAL, "penalty_amount" DECIMAL, "outstanding_payments" DECIMAL,
    "deposit_refund" DECIMAL, "total_settlement" DECIMAL, "currency" TEXT DEFAULT 'AED',
    "status" TEXT DEFAULT 'DRAFT', "approved_by" TEXT, "approved_at" TIMESTAMPTZ(6), "notes" TEXT,
    CONSTRAINT "lease_early_terminations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_early_terminations_no_key" ON "lease_early_terminations"("termination_no");
ALTER TABLE "lease_early_terminations" DROP CONSTRAINT IF EXISTS "let_contract_fk";
ALTER TABLE "lease_early_terminations" ADD CONSTRAINT "let_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_renewals
CREATE TABLE IF NOT EXISTS "lease_renewals" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "renewal_no" TEXT, "original_contract_id" TEXT NOT NULL,
    "new_contract_id" TEXT, "new_quotation_id" TEXT, "renewal_type" TEXT,
    "proposed_start_date" TIMESTAMPTZ(6) NOT NULL, "proposed_end_date" TIMESTAMPTZ(6) NOT NULL,
    "proposed_monthly_rate" DECIMAL, "status" TEXT DEFAULT 'PROPOSED',
    "customer_response_at" TIMESTAMPTZ(6), "initiated_by" TEXT, "notes" TEXT,
    CONSTRAINT "lease_renewals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_renewals_no_key" ON "lease_renewals"("renewal_no");
ALTER TABLE "lease_renewals" DROP CONSTRAINT IF EXISTS "lr_orig_contract_fk";
ALTER TABLE "lease_renewals" ADD CONSTRAINT "lr_orig_contract_fk" FOREIGN KEY ("original_contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_pre_billing_statements
CREATE TABLE IF NOT EXISTS "lease_pre_billing_statements" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "statement_no" TEXT, "contract_id" TEXT NOT NULL, "lessee_id" TEXT NOT NULL,
    "billing_period" TEXT NOT NULL, "due_date" TIMESTAMPTZ(6) NOT NULL,
    "base_rent" DECIMAL NOT NULL, "fuel_charges" DECIMAL DEFAULT 0,
    "fine_charges" DECIMAL DEFAULT 0, "maintenance_charges" DECIMAL DEFAULT 0,
    "overage_charges" DECIMAL DEFAULT 0, "other_charges" DECIMAL DEFAULT 0,
    "vat_amount" DECIMAL DEFAULT 0, "total_amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED', "status" TEXT DEFAULT 'DRAFT',
    "sent_at" TIMESTAMPTZ(6), "confirmed_at" TIMESTAMPTZ(6), "dispute_notes" TEXT,
    CONSTRAINT "lease_pre_billing_statements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_pbs_no_key" ON "lease_pre_billing_statements"("statement_no");
ALTER TABLE "lease_pre_billing_statements" DROP CONSTRAINT IF EXISTS "lpbs_contract_fk";
ALTER TABLE "lease_pre_billing_statements" ADD CONSTRAINT "lpbs_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_dunning_activities
CREATE TABLE IF NOT EXISTS "lease_dunning_activities" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT NOT NULL, "lessee_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL, "days_overdue" INTEGER NOT NULL,
    "outstanding_amount" DECIMAL NOT NULL, "currency" TEXT DEFAULT 'AED',
    "performed_by" TEXT, "response" TEXT, "next_action_date" TIMESTAMPTZ(6),
    "next_action_type" TEXT, "notes" TEXT,
    CONSTRAINT "lease_dunning_activities_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_dunning_activities" DROP CONSTRAINT IF EXISTS "lda_contract_fk";
ALTER TABLE "lease_dunning_activities" ADD CONSTRAINT "lda_contract_fk" FOREIGN KEY ("contract_id") REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_credit_assessments
CREATE TABLE IF NOT EXISTS "lease_credit_assessments" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "lessee_id" TEXT NOT NULL,
    "assessment_date" TIMESTAMPTZ(6) NOT NULL, "credit_limit" DECIMAL,
    "credit_score" INTEGER, "risk_rating" TEXT, "annual_revenue" DECIMAL,
    "years_in_business" INTEGER, "payment_history" TEXT, "current_exposure" DECIMAL,
    "recommended_limit" DECIMAL, "assessed_by" TEXT, "valid_until" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'ACTIVE', "notes" TEXT,
    CONSTRAINT "lease_credit_assessments_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_credit_assessments" DROP CONSTRAINT IF EXISTS "lca_lessee_fk";
ALTER TABLE "lease_credit_assessments" ADD CONSTRAINT "lca_lessee_fk" FOREIGN KEY ("lessee_id") REFERENCES "lessees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_invoices
CREATE TABLE IF NOT EXISTS "lease_invoices" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "invoice_no" TEXT, "lessee_id" TEXT NOT NULL,
    "billing_period" TEXT, "issue_date" TIMESTAMPTZ(6) NOT NULL,
    "due_date" TIMESTAMPTZ(6) NOT NULL, "sub_total" DECIMAL NOT NULL,
    "vat_pct" DECIMAL DEFAULT 5, "vat_amount" DECIMAL, "total_amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED', "status" TEXT DEFAULT 'DRAFT',
    "sent_at" TIMESTAMPTZ(6), "paid_at" TIMESTAMPTZ(6), "payment_ref" TEXT, "notes" TEXT,
    CONSTRAINT "lease_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_invoices_no_key" ON "lease_invoices"("invoice_no");
ALTER TABLE "lease_invoices" DROP CONSTRAINT IF EXISTS "li_lessee_fk";
ALTER TABLE "lease_invoices" ADD CONSTRAINT "li_lessee_fk" FOREIGN KEY ("lessee_id") REFERENCES "lessees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_invoice_lines
CREATE TABLE IF NOT EXISTS "lease_invoice_lines" (
    "id" TEXT NOT NULL, "invoice_id" TEXT NOT NULL, "contract_id" TEXT, "vehicle_ref" TEXT,
    "description" TEXT NOT NULL, "line_type" TEXT NOT NULL, "quantity" INTEGER DEFAULT 1,
    "unit_amount" DECIMAL NOT NULL, "total_amount" DECIMAL NOT NULL, "currency" TEXT DEFAULT 'AED',
    CONSTRAINT "lease_invoice_lines_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "lease_invoice_lines" DROP CONSTRAINT IF EXISTS "lil_invoice_fk";
ALTER TABLE "lease_invoice_lines" ADD CONSTRAINT "lil_invoice_fk" FOREIGN KEY ("invoice_id") REFERENCES "lease_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- lease_direct_debits
CREATE TABLE IF NOT EXISTS "lease_direct_debits" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "lessee_id" TEXT NOT NULL, "contract_id" TEXT,
    "bank_name" TEXT NOT NULL, "account_name" TEXT NOT NULL, "iban" TEXT NOT NULL,
    "mandate_ref" TEXT, "collection_day" INTEGER NOT NULL, "currency" TEXT DEFAULT 'AED',
    "status" TEXT DEFAULT 'PENDING', "activated_at" TIMESTAMPTZ(6), "notes" TEXT,
    CONSTRAINT "lease_direct_debits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_direct_debits_mandate_key" ON "lease_direct_debits"("mandate_ref");
ALTER TABLE "lease_direct_debits" DROP CONSTRAINT IF EXISTS "ldd_lessee_fk";
ALTER TABLE "lease_direct_debits" ADD CONSTRAINT "ldd_lessee_fk" FOREIGN KEY ("lessee_id") REFERENCES "lessees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lease_remarketing
CREATE TABLE IF NOT EXISTS "lease_remarketing" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "remarketing_no" TEXT, "contract_id" TEXT,
    "vehicle_id" TEXT, "make" TEXT, "model" TEXT, "year" INTEGER, "plate_no" TEXT,
    "return_date" TIMESTAMPTZ(6), "return_mileage" INTEGER, "condition" TEXT,
    "book_value" DECIMAL, "residual_value" DECIMAL, "asking_price" DECIMAL,
    "sale_price" DECIMAL, "buyer_name" TEXT, "buyer_type" TEXT, "sale_date" TIMESTAMPTZ(6),
    "sale_profit" DECIMAL, "currency" TEXT DEFAULT 'AED', "stage" TEXT DEFAULT 'AVAILABLE', "notes" TEXT,
    CONSTRAINT "lease_remarketing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "lease_remarketing_no_key" ON "lease_remarketing"("remarketing_no");

-- lease_telematics
CREATE TABLE IF NOT EXISTS "lease_telematics" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "contract_id" TEXT, "vehicle_id" TEXT NOT NULL, "provider" TEXT, "device_id" TEXT,
    "last_odometer" INTEGER, "last_update_at" TIMESTAMPTZ(6),
    "last_lat" FLOAT, "last_lng" FLOAT, "status" TEXT DEFAULT 'ACTIVE',
    CONSTRAINT "lease_telematics_pkey" PRIMARY KEY ("id")
);
