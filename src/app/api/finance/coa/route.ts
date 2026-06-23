/**
 * Chart of Accounts — /api/finance/coa
 * Transport-specific double-entry COA with 5 root types
 * Account codes: 1xxx=Asset, 2xxx=Liability, 3xxx=Equity, 4xxx=Income, 5xxx=Expense
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_chart_of_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,
    account_code    TEXT UNIQUE NOT NULL,
    account_name    TEXT NOT NULL,
    account_type    TEXT NOT NULL,   -- ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
    account_subtype TEXT,            -- e.g. CURRENT_ASSET | FIXED_ASSET | REVENUE | COGS | OPEX | FINANCE
    parent_code     TEXT,            -- parent account_code for hierarchy
    description     TEXT,
    is_header       BOOLEAN DEFAULT FALSE,   -- header/group account, no direct posting
    is_active       BOOLEAN DEFAULT TRUE,
    is_system       BOOLEAN DEFAULT FALSE,   -- system accounts (cannot be deleted)
    normal_balance  TEXT DEFAULT 'DEBIT',    -- DEBIT | CREDIT (credit for liabilities/equity/income)
    currency        TEXT DEFAULT 'AED',
    sort_order      INTEGER DEFAULT 0,
    tenant_id       TEXT
  );
`;

type CoaRow = Record<string, unknown>;

// Transport-specific account seed
const SEED_ACCOUNTS = [
  // ── ASSETS ─────────────────────────────────────────────────
  { code: '1000', name: 'Assets',                          type: 'ASSET',     subtype: null,          parent: null,   header: true,  normal: 'DEBIT',  sys: true,  sort: 10 },
  { code: '1100', name: 'Current Assets',                  type: 'ASSET',     subtype: 'CURRENT',     parent: '1000', header: true,  normal: 'DEBIT',  sys: true,  sort: 11 },
  { code: '1110', name: 'Cash in Hand',                    type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: false, sort: 12 },
  { code: '1111', name: 'Petty Cash — Operations',         type: 'ASSET',     subtype: 'CURRENT',     parent: '1110', header: false, normal: 'DEBIT',  sys: false, sort: 13 },
  { code: '1120', name: 'Cash at Bank',                    type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: false, sort: 14 },
  { code: '1121', name: 'Emirates NBD — Operating',        type: 'ASSET',     subtype: 'CURRENT',     parent: '1120', header: false, normal: 'DEBIT',  sys: false, sort: 15 },
  { code: '1122', name: 'FAB — Payroll Account',           type: 'ASSET',     subtype: 'CURRENT',     parent: '1120', header: false, normal: 'DEBIT',  sys: false, sort: 16 },
  { code: '1130', name: 'Accounts Receivable',             type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: true,  sort: 17 },
  { code: '1131', name: 'Trade Receivables — RAC',         type: 'ASSET',     subtype: 'CURRENT',     parent: '1130', header: false, normal: 'DEBIT',  sys: false, sort: 18 },
  { code: '1132', name: 'Trade Receivables — Leasing',     type: 'ASSET',     subtype: 'CURRENT',     parent: '1130', header: false, normal: 'DEBIT',  sys: false, sort: 19 },
  { code: '1133', name: 'Trade Receivables — Logistics',   type: 'ASSET',     subtype: 'CURRENT',     parent: '1130', header: false, normal: 'DEBIT',  sys: false, sort: 20 },
  { code: '1134', name: 'Trade Receivables — Staff Transport', type: 'ASSET', subtype: 'CURRENT',     parent: '1130', header: false, normal: 'DEBIT',  sys: false, sort: 21 },
  { code: '1135', name: 'Trade Receivables — School Bus',  type: 'ASSET',     subtype: 'CURRENT',     parent: '1130', header: false, normal: 'DEBIT',  sys: false, sort: 22 },
  { code: '1140', name: 'VAT Recoverable (Input VAT)',     type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: true,  sort: 23 },
  { code: '1150', name: 'Prepaid Expenses',                type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: false, sort: 24 },
  { code: '1151', name: 'Prepaid Insurance',               type: 'ASSET',     subtype: 'CURRENT',     parent: '1150', header: false, normal: 'DEBIT',  sys: false, sort: 25 },
  { code: '1160', name: 'PDC Receivable (Post-Dated Cheques Held)', type: 'ASSET', subtype: 'CURRENT', parent: '1100', header: false, normal: 'DEBIT', sys: false, sort: 26 },
  { code: '1170', name: 'Fuel Inventory',                  type: 'ASSET',     subtype: 'CURRENT',     parent: '1100', header: false, normal: 'DEBIT',  sys: false, sort: 27 },
  { code: '1200', name: 'Fixed Assets',                    type: 'ASSET',     subtype: 'FIXED',       parent: '1000', header: true,  normal: 'DEBIT',  sys: true,  sort: 30 },
  { code: '1210', name: 'Fleet — Passenger Vehicles',      type: 'ASSET',     subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 31 },
  { code: '1211', name: 'Fleet — Light Commercial Vehicles', type: 'ASSET',   subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 32 },
  { code: '1212', name: 'Fleet — Heavy Vehicles & Trucks',  type: 'ASSET',    subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 33 },
  { code: '1213', name: 'Fleet — Buses (Staff & School)',   type: 'ASSET',    subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 34 },
  { code: '1214', name: 'Fleet — Ambulances & Emergency',   type: 'ASSET',    subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 35 },
  { code: '1220', name: 'Workshop & Garage Equipment',      type: 'ASSET',     subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 36 },
  { code: '1230', name: 'Office Equipment & Computers',     type: 'ASSET',     subtype: 'FIXED',       parent: '1200', header: false, normal: 'DEBIT',  sys: false, sort: 37 },
  { code: '1290', name: 'Accumulated Depreciation',         type: 'ASSET',     subtype: 'FIXED',       parent: '1200', header: false, normal: 'CREDIT', sys: true,  sort: 38, desc: 'Contra-asset: accumulated depreciation on fleet and equipment' },

  // ── LIABILITIES ─────────────────────────────────────────────
  { code: '2000', name: 'Liabilities',                     type: 'LIABILITY', subtype: null,          parent: null,   header: true,  normal: 'CREDIT', sys: true,  sort: 40 },
  { code: '2100', name: 'Current Liabilities',             type: 'LIABILITY', subtype: 'CURRENT',     parent: '2000', header: true,  normal: 'CREDIT', sys: true,  sort: 41 },
  { code: '2110', name: 'Accounts Payable',                type: 'LIABILITY', subtype: 'CURRENT',     parent: '2100', header: false, normal: 'CREDIT', sys: true,  sort: 42 },
  { code: '2111', name: 'Trade Payables — Fuel Suppliers',  type: 'LIABILITY', subtype: 'CURRENT',    parent: '2110', header: false, normal: 'CREDIT', sys: false, sort: 43 },
  { code: '2112', name: 'Trade Payables — Maintenance',    type: 'LIABILITY', subtype: 'CURRENT',     parent: '2110', header: false, normal: 'CREDIT', sys: false, sort: 44 },
  { code: '2120', name: 'VAT Payable (Output VAT)',        type: 'LIABILITY', subtype: 'CURRENT',     parent: '2100', header: false, normal: 'CREDIT', sys: true,  sort: 45 },
  { code: '2130', name: 'Accrued Expenses',                type: 'LIABILITY', subtype: 'CURRENT',     parent: '2100', header: false, normal: 'CREDIT', sys: false, sort: 46 },
  { code: '2131', name: 'Accrued Salaries & Wages',        type: 'LIABILITY', subtype: 'CURRENT',     parent: '2130', header: false, normal: 'CREDIT', sys: false, sort: 47 },
  { code: '2140', name: 'PDC Payable (Cheques Issued)',     type: 'LIABILITY', subtype: 'CURRENT',     parent: '2100', header: false, normal: 'CREDIT', sys: false, sort: 48 },
  { code: '2150', name: 'Customer Deposits & Advances',    type: 'LIABILITY', subtype: 'CURRENT',     parent: '2100', header: false, normal: 'CREDIT', sys: false, sort: 49 },
  { code: '2200', name: 'Non-Current Liabilities',         type: 'LIABILITY', subtype: 'NON_CURRENT', parent: '2000', header: true,  normal: 'CREDIT', sys: true,  sort: 50 },
  { code: '2210', name: 'Vehicle Finance Lease Liability',  type: 'LIABILITY', subtype: 'NON_CURRENT', parent: '2200', header: false, normal: 'CREDIT', sys: false, sort: 51 },
  { code: '2220', name: 'Long-term Bank Loans',            type: 'LIABILITY', subtype: 'NON_CURRENT', parent: '2200', header: false, normal: 'CREDIT', sys: false, sort: 52 },

  // ── EQUITY ──────────────────────────────────────────────────
  { code: '3000', name: 'Equity',                          type: 'EQUITY',    subtype: null,          parent: null,   header: true,  normal: 'CREDIT', sys: true,  sort: 60 },
  { code: '3100', name: 'Share Capital',                   type: 'EQUITY',    subtype: null,          parent: '3000', header: false, normal: 'CREDIT', sys: true,  sort: 61 },
  { code: '3200', name: 'Retained Earnings',               type: 'EQUITY',    subtype: null,          parent: '3000', header: false, normal: 'CREDIT', sys: true,  sort: 62 },
  { code: '3300', name: 'Current Year Profit / (Loss)',    type: 'EQUITY',    subtype: null,          parent: '3000', header: false, normal: 'CREDIT', sys: true,  sort: 63 },

  // ── INCOME ──────────────────────────────────────────────────
  { code: '4000', name: 'Income',                          type: 'INCOME',    subtype: null,          parent: null,   header: true,  normal: 'CREDIT', sys: true,  sort: 70 },
  { code: '4100', name: 'Rent-A-Car (RAC) Revenue',        type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: true,  normal: 'CREDIT', sys: false, sort: 71 },
  { code: '4110', name: 'RAC — Daily Rental',              type: 'INCOME',    subtype: 'REVENUE',     parent: '4100', header: false, normal: 'CREDIT', sys: false, sort: 72 },
  { code: '4120', name: 'RAC — Weekly / Monthly Rental',   type: 'INCOME',    subtype: 'REVENUE',     parent: '4100', header: false, normal: 'CREDIT', sys: false, sort: 73 },
  { code: '4130', name: 'RAC — Damage & Insurance Recovery', type: 'INCOME',  subtype: 'REVENUE',     parent: '4100', header: false, normal: 'CREDIT', sys: false, sort: 74 },
  { code: '4200', name: 'Vehicle Leasing Revenue',         type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: true,  normal: 'CREDIT', sys: false, sort: 75 },
  { code: '4210', name: 'Leasing — Monthly Lease Charges', type: 'INCOME',    subtype: 'REVENUE',     parent: '4200', header: false, normal: 'CREDIT', sys: false, sort: 76 },
  { code: '4220', name: 'Leasing — Driver Charges',        type: 'INCOME',    subtype: 'REVENUE',     parent: '4200', header: false, normal: 'CREDIT', sys: false, sort: 77 },
  { code: '4300', name: 'Logistics & Freight Revenue',     type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: true,  normal: 'CREDIT', sys: false, sort: 78 },
  { code: '4310', name: 'Logistics — Local Delivery',      type: 'INCOME',    subtype: 'REVENUE',     parent: '4300', header: false, normal: 'CREDIT', sys: false, sort: 79 },
  { code: '4320', name: 'Logistics — Long-Haul Freight',   type: 'INCOME',    subtype: 'REVENUE',     parent: '4300', header: false, normal: 'CREDIT', sys: false, sort: 80 },
  { code: '4330', name: 'Logistics — Packing & Handling',  type: 'INCOME',    subtype: 'REVENUE',     parent: '4300', header: false, normal: 'CREDIT', sys: false, sort: 81 },
  { code: '4400', name: 'Staff Transport Revenue',         type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: false, normal: 'CREDIT', sys: false, sort: 82 },
  { code: '4500', name: 'School Bus Revenue',              type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: false, normal: 'CREDIT', sys: false, sort: 83 },
  { code: '4600', name: 'Ambulance & Emergency Revenue',   type: 'INCOME',    subtype: 'REVENUE',     parent: '4000', header: false, normal: 'CREDIT', sys: false, sort: 84 },
  { code: '4700', name: 'Other Income',                    type: 'INCOME',    subtype: 'OTHER_INCOME', parent: '4000', header: true,  normal: 'CREDIT', sys: false, sort: 85 },
  { code: '4710', name: 'Interest Income',                 type: 'INCOME',    subtype: 'OTHER_INCOME', parent: '4700', header: false, normal: 'CREDIT', sys: false, sort: 86 },
  { code: '4720', name: 'Gain on Asset Disposal',          type: 'INCOME',    subtype: 'OTHER_INCOME', parent: '4700', header: false, normal: 'CREDIT', sys: false, sort: 87 },

  // ── EXPENSES ────────────────────────────────────────────────
  { code: '5000', name: 'Expenses',                        type: 'EXPENSE',   subtype: null,          parent: null,   header: true,  normal: 'DEBIT',  sys: true,  sort: 90 },
  { code: '5100', name: 'Direct Fleet Costs',              type: 'EXPENSE',   subtype: 'COGS',        parent: '5000', header: true,  normal: 'DEBIT',  sys: false, sort: 91 },
  { code: '5110', name: 'Fuel & Lubricants',               type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 92 },
  { code: '5111', name: 'Fuel — Salik / Toll Charges',     type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 93 },
  { code: '5120', name: 'Vehicle Maintenance & Repairs',   type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 94 },
  { code: '5130', name: 'Vehicle Insurance Premiums',      type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 95 },
  { code: '5140', name: 'RTA Registration & Licensing',    type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 96 },
  { code: '5150', name: 'Fleet Depreciation',              type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: true,  sort: 97 },
  { code: '5160', name: 'Loss on Asset Disposal',          type: 'EXPENSE',   subtype: 'COGS',        parent: '5100', header: false, normal: 'DEBIT',  sys: false, sort: 98 },
  { code: '5200', name: 'Driver & Staff Costs',            type: 'EXPENSE',   subtype: 'OPEX',        parent: '5000', header: true,  normal: 'DEBIT',  sys: false, sort: 100 },
  { code: '5210', name: 'Driver Salaries',                 type: 'EXPENSE',   subtype: 'OPEX',        parent: '5200', header: false, normal: 'DEBIT',  sys: false, sort: 101 },
  { code: '5220', name: 'Driver Allowances & Overtime',    type: 'EXPENSE',   subtype: 'OPEX',        parent: '5200', header: false, normal: 'DEBIT',  sys: false, sort: 102 },
  { code: '5230', name: 'Driver Training & Certification', type: 'EXPENSE',   subtype: 'OPEX',        parent: '5200', header: false, normal: 'DEBIT',  sys: false, sort: 103 },
  { code: '5240', name: 'MOHRE / WPS Compliance Costs',    type: 'EXPENSE',   subtype: 'OPEX',        parent: '5200', header: false, normal: 'DEBIT',  sys: false, sort: 104 },
  { code: '5300', name: 'Administrative Expenses',         type: 'EXPENSE',   subtype: 'OPEX',        parent: '5000', header: true,  normal: 'DEBIT',  sys: false, sort: 110 },
  { code: '5310', name: 'Office Rent & Service Charges',   type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 111 },
  { code: '5320', name: 'Utilities (Electric/Water/Gas)',   type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 112 },
  { code: '5330', name: 'Admin Staff Salaries',            type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 113 },
  { code: '5340', name: 'Communication & IT',              type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 114 },
  { code: '5350', name: 'Marketing & Advertising',         type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 115 },
  { code: '5360', name: 'Professional Fees (Legal/Audit)', type: 'EXPENSE',   subtype: 'OPEX',        parent: '5300', header: false, normal: 'DEBIT',  sys: false, sort: 116 },
  { code: '5400', name: 'Finance Costs',                   type: 'EXPENSE',   subtype: 'FINANCE',     parent: '5000', header: true,  normal: 'DEBIT',  sys: false, sort: 120 },
  { code: '5410', name: 'Bank Charges & Fees',             type: 'EXPENSE',   subtype: 'FINANCE',     parent: '5400', header: false, normal: 'DEBIT',  sys: false, sort: 121 },
  { code: '5420', name: 'Interest on Vehicle Finance',     type: 'EXPENSE',   subtype: 'FINANCE',     parent: '5400', header: false, normal: 'DEBIT',  sys: false, sort: 122 },
  { code: '5430', name: 'Bad Debt Expense',                type: 'EXPENSE',   subtype: 'FINANCE',     parent: '5400', header: false, normal: 'DEBIT',  sys: false, sort: 123 },
  { code: '5440', name: 'PDC Bounce Charges',              type: 'EXPENSE',   subtype: 'FINANCE',     parent: '5400', header: false, normal: 'DEBIT',  sys: false, sort: 124 },
  { code: '5500', name: 'Tax Expense',                     type: 'EXPENSE',   subtype: 'TAX',         parent: '5000', header: true,  normal: 'DEBIT',  sys: false, sort: 130 },
  { code: '5510', name: 'UAE Corporate Tax (15%)',          type: 'EXPENSE',   subtype: 'TAX',         parent: '5500', header: false, normal: 'DEBIT',  sys: false, sort: 131 },
];

async function seedIfEmpty() {
  const [{ count }] = await prisma.$queryRawUnsafe<{count: string}[]>(
    `SELECT COUNT(*)::text as count FROM finance_chart_of_accounts`
  ).catch(() => [{ count: '0' }]);

  if (parseInt(count) > 0) return;

  for (const a of SEED_ACCOUNTS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_chart_of_accounts
         (account_code, account_name, account_type, account_subtype, parent_code,
          description, is_header, is_active, is_system, normal_balance, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (account_code) DO NOTHING`,
      a.code, a.name, a.type, a.subtype ?? null, a.parent ?? null,
      (a as {desc?: string}).desc ?? null, a.header, true, a.sys, a.normal, a.sort
    ).catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await ensureOperationalTenantColumn('finance_chart_of_accounts').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  await seedIfEmpty();

  const sp      = req.nextUrl.searchParams;
  const type    = sp.get('type');    // filter by ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
  const search  = sp.get('search');
  const flat    = sp.get('flat');    // flat list vs tree

  let where = `WHERE deleted_at IS NULL AND (tenant_id::text = $1 OR tenant_id IS NULL)`;
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;
  if (type)   { where += ` AND account_type = $${pi++}`;    params.push(type); }
  if (search) { where += ` AND (account_code ILIKE $${pi} OR account_name ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

  const rows = await prisma.$queryRawUnsafe<CoaRow[]>(
    `SELECT * FROM finance_chart_of_accounts ${where} ORDER BY sort_order, account_code`, ...params
  ).catch(() => []);

  if (flat === 'true') return NextResponse.json({ data: rows, count: rows.length });

  // Build tree
  const map = new Map<string, CoaRow & { children: CoaRow[] }>();
  const roots: (CoaRow & { children: CoaRow[] })[] = [];
  for (const r of rows) {
    map.set(r.account_code as string, { ...r, children: [] });
  }
  for (const r of rows) {
    const node = map.get(r.account_code as string)!;
    if (r.parent_code && map.has(r.parent_code as string)) {
      (map.get(r.parent_code as string)!.children as CoaRow[]).push(node);
    } else if (!r.parent_code) {
      roots.push(node);
    }
  }

  return NextResponse.json({ data: roots, flatData: rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await ensureOperationalTenantColumn('finance_chart_of_accounts').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();

  // Determine normal_balance from account_type if not specified
  const normalBalance = body.normalBalance ??
    (['LIABILITY', 'EQUITY', 'INCOME'].includes(body.accountType) ? 'CREDIT' : 'DEBIT');

  const [row] = await prisma.$queryRawUnsafe<CoaRow[]>(
    `INSERT INTO finance_chart_of_accounts
       (account_code, account_name, account_type, account_subtype, parent_code,
        description, is_header, is_active, normal_balance, sort_order, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    body.accountCode, body.accountName, body.accountType,
    body.accountSubtype ?? null, body.parentCode ?? null,
    body.description ?? null, body.isHeader ?? false, true,
    normalBalance, body.sortOrder ?? 999, ctx.tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceChartOfAccount',
    entityId: String(row.id ?? body.accountCode),
    action: 'CREATE',
    after: row,
    summary: `Created chart of account ${String(row.account_code ?? body.accountCode)}.`,
  });
  return NextResponse.json(row, { status: 201 });
}
