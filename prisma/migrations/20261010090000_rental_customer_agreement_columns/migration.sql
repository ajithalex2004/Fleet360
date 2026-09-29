-- Rental customer and agreement columns the Prisma models read but no
-- migration created. Any query that loads a customer (booking confirm,
-- activate, agreements) failed with P2022 where they were missing.
-- Idempotent: a no-op where the columns already exist. One statement per
-- line so the Neon SQL Editor runs it as written.

ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "company_name" TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "credit_used" DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "customer_type" TEXT DEFAULT 'INDIVIDUAL';
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "frequent_flyer_no" TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "loyalty_points" INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "payment_terms_days" INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "total_rentals" INTEGER DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "total_spend" DECIMAL DEFAULT 0;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "trade_license" TEXT;
ALTER TABLE IF EXISTS public.rental_customers ADD COLUMN IF NOT EXISTS "vat_number" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "authorization_code" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "close_branch_id" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "corporate_account_id" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "credit_card_last4" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "credit_card_token" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'AED';
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "insurance_daily_rate" DECIMAL;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "insurance_plan_code" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "is_corporate" BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "language" TEXT DEFAULT 'en';
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "open_branch_id" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "rate_quote_id" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "remarks" TEXT;
ALTER TABLE IF EXISTS public.rental_agreements ADD COLUMN IF NOT EXISTS "source_type" TEXT DEFAULT 'BOOKING';
