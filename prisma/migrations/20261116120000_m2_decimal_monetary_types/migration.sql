-- Safe migration with explicit numeric casts for Decimal Monetary Types & Platform Billing Isolation

-- 1. PartUsage: unit_cost, total_cost
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'PartUsage') THEN
    ALTER TABLE "public"."PartUsage"
      ALTER COLUMN "unitCost" TYPE NUMERIC(15, 2) USING "unitCost"::numeric(15, 2),
      ALTER COLUMN "totalCost" TYPE NUMERIC(15, 2) USING "totalCost"::numeric(15, 2);
  END IF;
END $$;

-- 2. FuelLog: cost_per_liter, total_cost
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fuel_logs') THEN
    ALTER TABLE "public"."fuel_logs"
      ALTER COLUMN "cost_per_liter" TYPE NUMERIC(15, 4) USING "cost_per_liter"::numeric(15, 4),
      ALTER COLUMN "total_cost" TYPE NUMERIC(15, 2) USING "total_cost"::numeric(15, 2);
  END IF;
END $$;

-- 3. FuelCard: monthly_limit, current_balance
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fuel_cards') THEN
    ALTER TABLE "public"."fuel_cards"
      ALTER COLUMN "monthly_limit" TYPE NUMERIC(15, 2) USING "monthly_limit"::numeric(15, 2),
      ALTER COLUMN "current_balance" TYPE NUMERIC(15, 2) USING "current_balance"::numeric(15, 2);
  END IF;
END $$;

-- 4. TrafficFine: fine_amount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TrafficFine') THEN
    ALTER TABLE "public"."TrafficFine"
      ALTER COLUMN "fineAmount" TYPE NUMERIC(15, 2) USING "fineAmount"::numeric(15, 2);
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'traffic_fines') THEN
    ALTER TABLE "public"."traffic_fines"
      ALTER COLUMN "fine_amount" TYPE NUMERIC(15, 2) USING "fine_amount"::numeric(15, 2);
  END IF;
END $$;

-- 5. SalikAccount: balance, recharge_amount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'salik_accounts') THEN
    ALTER TABLE "public"."salik_accounts"
      ALTER COLUMN "balance" TYPE NUMERIC(15, 2) USING "balance"::numeric(15, 2),
      ALTER COLUMN "recharge_amount" TYPE NUMERIC(15, 2) USING "recharge_amount"::numeric(15, 2);
  END IF;
END $$;

-- 6. Dedicated Platform Subscription Invoices table (SaaS Billing Isolation)
CREATE TABLE IF NOT EXISTS "public"."platform_subscription_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "tenant_id" TEXT NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "client_name" TEXT,
  "client_email" TEXT,
  "module_code" TEXT,
  "plan_tier" TEXT,
  "billing_cycle" TEXT,
  "issue_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "subtotal" DECIMAL(15, 2) NOT NULL,
  "vat_rate" DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
  "vat_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  "total_amount" DECIMAL(15, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AED',
  "payment_status" TEXT NOT NULL DEFAULT 'SENT',
  "paid_amount" DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  "notes" TEXT,
  "line_items_json" JSONB,

  CONSTRAINT "platform_subscription_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_subscription_invoices_invoice_number_key" ON "public"."platform_subscription_invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "idx_platform_subscription_invoices_tenant_id" ON "public"."platform_subscription_invoices"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_platform_subscription_invoices_status" ON "public"."platform_subscription_invoices"("payment_status");
