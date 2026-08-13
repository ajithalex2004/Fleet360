-- =====================================================================
-- Migration: finance reference data seed
-- =====================================================================
-- Moves static reference data out of GET endpoint runtime init.
-- All CREATE TABLE statements use IF NOT EXISTS so this is safe to run
-- against environments where the tables already exist from the old
-- runtime-DDL path.  All INSERTs use ON CONFLICT DO NOTHING.
--
-- Tables + seed covered:
--   1. finance_tax_categories        — 4 UAE VAT categories
--   2. finance_vat_audit_logs        — DDL only (no seed rows)
--   3. finance_reminder_schedules    — 5 default payment-reminder schedules
--   4. finance_reminder_log          — DDL only
--   5. finance_chart_of_accounts     — transport-specific CoA (~87 accounts)
-- =====================================================================

-- ── 1. finance_tax_categories ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_tax_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  code        TEXT        UNIQUE NOT NULL,
  name        TEXT        NOT NULL,
  rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
  description TEXT,
  is_default  BOOLEAN     DEFAULT FALSE,
  is_active   BOOLEAN     DEFAULT TRUE,
  fta_code    TEXT
);

-- The ON CONFLICT clause below references (tenant_id, code) which
-- doesn't exist on the fresh CREATE TABLE above. Production picked
-- up tenant_id via a retired runtime-DDL path. Adding it defensively
-- with IF NOT EXISTS so shadow-DB replay in CI works and prod is a
-- no-op. Composite unique enables the ON CONFLICT.
ALTER TABLE finance_tax_categories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS finance_tax_categories_tenant_code_key
  ON finance_tax_categories (tenant_id, code);

INSERT INTO finance_tax_categories (code, name, rate, description, fta_code, is_default)
VALUES
  ('STANDARD',     'Standard Rate', 5.00, 'Standard UAE VAT at 5%',                                        '1a',  TRUE),
  ('ZERO',         'Zero-Rated',    0.00, 'Inter-emirate transport, exports, medicines',                   '1b',  FALSE),
  ('EXEMPT',       'Exempt',        0.00, 'Bare land, residential properties, local transport',            '1c',  FALSE),
  ('OUT_OF_SCOPE', 'Out of Scope',  0.00, 'Outside UAE VAT scope entirely',                                'OOS', FALSE)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── 2. finance_vat_audit_logs ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_vat_audit_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  action       TEXT        NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  performed_by TEXT,
  details      JSONB,
  ip_address   TEXT,
  notes        TEXT
);

-- ── 3. finance_reminder_schedules ───────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_reminder_schedules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  trigger_type     TEXT        NOT NULL DEFAULT 'AFTER_DUE',
  trigger_days     INTEGER     NOT NULL DEFAULT 7,
  channel          TEXT        NOT NULL DEFAULT 'EMAIL',
  template_subject TEXT        NOT NULL DEFAULT 'Payment Reminder',
  template_body    TEXT        NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  module_filter    TEXT,
  branch_filter    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add unique constraint on name so the INSERT below is idempotent.
-- Uses DO $$ … $$ to skip safely if the constraint already exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'finance_reminder_schedules_name_key'
       AND conrelid = 'finance_reminder_schedules'::regclass
  ) THEN
    ALTER TABLE finance_reminder_schedules
      ADD CONSTRAINT finance_reminder_schedules_name_key UNIQUE (name);
  END IF;
END $$;

INSERT INTO finance_reminder_schedules
  (name, trigger_type, trigger_days, channel, template_subject, template_body)
VALUES
  ('7-Day Pre-Due Reminder',
   'BEFORE_DUE', 7,  'EMAIL',
   'Payment Due in 7 Days — Invoice {invoice_no}',
   E'Dear {client_name},\n\nThis is a friendly reminder that invoice {invoice_no} for AED {amount} is due on {due_date}.\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\nFinance Team'),

  ('Due Date Reminder',
   'ON_DUE',     0,  'EMAIL',
   'Invoice {invoice_no} Due Today',
   E'Dear {client_name},\n\nInvoice {invoice_no} for AED {amount} is due today.\n\nPlease process payment to avoid any service interruption.\n\nRegards,\nFinance Team'),

  ('7-Day Overdue Notice',
   'AFTER_DUE',  7,  'EMAIL',
   'OVERDUE: Invoice {invoice_no} — 7 Days Past Due',
   E'Dear {client_name},\n\nInvoice {invoice_no} for AED {amount} is now 7 days overdue.\n\nPlease settle the outstanding balance immediately or contact us to discuss payment arrangements.\n\nRegards,\nFinance Team'),

  ('30-Day Final Notice',
   'AFTER_DUE',  30, 'EMAIL',
   'FINAL NOTICE: Invoice {invoice_no} — 30 Days Overdue',
   E'Dear {client_name},\n\nThis is a final notice for invoice {invoice_no} for AED {amount}, now 30 days overdue.\n\nFurther delay may result in service suspension and legal action.\n\nRegards,\nFinance Team'),

  ('WhatsApp 3-Day Nudge',
   'AFTER_DUE',  3,  'WHATSAPP',
   'Payment Overdue',
   E'Hi {client_name}, your invoice {invoice_no} for AED {amount} is overdue by 3 days. Please make payment to avoid disruption.')
