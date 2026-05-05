-- customer_hierarchy
CREATE TABLE IF NOT EXISTS "customer_hierarchy" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT, "level" TEXT NOT NULL, "parent_id" TEXT, "name" TEXT NOT NULL,
    "code" TEXT, "description" TEXT, "is_active" BOOLEAN DEFAULT true,
    CONSTRAINT "customer_hierarchy_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "customer_hierarchy" DROP CONSTRAINT IF EXISTS "ch_parent_fk";
ALTER TABLE "customer_hierarchy" ADD CONSTRAINT "ch_parent_fk"
    FOREIGN KEY ("parent_id") REFERENCES "customer_hierarchy"("id") ON DELETE SET NULL;

-- customers
CREATE TABLE IF NOT EXISTS "customers" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "deleted_at" TIMESTAMPTZ(6), "tenant_id" TEXT,
    "customer_code" TEXT, "customer_type" TEXT NOT NULL,
    "priority" TEXT, "account_code" TEXT, "trade_license" TEXT,
    "mobile_number" TEXT, "mobile_country_code" TEXT DEFAULT '+971',
    "email" TEXT, "communication_language" TEXT DEFAULT 'en',
    "name_en" TEXT NOT NULL, "name_ar" TEXT,
    "description_en" TEXT, "description_ar" TEXT,
    "region_id" TEXT, "department_id" TEXT, "unit_id" TEXT,
    "contact_person" TEXT, "contact_person_phone" TEXT, "contact_person_email" TEXT,
    "address_line1" TEXT, "address_line2" TEXT, "city" TEXT, "state" TEXT,
    "country" TEXT DEFAULT 'UAE', "po_box" TEXT, "latitude" DECIMAL, "longitude" DECIMAL,
    "tax_registration_number" TEXT, "tax_applicable" BOOLEAN DEFAULT true,
    "toll_exempt" BOOLEAN DEFAULT false, "credit_limit" DECIMAL, "credit_days" INTEGER,
    "allowed_payment_methods" TEXT, "default_payment_method" TEXT,
    "billing_cycle" TEXT, "invoice_frequency" TEXT, "invoice_delivery_method" TEXT,
    "payment_reminder_days" INTEGER, "late_fee_percentage" DECIMAL, "auto_invoice" BOOLEAN DEFAULT false,
    "allowed_waiting_time_min" INTEGER, "cancellation_allowed_min" INTEGER,
    "allowed_booking_modifications" INTEGER, "skip_approval" BOOLEAN DEFAULT false,
    "preferred_channel" TEXT, "notification_email" TEXT,
    "notification_sms_code" TEXT DEFAULT '+971', "notification_sms" TEXT,
    "marketing_communications" BOOLEAN DEFAULT false, "booking_notifications" BOOLEAN DEFAULT true,
    "status" TEXT DEFAULT 'ACTIVE',
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "customers_code_key" ON "customers"("customer_code");
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "cust_region_fk";
ALTER TABLE "customers" ADD CONSTRAINT "cust_region_fk"
    FOREIGN KEY ("region_id") REFERENCES "customer_hierarchy"("id") ON DELETE SET NULL;
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "cust_dept_fk";
ALTER TABLE "customers" ADD CONSTRAINT "cust_dept_fk"
    FOREIGN KEY ("department_id") REFERENCES "customer_hierarchy"("id") ON DELETE SET NULL;
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "cust_unit_fk";
ALTER TABLE "customers" ADD CONSTRAINT "cust_unit_fk"
    FOREIGN KEY ("unit_id") REFERENCES "customer_hierarchy"("id") ON DELETE SET NULL;

-- customer_documents
CREATE TABLE IF NOT EXISTS "customer_documents" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT NOT NULL, "doc_name" TEXT NOT NULL, "doc_type" TEXT,
    "file_name" TEXT, "file_url" TEXT, "file_size" INTEGER, "mime_type" TEXT,
    "uploaded_by" TEXT, "notes" TEXT,
    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "customer_documents" DROP CONSTRAINT IF EXISTS "cd_customer_fk";
ALTER TABLE "customer_documents" ADD CONSTRAINT "cd_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
