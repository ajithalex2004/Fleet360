import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  const results: string[] = [];
  const run = async (label: string, sql: string) => {
    try { await prisma.$executeRawUnsafe(sql); results.push('OK: ' + label); }
    catch (e: any) { results.push('SKIP: ' + label + ' — ' + e.message?.slice(0, 100)); }
  };

  // pricing_rules enhancements
  await run('pricing_rules.name',               "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS name TEXT");
  await run('pricing_rules.updated_at',         "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()");
  await run('pricing_rules.base_hourly_rate',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS base_hourly_rate DECIMAL");
  await run('pricing_rules.weekend_daily_rate', "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS weekend_daily_rate DECIMAL");
  await run('pricing_rules.exchange_rate',      "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS exchange_rate_to_aed DECIMAL DEFAULT 1");
  await run('pricing_rules.customer_type',      "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS customer_type TEXT");
  await run('pricing_rules.corporate_acct',     "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS corporate_account_id TEXT");
  await run('pricing_rules.airline_code',       "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS airline_code TEXT");
  await run('pricing_rules.frequent_flyer',     "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS frequent_flyer_prog TEXT");
  await run('pricing_rules.credit_card_type',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS credit_card_type TEXT");
  await run('pricing_rules.pickup_location',    "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS pickup_location_code TEXT");
  await run('pricing_rules.dropoff_location',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS dropoff_location_code TEXT");
  await run('pricing_rules.is_airport_rate',    "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS is_airport_rate BOOLEAN DEFAULT false");
  await run('pricing_rules.is_domestic',        "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS is_domestic BOOLEAN DEFAULT true");
  await run('pricing_rules.channel',            "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS channel TEXT");
  await run('pricing_rules.online_discount',    "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS online_discount DECIMAL DEFAULT 0");
  await run('pricing_rules.grace_period_min',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS grace_period_min INT DEFAULT 30");
  await run('pricing_rules.late_fee_per_hour',  "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS late_fee_per_hour DECIMAL");
  await run('pricing_rules.late_fee_cap',       "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS late_fee_cap DECIMAL");
  await run('pricing_rules.min_rental_days',    "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS min_rental_days INT DEFAULT 1");
  await run('pricing_rules.min_rental_hours',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS min_rental_hours INT DEFAULT 0");
  await run('pricing_rules.insurance_plans',    "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS insurance_plans TEXT");
  await run('pricing_rules.promo_code',         "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_code TEXT");
  await run('pricing_rules.promo_discount_pct', "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_discount_pct DECIMAL");
  await run('pricing_rules.promo_valid_from',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_valid_from TIMESTAMPTZ");
  await run('pricing_rules.promo_valid_to',     "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_valid_to TIMESTAMPTZ");
  await run('pricing_rules.promo_max_uses',     "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_max_uses INT");
  await run('pricing_rules.promo_used_count',   "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS promo_used_count INT DEFAULT 0");
  await run('pricing_rules.included_km',        "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS included_km_per_day INT");
  await run('pricing_rules.excess_km_rate',     "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS excess_km_rate DECIMAL");
  await run('pricing_rules.priority',           "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS priority INT DEFAULT 0");
  await run('pricing_rules.notes',              "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS notes TEXT");
  await run('idx_pricing_rules_customer_type',  "CREATE INDEX IF NOT EXISTS idx_pricing_rules_customer_type ON pricing_rules(customer_type)");
  await run('idx_pricing_rules_channel',        "CREATE INDEX IF NOT EXISTS idx_pricing_rules_channel ON pricing_rules(channel)");
  await run('idx_pricing_rules_promo_code',     "CREATE INDEX IF NOT EXISTS idx_pricing_rules_promo_code ON pricing_rules(promo_code)");
  await run('idx_pricing_rules_is_active',      "CREATE INDEX IF NOT EXISTS idx_pricing_rules_is_active ON pricing_rules(is_active)");

  // rental_rate_quotes (new table)
  await run('create rental_rate_quotes', `CREATE TABLE IF NOT EXISTS rental_rate_quotes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    booking_id TEXT,
    vehicle_category TEXT NOT NULL,
    pickup_date TIMESTAMPTZ NOT NULL,
    dropoff_date TIMESTAMPTZ NOT NULL,
    total_days INT NOT NULL,
    total_hours INT,
    applied_rule_id TEXT,
    currency TEXT DEFAULT 'AED',
    base_rental_charge DECIMAL NOT NULL,
    insurance_plan_code TEXT,
    insurance_charge DECIMAL DEFAULT 0,
    extras TEXT,
    discount_pct DECIMAL DEFAULT 0,
    discount_amount DECIMAL DEFAULT 0,
    tax_pct DECIMAL DEFAULT 5,
    tax_amount DECIMAL DEFAULT 0,
    total_amount DECIMAL NOT NULL,
    breakdown TEXT,
    expires_at TIMESTAMPTZ
  )`);
  await run('idx_rate_quotes_booking', "CREATE INDEX IF NOT EXISTS idx_rental_rate_quotes_booking_id ON rental_rate_quotes(booking_id)");

  // rental_agreements enhancements
  await run('agreements.currency',         "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'AED'");
  await run('agreements.open_branch_id',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS open_branch_id TEXT");
  await run('agreements.close_branch_id',  "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS close_branch_id TEXT");
  await run('agreements.source_type',      "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'BOOKING'");
  await run('agreements.rate_quote_id',    "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS rate_quote_id TEXT");
  await run('agreements.insurance_plan',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS insurance_plan_code TEXT");
  await run('agreements.insurance_rate',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS insurance_daily_rate DECIMAL");
  await run('agreements.is_corporate',     "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS is_corporate BOOLEAN DEFAULT false");
  await run('agreements.corporate_acct',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS corporate_account_id TEXT");
  await run('agreements.auth_code',        "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS authorization_code TEXT");
  await run('agreements.cc_last4',         "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS credit_card_last4 TEXT");
  await run('agreements.cc_token',         "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS credit_card_token TEXT");
  await run('agreements.remarks',          "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS remarks TEXT");
  await run('agreements.language',         "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'");
  await run('idx_agreements_open_branch',  "CREATE INDEX IF NOT EXISTS idx_rental_agreements_open_branch_id ON rental_agreements(open_branch_id)");

  // rental_vehicle_exchanges (new table)
  await run('create rental_vehicle_exchanges', `CREATE TABLE IF NOT EXISTS rental_vehicle_exchanges (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    agreement_id TEXT NOT NULL REFERENCES rental_agreements(id),
    from_vehicle_id TEXT NOT NULL,
    to_vehicle_id TEXT NOT NULL,
    exchange_date TIMESTAMPTZ NOT NULL,
    reason TEXT,
    mileage_at_exchange INT,
    fuel_at_exchange INT,
    rate_difference DECIMAL,
    authorized_by TEXT,
    notes TEXT
  )`);
  await run('idx_vehicle_exchanges', "CREATE INDEX IF NOT EXISTS idx_rental_vehicle_exchanges_agreement_id ON rental_vehicle_exchanges(agreement_id)");

  // rental_customers enhancements
  await run('customers.customer_type',      "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'INDIVIDUAL'");
  await run('customers.address',            "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS address TEXT");
  await run('customers.company_name',       "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS company_name TEXT");
  await run('customers.trade_license',      "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS trade_license TEXT");
  await run('customers.vat_number',         "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS vat_number TEXT");
  await run('customers.credit_limit',       "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS credit_limit DECIMAL");
  await run('customers.credit_used',        "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS credit_used DECIMAL DEFAULT 0");
  await run('customers.payment_terms_days', "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS payment_terms_days INT DEFAULT 0");
  await run('customers.frequent_flyer_no',  "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS frequent_flyer_no TEXT");
  await run('customers.loyalty_points',     "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0");
  await run('customers.total_rentals',      "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS total_rentals INT DEFAULT 0");
  await run('customers.total_spend',        "ALTER TABLE rental_customers ADD COLUMN IF NOT EXISTS total_spend DECIMAL DEFAULT 0");
  await run('idx_customers_type',           "CREATE INDEX IF NOT EXISTS idx_rental_customers_customer_type ON rental_customers(customer_type)");

  // rental_invoices (new table)
  await run('create rental_invoices', `CREATE TABLE IF NOT EXISTS rental_invoices (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    invoice_no TEXT UNIQUE NOT NULL,
    agreement_id TEXT NOT NULL REFERENCES rental_agreements(id),
    customer_id TEXT NOT NULL,
    invoice_type TEXT DEFAULT 'STANDARD',
    invoice_date TIMESTAMPTZ NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    period_from TIMESTAMPTZ,
    period_to TIMESTAMPTZ,
    currency TEXT DEFAULT 'AED',
    subtotal DECIMAL NOT NULL DEFAULT 0,
    discount_amount DECIMAL DEFAULT 0,
    taxable_amount DECIMAL DEFAULT 0,
    tax_rate DECIMAL DEFAULT 5,
    tax_amount DECIMAL DEFAULT 0,
    total_amount DECIMAL NOT NULL DEFAULT 0,
    paid_amount DECIMAL DEFAULT 0,
    balance_due DECIMAL DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    is_corporate BOOLEAN DEFAULT false,
    corporate_account_id TEXT,
    billing_mode TEXT DEFAULT 'SEPARATE',
    payment_terms_days INT DEFAULT 30,
    sent_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    voided_at TIMESTAMPTZ,
    void_reason TEXT,
    parent_invoice_id TEXT,
    notes TEXT,
    internal_notes TEXT
  )`);
  await run('idx_invoices_agreement',  "CREATE INDEX IF NOT EXISTS idx_rental_invoices_agreement_id ON rental_invoices(agreement_id)");
  await run('idx_invoices_customer',   "CREATE INDEX IF NOT EXISTS idx_rental_invoices_customer_id ON rental_invoices(customer_id)");
  await run('idx_invoices_status',     "CREATE INDEX IF NOT EXISTS idx_rental_invoices_status ON rental_invoices(status)");
  await run('idx_invoices_due_date',   "CREATE INDEX IF NOT EXISTS idx_rental_invoices_due_date ON rental_invoices(due_date)");

  // rental_invoice_line_items (new table)
  await run('create rental_invoice_line_items', `CREATE TABLE IF NOT EXISTS rental_invoice_line_items (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    invoice_id TEXT NOT NULL REFERENCES rental_invoices(id) ON DELETE CASCADE,
    line_type TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity DECIMAL NOT NULL DEFAULT 1,
    unit_price DECIMAL NOT NULL DEFAULT 0,
    unit_label TEXT DEFAULT 'day',
    discount_pct DECIMAL DEFAULT 0,
    taxable BOOLEAN DEFAULT true,
    amount DECIMAL NOT NULL DEFAULT 0,
    sort_order INT DEFAULT 0,
    reference_id TEXT
  )`);
  await run('idx_line_items_invoice', "CREATE INDEX IF NOT EXISTS idx_rental_invoice_line_items_invoice_id ON rental_invoice_line_items(invoice_id)");

  // rental_invoice_payments (new table)
  await run('create rental_invoice_payments', `CREATE TABLE IF NOT EXISTS rental_invoice_payments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    invoice_id TEXT NOT NULL REFERENCES rental_invoices(id),
    receipt_no TEXT UNIQUE,
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    amount DECIMAL NOT NULL,
    currency TEXT DEFAULT 'AED',
    payment_method TEXT DEFAULT 'CASH',
    reference_no TEXT,
    notes TEXT,
    received_by TEXT
  )`);
  // In case table already existed with paid_at column name, add payment_date
  await run('inv_payments.payment_date', "ALTER TABLE rental_invoice_payments ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ DEFAULT NOW()");
  await run('idx_inv_payments_invoice',  "CREATE INDEX IF NOT EXISTS idx_rental_invoice_payments_invoice_id ON rental_invoice_payments(invoice_id)");

  // ── Additional rental_agreements columns for close/invoice workflow ────────
  await run('agreements.actual_return_date',  "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS actual_return_date TIMESTAMPTZ");
  await run('agreements.pickup_fuel_level',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS pickup_fuel_level INT");
  await run('agreements.return_fuel_level',   "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS return_fuel_level INT");
  await run('agreements.pickup_odometer',     "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS pickup_odometer INT");
  await run('agreements.return_odometer',     "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS return_odometer INT");
  await run('agreements.late_fee',            "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS late_fee DECIMAL DEFAULT 0");
  await run('agreements.excess_km_fee',       "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS excess_km_fee DECIMAL DEFAULT 0");
  await run('agreements.fuel_surcharge',      "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS fuel_surcharge DECIMAL DEFAULT 0");
  await run('agreements.closed_by',           "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS closed_by TEXT");
  await run('agreements.closing_notes',       "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS closing_notes TEXT");
  await run('agreements.pickup_location_code',"ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS pickup_location_code TEXT");
  await run('agreements.dropoff_location_code',"ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS dropoff_location_code TEXT");
  await run('agreements.customer_type',       "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'INDIVIDUAL'");
  await run('agreements.channel',             "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'DIRECT'");
  await run('agreements.promo_code',          "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS promo_code TEXT");
  await run('agreements.billing_mode',        "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'SEPARATE'");
  await run('agreements.additional_charges',  "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS additional_charges TEXT");
  await run('agreements.customer_name',       "ALTER TABLE rental_agreements ADD COLUMN IF NOT EXISTS customer_name TEXT");
  await run('idx_agreements_status',          "CREATE INDEX IF NOT EXISTS idx_rental_agreements_status ON rental_agreements(status)");
  await run('idx_agreements_vehicle',         "CREATE INDEX IF NOT EXISTS idx_rental_agreements_vehicle_id ON rental_agreements(vehicle_id)");

  const ok = results.filter(r => r.startsWith('OK')).length;
  const skip = results.filter(r => r.startsWith('SKIP')).length;
  return NextResponse.json({ ok, skip, results });
}
