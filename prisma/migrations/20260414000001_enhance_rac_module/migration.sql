-- Add weekly_rate and monthly_rate to pricing_rules
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "weekly_rate" DECIMAL;
ALTER TABLE "pricing_rules" ADD COLUMN IF NOT EXISTS "monthly_rate" DECIMAL;

-- Add agreement relation to rental_bookings (already handled via rental_agreements FK)

-- CreateTable: rental_agreements
CREATE TABLE IF NOT EXISTS "rental_agreements" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "agreement_no" TEXT,
    "booking_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "daily_rate" DECIMAL,
    "total_amount" DECIMAL,
    "security_deposit" DECIMAL,
    "deposit_status" TEXT DEFAULT 'PENDING',
    "mileage_in" INTEGER,
    "mileage_out" INTEGER,
    "fuel_in" INTEGER,
    "fuel_out" INTEGER,
    "terms" TEXT,
    "status" TEXT DEFAULT 'DRAFT',
    "signed_at" TIMESTAMPTZ(6),
    "signed_by" TEXT,

    CONSTRAINT "rental_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rental_agreements_agreement_no_key" ON "rental_agreements"("agreement_no");
CREATE UNIQUE INDEX IF NOT EXISTS "rental_agreements_booking_id_key" ON "rental_agreements"("booking_id");

-- CreateTable: rental_extensions
CREATE TABLE IF NOT EXISTS "rental_extensions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "agreement_id" TEXT NOT NULL,
    "original_end_date" TIMESTAMPTZ(6) NOT NULL,
    "new_end_date" TIMESTAMPTZ(6) NOT NULL,
    "extra_days" INTEGER NOT NULL,
    "extra_amount" DECIMAL,
    "reason" TEXT,
    "approved_by" TEXT,
    "status" TEXT DEFAULT 'PENDING',

    CONSTRAINT "rental_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: rental_payments
CREATE TABLE IF NOT EXISTS "rental_payments" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "agreement_id" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT DEFAULT 'AED',
    "payment_method" TEXT,
    "reference_no" TEXT,
    "payment_type" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "received_by" TEXT,
    "notes" TEXT,

    CONSTRAINT "rental_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: rental_additional_charges
CREATE TABLE IF NOT EXISTS "rental_additional_charges" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "agreement_id" TEXT NOT NULL,
    "charge_type" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL NOT NULL,
    "quantity" INTEGER DEFAULT 1,
    "total_amount" DECIMAL,
    "billed_to_customer" BOOLEAN DEFAULT true,

    CONSTRAINT "rental_additional_charges_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: rental_agreements -> rental_bookings
ALTER TABLE "rental_agreements" DROP CONSTRAINT IF EXISTS "rental_agreements_booking_id_fkey";
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "rental_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: rental_extensions -> rental_agreements
ALTER TABLE "rental_extensions" DROP CONSTRAINT IF EXISTS "rental_extensions_agreement_id_fkey";
ALTER TABLE "rental_extensions" ADD CONSTRAINT "rental_extensions_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "rental_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: rental_payments -> rental_agreements
ALTER TABLE "rental_payments" DROP CONSTRAINT IF EXISTS "rental_payments_agreement_id_fkey";
ALTER TABLE "rental_payments" ADD CONSTRAINT "rental_payments_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "rental_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: rental_additional_charges -> rental_agreements
ALTER TABLE "rental_additional_charges" DROP CONSTRAINT IF EXISTS "rental_additional_charges_agreement_id_fkey";
ALTER TABLE "rental_additional_charges" ADD CONSTRAINT "rental_additional_charges_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "rental_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