ON CONFLICT (name) DO NOTHING;

-- ── 4. finance_reminder_log ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_reminder_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   UUID        REFERENCES finance_reminder_schedules(id) ON DELETE SET NULL,
  invoice_id    TEXT        NOT NULL,
  invoice_no    TEXT        NOT NULL,
  client_name   TEXT        NOT NULL,
  client_email  TEXT,
  channel       TEXT        NOT NULL,
  subject       TEXT,
  body          TEXT,
  status        TEXT        NOT NULL DEFAULT 'SENT',
  error_message TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. finance_chart_of_accounts ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS finance_chart_of_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  account_code    TEXT        UNIQUE NOT NULL,
  account_name    TEXT        NOT NULL,
  account_type    TEXT        NOT NULL,  -- ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
  account_subtype TEXT,                  -- CURRENT | FIXED | NON_CURRENT | REVENUE | COGS | OPEX | FINANCE | TAX | OTHER_INCOME
  parent_code     TEXT,                  -- references account_code of parent header
  description     TEXT,
  is_header       BOOLEAN     DEFAULT FALSE,
  is_active       BOOLEAN     DEFAULT TRUE,
  is_system       BOOLEAN     DEFAULT FALSE,
  normal_balance  TEXT        DEFAULT 'DEBIT',  -- DEBIT | CREDIT
  currency        TEXT        DEFAULT 'AED',
  sort_order      INTEGER     DEFAULT 0
);

-- Transport-specific CoA seed — ~87 accounts
-- Columns: account_code, account_name, account_type, account_subtype, parent_code,
--          description, is_header, is_active, is_system, normal_balance, sort_order
INSERT INTO finance_chart_of_accounts
  (account_code, account_name, account_type, account_subtype, parent_code,
   description, is_header, is_active, is_system, normal_balance, sort_order)
