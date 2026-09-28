-- A chart of accounts per tenant.
--
-- finance.finance_chart_of_accounts had no tenant column: every tenant read,
-- and could add, rename, deactivate or delete, the same accounts (security
-- harness, cross-tenant phase). This migration gives each tenant its own copy
-- and puts the table under row level security.
--
--   1. tenant_id column (text, like the other finance tables).
--   2. finance.finance_coa_template: the standard transport chart of accounts
--      from 20260810000003_finance_reference_data_seed. New tenants are
--      seeded from it on first use (src/lib/finance/chart-of-accounts.ts).
--      It holds no tenant data; the runtime role may only read it.
--   3. Existing tenants get a copy of the chart as it is today, so no tenant
--      loses an account, a rename or a deactivation. The exception is an
--      account outside the standard chart that only one tenant has posted
--      to: it goes to that tenant alone. Other rows without a tenant are then
--      removed (they live on as the per-tenant copies).
--   4. Account codes are unique per tenant instead of globally.
--   5. Row level security in the project's standard form.
--
-- Idempotent: every step can run again, including where production already
-- has a tenant_id column.

-- Rows of every tenant are read and written below.
SELECT set_config('app.tenant_id', '*', false);

-- ── 1. tenant column ─────────────────────────────────────────────────────
-- Any existing policy is replaced in step 5; drop it first, as a column a
-- policy uses cannot change type.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'finance' AND tablename = 'finance_chart_of_accounts' LOOP
    EXECUTE format('DROP POLICY %I ON finance.finance_chart_of_accounts', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE finance.finance_chart_of_accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Where the column already existed with another type (uuid), make it text
-- like the rest of the finance tables and the policy below.
DO $$
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'finance.finance_chart_of_accounts'::regclass
         AND attname = 'tenant_id' AND NOT attisdropped) <> 'text' THEN
    ALTER TABLE finance.finance_chart_of_accounts ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;
  END IF;
END $$;

-- ── 2. template ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.finance_coa_template (
  account_code    TEXT     PRIMARY KEY,
  account_name    TEXT     NOT NULL,
  account_type    TEXT     NOT NULL,
  account_subtype TEXT,
  parent_code     TEXT,
  description     TEXT,
  is_header       BOOLEAN  NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN  NOT NULL DEFAULT TRUE,
  is_system       BOOLEAN  NOT NULL DEFAULT FALSE,
  normal_balance  TEXT     NOT NULL DEFAULT 'DEBIT',
  currency        TEXT     NOT NULL DEFAULT 'AED',
  sort_order      INTEGER  NOT NULL DEFAULT 0
);

INSERT INTO finance.finance_coa_template
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

-- Read-only for the runtime role. The template holds no tenant data, so it
-- has no row level security.
REVOKE ALL ON finance.finance_coa_template FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA finance TO fleet360_app';
    EXECUTE 'REVOKE ALL ON finance.finance_coa_template FROM fleet360_app';
    EXECUTE 'GRANT SELECT ON finance.finance_coa_template TO fleet360_app';
  END IF;
END $$;

-- ── 3. per-tenant copies of the chart as it is today ─────────────────────
-- An account outside the standard chart that exactly one tenant has posted
-- to belongs to that tenant.
WITH owners AS (
  SELECT jl.account_code, MIN(je.tenant_id::text) AS tenant_id
    FROM finance.finance_journal_lines jl
    JOIN finance.finance_journal_entries je ON je.id::text = jl.journal_entry_id::text
   WHERE je.tenant_id IS NOT NULL
   GROUP BY jl.account_code
  HAVING COUNT(DISTINCT je.tenant_id::text) = 1
)
UPDATE finance.finance_chart_of_accounts c
   SET tenant_id = o.tenant_id
  FROM owners o
 WHERE c.tenant_id IS NULL
   AND c.account_code = o.account_code
   AND NOT EXISTS (SELECT 1 FROM finance.finance_coa_template t WHERE t.account_code = c.account_code);

-- Account codes become unique per tenant (step 4) before the copies are made.
DO $$
DECLARE
  code_attnum smallint;
  r record;
BEGIN
  SELECT attnum INTO code_attnum FROM pg_attribute
   WHERE attrelid = 'finance.finance_chart_of_accounts'::regclass AND attname = 'account_code';

  -- Unique constraints on account_code alone.
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'finance.finance_chart_of_accounts'::regclass
              AND contype = 'u' AND conkey = ARRAY[code_attnum] LOOP
    EXECUTE format('ALTER TABLE finance.finance_chart_of_accounts DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- Unique indexes on account_code alone that back no constraint.
  FOR r IN SELECT i.indexrelid::regclass AS idx FROM pg_index i
            WHERE i.indrelid = 'finance.finance_chart_of_accounts'::regclass
              AND i.indisunique AND NOT i.indisprimary
              AND i.indkey::text = code_attnum::text
              AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid) LOOP
    EXECUTE format('DROP INDEX %s', r.idx);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS finance_chart_of_accounts_tenant_code_key
  ON finance.finance_chart_of_accounts (tenant_id, account_code);

-- Every tenant gets the rows every tenant sees today: the ones still without
-- a tenant.
INSERT INTO finance.finance_chart_of_accounts
  (tenant_id, created_at, updated_at, deleted_at, account_code, account_name, account_type,
   account_subtype, parent_code, description, is_header, is_active, is_system,
   normal_balance, currency, sort_order)
SELECT t.id::text, c.created_at, c.updated_at, c.deleted_at, c.account_code, c.account_name, c.account_type,
       c.account_subtype, c.parent_code, c.description, c.is_header, c.is_active, c.is_system,
       c.normal_balance, c.currency, c.sort_order
  FROM finance.finance_chart_of_accounts c
 CROSS JOIN public.tenants t
 WHERE c.tenant_id IS NULL
ON CONFLICT (tenant_id, account_code) DO NOTHING;

-- They now live on as the per-tenant copies.
DELETE FROM finance.finance_chart_of_accounts WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_chart_of_accounts_tenant
  ON finance.finance_chart_of_accounts (tenant_id);

-- ── 5. row level security ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON finance.finance_chart_of_accounts TO fleet360_app';
  END IF;
END $$;

ALTER TABLE finance.finance_chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.finance_chart_of_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance.finance_chart_of_accounts FOR ALL
  USING (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.tenant_id', true) = '*' OR tenant_id = current_setting('app.tenant_id', true));

SELECT set_config('app.tenant_id', '', false);