VALUES
  -- ASSETS
  ('1000', 'Assets',                                   'ASSET',     NULL,           NULL,   NULL,                                                                  TRUE,  TRUE, TRUE,  'DEBIT',  10),
  ('1100', 'Current Assets',                           'ASSET',     'CURRENT',      '1000', NULL,                                                                  TRUE,  TRUE, TRUE,  'DEBIT',  11),
  ('1110', 'Cash in Hand',                             'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  12),
  ('1111', 'Petty Cash — Operations',                  'ASSET',     'CURRENT',      '1110', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  13),
  ('1120', 'Cash at Bank',                             'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  14),
  ('1121', 'Emirates NBD — Operating',                 'ASSET',     'CURRENT',      '1120', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  15),
  ('1122', 'FAB — Payroll Account',                    'ASSET',     'CURRENT',      '1120', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  16),
  ('1130', 'Accounts Receivable',                      'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, TRUE,  'DEBIT',  17),
  ('1131', 'Trade Receivables — RAC',                  'ASSET',     'CURRENT',      '1130', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  18),
  ('1132', 'Trade Receivables — Leasing',              'ASSET',     'CURRENT',      '1130', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  19),
  ('1133', 'Trade Receivables — Logistics',            'ASSET',     'CURRENT',      '1130', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  20),
  ('1134', 'Trade Receivables — Staff Transport',      'ASSET',     'CURRENT',      '1130', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  21),
  ('1135', 'Trade Receivables — School Bus',           'ASSET',     'CURRENT',      '1130', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  22),
  ('1140', 'VAT Recoverable (Input VAT)',              'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, TRUE,  'DEBIT',  23),
  ('1150', 'Prepaid Expenses',                         'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  24),
  ('1151', 'Prepaid Insurance',                        'ASSET',     'CURRENT',      '1150', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  25),
  ('1160', 'PDC Receivable (Post-Dated Cheques Held)', 'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  26),
  ('1170', 'Fuel Inventory',                           'ASSET',     'CURRENT',      '1100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  27),
  ('1200', 'Fixed Assets',                             'ASSET',     'FIXED',        '1000', NULL,                                                                  TRUE,  TRUE, TRUE,  'DEBIT',  30),
  ('1210', 'Fleet — Passenger Vehicles',               'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  31),
  ('1211', 'Fleet — Light Commercial Vehicles',        'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  32),
  ('1212', 'Fleet — Heavy Vehicles & Trucks',          'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  33),
  ('1213', 'Fleet — Buses (Staff & School)',           'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  34),
  ('1214', 'Fleet — Ambulances & Emergency',           'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  35),
  ('1220', 'Workshop & Garage Equipment',              'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  36),
  ('1230', 'Office Equipment & Computers',             'ASSET',     'FIXED',        '1200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  37),
  ('1290', 'Accumulated Depreciation',                 'ASSET',     'FIXED',        '1200', 'Contra-asset: accumulated depreciation on fleet and equipment',       FALSE, TRUE, TRUE,  'CREDIT', 38),
  -- LIABILITIES
  ('2000', 'Liabilities',                              'LIABILITY', NULL,           NULL,   NULL,                                                                  TRUE,  TRUE, TRUE,  'CREDIT', 40),
  ('2100', 'Current Liabilities',                      'LIABILITY', 'CURRENT',      '2000', NULL,                                                                  TRUE,  TRUE, TRUE,  'CREDIT', 41),
  ('2110', 'Accounts Payable',                         'LIABILITY', 'CURRENT',      '2100', NULL,                                                                  FALSE, TRUE, TRUE,  'CREDIT', 42),
  ('2111', 'Trade Payables — Fuel Suppliers',          'LIABILITY', 'CURRENT',      '2110', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 43),
  ('2112', 'Trade Payables — Maintenance',             'LIABILITY', 'CURRENT',      '2110', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 44),
  ('2120', 'VAT Payable (Output VAT)',                 'LIABILITY', 'CURRENT',      '2100', NULL,                                                                  FALSE, TRUE, TRUE,  'CREDIT', 45),
  ('2130', 'Accrued Expenses',                         'LIABILITY', 'CURRENT',      '2100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 46),
  ('2131', 'Accrued Salaries & Wages',                 'LIABILITY', 'CURRENT',      '2130', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 47),
  ('2140', 'PDC Payable (Cheques Issued)',              'LIABILITY', 'CURRENT',      '2100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 48),
  ('2150', 'Customer Deposits & Advances',             'LIABILITY', 'CURRENT',      '2100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 49),
  ('2200', 'Non-Current Liabilities',                  'LIABILITY', 'NON_CURRENT',  '2000', NULL,                                                                  TRUE,  TRUE, TRUE,  'CREDIT', 50),
  ('2210', 'Vehicle Finance Lease Liability',          'LIABILITY', 'NON_CURRENT',  '2200', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 51),
  ('2220', 'Long-term Bank Loans',                     'LIABILITY', 'NON_CURRENT',  '2200', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 52),
  -- EQUITY
  ('3000', 'Equity',                                   'EQUITY',    NULL,           NULL,   NULL,                                                                  TRUE,  TRUE, TRUE,  'CREDIT', 60),
  ('3100', 'Share Capital',                            'EQUITY',    NULL,           '3000', NULL,                                                                  FALSE, TRUE, TRUE,  'CREDIT', 61),
  ('3200', 'Retained Earnings',                        'EQUITY',    NULL,           '3000', NULL,                                                                  FALSE, TRUE, TRUE,  'CREDIT', 62),
  ('3300', 'Current Year Profit / (Loss)',             'EQUITY',    NULL,           '3000', NULL,                                                                  FALSE, TRUE, TRUE,  'CREDIT', 63),
  -- INCOME
  ('4000', 'Income',                                   'INCOME',    NULL,           NULL,   NULL,                                                                  TRUE,  TRUE, TRUE,  'CREDIT', 70),
  ('4100', 'Rent-A-Car (RAC) Revenue',                 'INCOME',    'REVENUE',      '4000', NULL,                                                                  TRUE,  TRUE, FALSE, 'CREDIT', 71),
  ('4110', 'RAC — Daily Rental',                       'INCOME',    'REVENUE',      '4100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 72),
  ('4120', 'RAC — Weekly / Monthly Rental',            'INCOME',    'REVENUE',      '4100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 73),
  ('4130', 'RAC — Damage & Insurance Recovery',        'INCOME',    'REVENUE',      '4100', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 74),
  ('4200', 'Vehicle Leasing Revenue',                  'INCOME',    'REVENUE',      '4000', NULL,                                                                  TRUE,  TRUE, FALSE, 'CREDIT', 75),
  ('4210', 'Leasing — Monthly Lease Charges',          'INCOME',    'REVENUE',      '4200', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 76),
  ('4220', 'Leasing — Driver Charges',                 'INCOME',    'REVENUE',      '4200', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 77),
  ('4300', 'Logistics & Freight Revenue',              'INCOME',    'REVENUE',      '4000', NULL,                                                                  TRUE,  TRUE, FALSE, 'CREDIT', 78),
  ('4310', 'Logistics — Local Delivery',               'INCOME',    'REVENUE',      '4300', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 79),
  ('4320', 'Logistics — Long-Haul Freight',            'INCOME',    'REVENUE',      '4300', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 80),
  ('4330', 'Logistics — Packing & Handling',           'INCOME',    'REVENUE',      '4300', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 81),
  ('4400', 'Staff Transport Revenue',                  'INCOME',    'REVENUE',      '4000', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 82),
  ('4500', 'School Bus Revenue',                       'INCOME',    'REVENUE',      '4000', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 83),
  ('4600', 'Ambulance & Emergency Revenue',            'INCOME',    'REVENUE',      '4000', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 84),
  ('4700', 'Other Income',                             'INCOME',    'OTHER_INCOME', '4000', NULL,                                                                  TRUE,  TRUE, FALSE, 'CREDIT', 85),
  ('4710', 'Interest Income',                          'INCOME',    'OTHER_INCOME', '4700', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 86),
  ('4720', 'Gain on Asset Disposal',                   'INCOME',    'OTHER_INCOME', '4700', NULL,                                                                  FALSE, TRUE, FALSE, 'CREDIT', 87),
  -- EXPENSES
  ('5000', 'Expenses',                                 'EXPENSE',   NULL,           NULL,   NULL,                                                                  TRUE,  TRUE, TRUE,  'DEBIT',  90),
  ('5100', 'Direct Fleet Costs',                       'EXPENSE',   'COGS',         '5000', NULL,                                                                  TRUE,  TRUE, FALSE, 'DEBIT',  91),
  ('5110', 'Fuel & Lubricants',                        'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  92),
  ('5111', 'Fuel — Salik / Toll Charges',              'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  93),
  ('5120', 'Vehicle Maintenance & Repairs',            'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  94),
  ('5130', 'Vehicle Insurance Premiums',               'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  95),
  ('5140', 'RTA Registration & Licensing',             'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  96),
  ('5150', 'Fleet Depreciation',                       'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, TRUE,  'DEBIT',  97),
  ('5160', 'Loss on Asset Disposal',                   'EXPENSE',   'COGS',         '5100', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT',  98),
  ('5200', 'Driver & Staff Costs',                     'EXPENSE',   'OPEX',         '5000', NULL,                                                                  TRUE,  TRUE, FALSE, 'DEBIT', 100),
  ('5210', 'Driver Salaries',                          'EXPENSE',   'OPEX',         '5200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 101),
  ('5220', 'Driver Allowances & Overtime',             'EXPENSE',   'OPEX',         '5200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 102),
  ('5230', 'Driver Training & Certification',          'EXPENSE',   'OPEX',         '5200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 103),
  ('5240', 'MOHRE / WPS Compliance Costs',             'EXPENSE',   'OPEX',         '5200', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 104),
  ('5300', 'Administrative Expenses',                  'EXPENSE',   'OPEX',         '5000', NULL,                                                                  TRUE,  TRUE, FALSE, 'DEBIT', 110),
  ('5310', 'Office Rent & Service Charges',            'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 111),
  ('5320', 'Utilities (Electric/Water/Gas)',            'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 112),
  ('5330', 'Admin Staff Salaries',                     'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 113),
  ('5340', 'Communication & IT',                       'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 114),
  ('5350', 'Marketing & Advertising',                  'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 115),
  ('5360', 'Professional Fees (Legal/Audit)',          'EXPENSE',   'OPEX',         '5300', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 116),
  ('5400', 'Finance Costs',                            'EXPENSE',   'FINANCE',      '5000', NULL,                                                                  TRUE,  TRUE, FALSE, 'DEBIT', 120),
  ('5410', 'Bank Charges & Fees',                      'EXPENSE',   'FINANCE',      '5400', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 121),
  ('5420', 'Interest on Vehicle Finance',              'EXPENSE',   'FINANCE',      '5400', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 122),
  ('5430', 'Bad Debt Expense',                         'EXPENSE',   'FINANCE',      '5400', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 123),
  ('5440', 'PDC Bounce Charges',                       'EXPENSE',   'FINANCE',      '5400', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 124),
  ('5500', 'Tax Expense',                              'EXPENSE',   'TAX',          '5000', NULL,                                                                  TRUE,  TRUE, FALSE, 'DEBIT', 130),
  ('5510', 'UAE Corporate Tax (15%)',                  'EXPENSE',   'TAX',          '5500', NULL,                                                                  FALSE, TRUE, FALSE, 'DEBIT', 131)
ON CONFLICT (account_code) DO NOTHING;
