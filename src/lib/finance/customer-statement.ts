import { prisma } from '@/lib/prisma';

const normalizeCustomerKey = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export type CustomerOption = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  invoiceCount: number;
  outstandingAmount: number;
  active: boolean;
};

export type StatementLedgerEntry = {
  id: string;
  date: string;
  voucherType: string;
  voucherNo: string;
  description: string;
  age: number;
  poNo: string;
  debit: number;
  credit: number;
  runningBalance: number;
  sourceModule: string;
  branch: string;
  note: string;
};

export type StatementOutstandingRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  sourceModule: string;
  branch: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  creditNoteAmount: number;
  outstandingAmount: number;
  ageDays: number;
  status: string;
};

export type StatementDepositRow = {
  id: string;
  depositNo: string;
  type: string;
  date: string;
  agreement: string;
  amount: number;
  used: number;
  refunded: number;
  refundDate: string;
  status: string;
  branch: string;
  vehicleNo: string;
};

export type StatementFilters = {
  from: string;
  to: string;
  includeInactive: boolean;
  view: 'ledger' | 'outstanding';
  module: string;
  branch: string;
};

type InvoiceRow = Record<string, unknown>;
type PaymentRow = Record<string, unknown>;
type CreditNoteRow = Record<string, unknown>;
type DepositRow = Record<string, unknown>;
type DepositCustomerRow = Record<string, unknown>;

type DepositDeduction = {
  id?: string;
  description?: string;
  amount?: number;
  date?: string;
  category?: string;
};

export async function ensureFinanceStatementTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_invoices (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number   TEXT NOT NULL UNIQUE,
      client_name      TEXT NOT NULL,
      client_email     TEXT,
      client_phone     TEXT,
      client_address   TEXT,
      service_type     TEXT NOT NULL DEFAULT 'GENERAL',
      module           TEXT NOT NULL DEFAULT 'GENERAL',
      description      TEXT,
      line_items       JSONB NOT NULL DEFAULT '[]',
      subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
      discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
      vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
      vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
      paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency         TEXT NOT NULL DEFAULT 'AED',
      issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
      due_date         DATE,
      payment_status   TEXT NOT NULL DEFAULT 'DRAFT',
      notes            TEXT,
      reference_id     UUID,
      reference_type   TEXT,
      created_by       TEXT,
      tenant_id        TEXT,
      branch           TEXT DEFAULT 'Unassigned',
      module_source    TEXT,
      source_entity_type TEXT,
      source_entity_id TEXT,
      source_entity_no TEXT,
      source_customer_id TEXT,
      source_customer_name TEXT,
      source_contract_ids TEXT[],
      source_payload   JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Unassigned'
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_payments (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id     UUID,
      amount         NUMERIC(14,2) NOT NULL,
      payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
      payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      reference      TEXT,
      notes          TEXT,
      tenant_id      TEXT,
      customer_name  TEXT,
      customer_email TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_name TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS customer_email TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS cash_receipt_id UUID;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS cash_allocation_id UUID;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS receipt_no TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS voucher_no TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;
    ALTER TABLE finance_payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_security_deposits (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deposit_no       TEXT UNIQUE NOT NULL,
      contract_id      TEXT NOT NULL,
      contract_type    TEXT NOT NULL DEFAULT 'LEASE',
      customer_name    TEXT NOT NULL,
      customer_trn     TEXT,
      vehicle_no       TEXT NOT NULL,
      vehicle_type     TEXT,
      branch           TEXT NOT NULL DEFAULT 'Dubai',
      collected_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      collection_date  DATE NOT NULL,
      collection_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
      cheque_no        TEXT,
      bank_name        TEXT,
      status           TEXT NOT NULL DEFAULT 'HELD',
      deductions       JSONB NOT NULL DEFAULT '[]',
      total_deducted   NUMERIC(14,2) NOT NULL DEFAULT 0,
      refund_amount    NUMERIC(14,2),
      refund_date      DATE,
      refund_method    TEXT,
      refund_reference TEXT,
      forfeiture_reason TEXT,
      notes            TEXT,
      tenant_id        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_security_deposits ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_credit_notes (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      cn_number           TEXT UNIQUE NOT NULL,
      original_invoice_id TEXT,
      original_invoice_no TEXT,
      client_name         TEXT NOT NULL,
      client_email        TEXT,
      module              TEXT,
      branch              TEXT DEFAULT 'Unassigned',
      reason_code         TEXT NOT NULL,
      reason_detail       TEXT,
      line_items          JSONB,
      subtotal            NUMERIC(15,2) NOT NULL,
      vat_amount          NUMERIC(15,2) DEFAULT 0,
      total_amount        NUMERIC(15,2) NOT NULL,
      currency            TEXT DEFAULT 'AED',
      issue_date          DATE NOT NULL,
      status              TEXT DEFAULT 'DRAFT',
      applied_amount      NUMERIC(15,2) DEFAULT 0,
      refunded_at         TIMESTAMPTZ,
      refund_method       TEXT,
      issued_by           TEXT,
      approved_by         TEXT,
      tenant_id           TEXT,
      notes               TEXT
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_credit_notes ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE finance_credit_notes ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Unassigned'
  `).catch(() => {});
}

function invoiceModule(row: InvoiceRow) {
  return String(row.module_source ?? row.module ?? 'GENERAL');
}

function invoiceBranch(row: InvoiceRow) {
  return String(row.branch ?? 'Unassigned');
}

function creditNoteBranch(row: CreditNoteRow) {
  return String(row.branch ?? 'Unassigned');
}

function matchesFilter(value: string, filter: string) {
  return !filter || value === filter;
}

function parseDepositDeductions(value: unknown): DepositDeduction[] {
  const parsed = typeof value === 'string'
    ? (() => {
        try { return JSON.parse(value) as unknown; } catch { return []; }
      })()
    : value;
  return Array.isArray(parsed) ? parsed as DepositDeduction[] : [];
}

function collectFilterOptions(args: {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  creditNotes: CreditNoteRow[];
  deposits: DepositRow[];
}) {
  const modules = new Set<string>();
  const branches = new Set<string>();

  for (const row of args.invoices) {
    modules.add(invoiceModule(row));
    branches.add(invoiceBranch(row));
  }
  for (const row of args.payments) {
    modules.add(String(row.module_key ?? 'FINANCE'));
    branches.add(String(row.branch ?? 'Unassigned'));
  }
  for (const row of args.creditNotes) {
    modules.add(String(row.module ?? 'FINANCE'));
    branches.add(creditNoteBranch(row));
  }
  for (const row of args.deposits) {
    branches.add(String(row.branch ?? 'Unassigned'));
  }

  return {
    modules: [...modules].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    branches: [...branches].filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
}

export async function buildCustomerStatement(args: {
  tenantId: string;
  customerKey?: string | null;
  includeInactive?: boolean;
  view?: 'ledger' | 'outstanding';
  from: string;
  to: string;
  module?: string | null;
  branch?: string | null;
}) {
  await ensureFinanceStatementTables();

  const includeInactive = !!args.includeInactive;
  const view = args.view === 'outstanding' ? 'outstanding' : 'ledger';
  const moduleFilter = args.module?.trim() ?? '';
  const branchFilter = args.branch?.trim() ?? '';

  const invoices = await prisma.$queryRawUnsafe<InvoiceRow[]>(
    `SELECT id, invoice_number, client_name, client_email, client_phone, client_address,
            module, module_source, branch, service_type, description, total_amount, paid_amount, currency,
            issue_date, due_date, payment_status, notes, created_at
       FROM finance_invoices
      WHERE deleted_at IS NULL
        AND tenant_id::text = $1
      ORDER BY issue_date ASC, created_at ASC`,
    args.tenantId,
  ).catch(() => []);

  const payments = await prisma.$queryRawUnsafe<PaymentRow[]>(
    `SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.payment_method,
            COALESCE(p.receipt_no, p.voucher_no, p.reference) AS reference,
            p.notes, p.created_at,
            COALESCE(p.customer_name, i.client_name) AS customer_name,
            COALESCE(p.customer_email, i.client_email) AS customer_email,
            COALESCE(i.invoice_number, '') AS invoice_number,
            COALESCE(i.module_source, i.module, 'FINANCE') AS module_key,
            COALESCE(i.branch, 'Unassigned') AS branch
       FROM finance_payments p
       LEFT JOIN finance_invoices i ON i.id = p.invoice_id
      WHERE (
              p.tenant_id::text = $1
           OR (p.tenant_id IS NULL AND i.tenant_id::text = $1)
            )
        AND COALESCE(p.status, 'ACTIVE') <> 'REVERSED'
        AND p.deleted_at IS NULL
      ORDER BY p.payment_date ASC, p.created_at ASC`,
    args.tenantId,
  ).catch(() => []);

  const creditNotes = await prisma.$queryRawUnsafe<CreditNoteRow[]>(
    `SELECT id, cn_number, original_invoice_id, original_invoice_no, client_name, client_email,
            module, branch, reason_code, reason_detail, total_amount, issue_date, status, notes, created_at
       FROM finance_credit_notes
      WHERE deleted_at IS NULL
        AND tenant_id::text = $1
      ORDER BY issue_date ASC, created_at ASC`,
    args.tenantId,
  ).catch(() => []);

  const deposits = await prisma.$queryRawUnsafe<DepositRow[]>(
    `SELECT id, deposit_no, contract_id, contract_type, customer_name, vehicle_no, branch,
            collected_amount, collection_date, collection_method, status, deductions,
            total_deducted, refund_amount, refund_date, refund_method, refund_reference,
            forfeiture_reason, notes, created_at
       FROM finance_security_deposits
      WHERE tenant_id::text = $1
      ORDER BY collection_date DESC, created_at DESC`,
    args.tenantId,
  ).catch(() => []);

  const depositCustomers = await prisma.$queryRawUnsafe<DepositCustomerRow[]>(
    `SELECT customer_name, status
       FROM finance_security_deposits
      WHERE tenant_id::text = $1`,
    args.tenantId,
  ).catch(() => []);

  const filterOptions = collectFilterOptions({ invoices, payments, creditNotes, deposits });

  const customerMap = new Map<string, CustomerOption>();
  for (const row of invoices) {
    const name = String(row.client_name ?? '').trim();
    if (!name) continue;
    const key = normalizeCustomerKey(name);
    const currentModule = invoiceModule(row);
    const currentBranch = invoiceBranch(row);
    if (!matchesFilter(currentModule, moduleFilter) || !matchesFilter(currentBranch, branchFilter)) continue;
    const outstandingAmount = Math.max(0, Number(row.total_amount ?? 0) - Number(row.paid_amount ?? 0));
    const current = customerMap.get(key);
    if (!current) {
      customerMap.set(key, {
        key,
        name,
        email: row.client_email ? String(row.client_email) : null,
        phone: row.client_phone ? String(row.client_phone) : null,
        address: row.client_address ? String(row.client_address) : null,
        invoiceCount: 1,
        outstandingAmount,
        active: outstandingAmount > 0 || ['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(row.payment_status ?? '')),
      });
      continue;
    }
    current.invoiceCount += 1;
    current.outstandingAmount += outstandingAmount;
    current.active = current.active || outstandingAmount > 0 || ['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'].includes(String(row.payment_status ?? ''));
    current.email = current.email ?? (row.client_email ? String(row.client_email) : null);
    current.phone = current.phone ?? (row.client_phone ? String(row.client_phone) : null);
    current.address = current.address ?? (row.client_address ? String(row.client_address) : null);
  }

  for (const row of depositCustomers) {
    const name = String(row.customer_name ?? '').trim();
    if (!name || branchFilter) continue;
    const key = normalizeCustomerKey(name);
    const current = customerMap.get(key);
    if (!current) {
      customerMap.set(key, {
        key,
        name,
        email: null,
        phone: null,
        address: null,
        invoiceCount: 0,
        outstandingAmount: 0,
        active: ['HELD', 'PARTIALLY_REFUNDED'].includes(String(row.status ?? '')),
      });
      continue;
    }
    current.active = current.active || ['HELD', 'PARTIALLY_REFUNDED'].includes(String(row.status ?? ''));
  }

  for (const row of creditNotes) {
    const status = String(row.status ?? 'DRAFT');
    if (['DRAFT', 'VOIDED'].includes(status)) continue;
    const key = normalizeCustomerKey(String(row.client_name ?? ''));
    const current = customerMap.get(key);
    if (!current) continue;
    if (!matchesFilter(String(row.module ?? 'FINANCE'), moduleFilter) || !matchesFilter(creditNoteBranch(row), branchFilter)) continue;
    current.outstandingAmount = Math.max(0, current.outstandingAmount - Number(row.total_amount ?? 0));
    current.active = current.active || Number(row.total_amount ?? 0) > 0;
  }

  const customers = [...customerMap.values()]
    .filter((customer) => includeInactive || customer.active)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!args.customerKey) {
    return {
      customers,
      filters: {
        from: args.from,
        to: args.to,
        includeInactive,
        view,
        module: moduleFilter,
        branch: branchFilter,
      },
      availableFilters: filterOptions,
    };
  }

  const customer = customers.find((item) => item.key === args.customerKey)
    ?? [...customerMap.values()].find((item) => item.key === args.customerKey);
  if (!customer) return null;

  const customerInvoices = invoices.filter((row) =>
    normalizeCustomerKey(String(row.client_name ?? '')) === args.customerKey
    && matchesFilter(invoiceModule(row), moduleFilter)
    && matchesFilter(invoiceBranch(row), branchFilter),
  );

  const customerPayments = payments.filter((row) =>
    normalizeCustomerKey(String(row.customer_name ?? '')) === args.customerKey
    && matchesFilter(String(row.module_key ?? 'FINANCE'), moduleFilter)
    && matchesFilter(String(row.branch ?? 'Unassigned'), branchFilter),
  );

  const customerCreditNotes = creditNotes.filter((row) =>
    normalizeCustomerKey(String(row.client_name ?? '')) === args.customerKey
    && !['DRAFT', 'VOIDED'].includes(String(row.status ?? 'DRAFT'))
    && matchesFilter(String(row.module ?? 'FINANCE'), moduleFilter)
    && matchesFilter(creditNoteBranch(row), branchFilter),
  );

  const customerDeposits = deposits.filter((row) =>
    normalizeCustomerKey(String(row.customer_name ?? '')) === args.customerKey
    && matchesFilter(String(row.branch ?? 'Unassigned'), branchFilter),
  );

  const depositLedgerEntries = customerDeposits.flatMap((row) => {
    const depositNo = String(row.deposit_no ?? row.id);
    const branch = String(row.branch ?? 'Unassigned');
    const collectionDate = row.collection_date ? String(row.collection_date).slice(0, 10) : '';
    const collectedAmount = Number(row.collected_amount ?? 0);
    const refundDate = row.refund_date ? String(row.refund_date).slice(0, 10) : '';
    const refundAmount = Number(row.refund_amount ?? 0);
    const deductions = parseDepositDeductions(row.deductions);

    const entries: Omit<StatementLedgerEntry, 'runningBalance'>[] = [];

    if (collectionDate && collectedAmount > 0) {
      entries.push({
        id: `dep-collected-${row.id}`,
        date: collectionDate,
        voucherType: 'Deposit',
        voucherNo: depositNo,
        description: `Security deposit collected for ${String(row.contract_id ?? 'contract')}`,
        age: 0,
        poNo: '',
        debit: 0,
        credit: collectedAmount,
        sourceModule: 'DEPOSITS',
        branch,
        note: row.notes ? String(row.notes) : '',
      });
    }

    for (const deduction of deductions) {
      const amount = Number(deduction.amount ?? 0);
      if (amount <= 0) continue;
      const deductionDate = deduction.date ? String(deduction.date).slice(0, 10) : collectionDate;
      entries.push({
        id: `dep-deduction-${row.id}-${deduction.id ?? `${deductionDate}-${amount}`}`,
        date: deductionDate,
        voucherType: 'Deposit Deduction',
        voucherNo: depositNo,
        description: deduction.description
          ? `Deposit deduction - ${String(deduction.description)}`
          : `Deposit deduction${deduction.category ? ` - ${String(deduction.category)}` : ''}`,
        age: 0,
        poNo: '',
        debit: amount,
        credit: 0,
        sourceModule: 'DEPOSITS',
        branch,
        note: deduction.category ? String(deduction.category) : '',
      });
    }

    if (refundDate && refundAmount > 0) {
      entries.push({
        id: `dep-refund-${row.id}`,
        date: refundDate,
        voucherType: 'Deposit Refund',
        voucherNo: String(row.refund_reference ?? depositNo),
        description: `Security deposit refunded for ${String(row.contract_id ?? 'contract')}`,
        age: 0,
        poNo: '',
        debit: refundAmount,
        credit: 0,
        sourceModule: 'DEPOSITS',
        branch,
        note: row.refund_method ? String(row.refund_method) : '',
      });
    }

    return entries;
  });

  const openingDebit = customerInvoices
    .filter((row) => String(row.issue_date ?? '').slice(0, 10) < args.from)
    .reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);

  const openingPayments = customerPayments
    .filter((row) => String(row.payment_date ?? '').slice(0, 10) < args.from)
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const openingCreditNotes = customerCreditNotes
    .filter((row) => String(row.issue_date ?? '').slice(0, 10) < args.from)
    .reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);

  const openingDepositDebits = depositLedgerEntries
    .filter((entry) => entry.date < args.from)
    .reduce((sum, entry) => sum + entry.debit, 0);

  const openingDepositCredits = depositLedgerEntries
    .filter((entry) => entry.date < args.from)
    .reduce((sum, entry) => sum + entry.credit, 0);

  const openingBalance = roundMoney(openingDebit + openingDepositDebits - openingPayments - openingCreditNotes - openingDepositCredits);

  const ledgerEntries = [
    ...customerInvoices
      .filter((row) => {
        const issueDate = String(row.issue_date ?? '').slice(0, 10);
        return issueDate >= args.from && issueDate <= args.to;
      })
      .map((row) => {
        const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : null;
        const age = dueDate
          ? Math.max(0, Math.floor((new Date(args.to).getTime() - new Date(dueDate).getTime()) / 86400000))
          : 0;
        return {
          id: `inv-${row.id}`,
          date: String(row.issue_date ?? '').slice(0, 10),
          voucherType: 'Invoice',
          voucherNo: String(row.invoice_number ?? row.id),
          description: row.description ? String(row.description) : `${invoiceModule(row)} invoice`,
          age,
          poNo: '',
          debit: Number(row.total_amount ?? 0),
          credit: 0,
          sourceModule: invoiceModule(row),
          branch: invoiceBranch(row),
          note: row.notes ? String(row.notes) : '',
        };
      }),
    ...customerPayments
      .filter((row) => {
        const paymentDate = String(row.payment_date ?? '').slice(0, 10);
        return paymentDate >= args.from && paymentDate <= args.to;
      })
      .map((row) => ({
        id: `pay-${row.id}`,
        date: String(row.payment_date ?? '').slice(0, 10),
        voucherType: 'Payment',
        voucherNo: String(row.reference ?? row.invoice_number ?? row.id),
        description: `${String(row.payment_method ?? 'Payment')} receipt${row.invoice_number ? ` for ${String(row.invoice_number)}` : ''}`,
        age: 0,
        poNo: '',
        debit: 0,
        credit: Number(row.amount ?? 0),
        sourceModule: String(row.module_key ?? 'FINANCE'),
        branch: String(row.branch ?? 'Unassigned'),
        note: row.notes ? String(row.notes) : '',
      })),
    ...customerCreditNotes
      .filter((row) => {
        const issueDate = String(row.issue_date ?? '').slice(0, 10);
        return issueDate >= args.from && issueDate <= args.to;
      })
      .map((row) => ({
        id: `cn-${row.id}`,
        date: String(row.issue_date ?? '').slice(0, 10),
        voucherType: 'Credit Note',
        voucherNo: String(row.cn_number ?? row.id),
        description: row.reason_detail
          ? `Credit note - ${String(row.reason_detail)}`
          : `Credit note - ${String(row.reason_code ?? 'Adjustment')}`,
        age: 0,
        poNo: String(row.original_invoice_no ?? ''),
        debit: 0,
        credit: Number(row.total_amount ?? 0),
        sourceModule: String(row.module ?? 'FINANCE'),
        branch: creditNoteBranch(row),
        note: row.notes ? String(row.notes) : '',
      })),
    ...depositLedgerEntries.filter((entry) => entry.date >= args.from && entry.date <= args.to),
  ].sort((left, right) =>
    left.date === right.date
      ? left.voucherNo.localeCompare(right.voucherNo)
      : left.date.localeCompare(right.date),
  );

  let runningBalance = openingBalance;
  const ledger = ledgerEntries.map((entry) => {
    runningBalance += entry.debit - entry.credit;
    return { ...entry, runningBalance: roundMoney(runningBalance) };
  });

  const totalDebit = roundMoney(ledger.reduce((sum, entry) => sum + entry.debit, 0));
  const totalCredit = roundMoney(ledger.reduce((sum, entry) => sum + entry.credit, 0));
  const endingBalance = roundMoney(openingBalance + totalDebit - totalCredit);

  const creditByInvoice = new Map<string, number>();
  for (const row of customerCreditNotes) {
    const creditAmount = Number(row.total_amount ?? 0);
    const invoiceKey = String(row.original_invoice_id ?? row.original_invoice_no ?? '').trim();
    if (!invoiceKey) continue;
    creditByInvoice.set(invoiceKey, (creditByInvoice.get(invoiceKey) ?? 0) + creditAmount);
  }

  const outstanding = customerInvoices
    .map((row) => {
      const invoiceDate = String(row.issue_date ?? '').slice(0, 10);
      const dueDate = row.due_date ? String(row.due_date).slice(0, 10) : invoiceDate;
      const creditNoteAmount = Number(creditByInvoice.get(String(row.id)) ?? creditByInvoice.get(String(row.invoice_number ?? '')) ?? 0);
      const outstandingAmount = Math.max(0, Number(row.total_amount ?? 0) - Number(row.paid_amount ?? 0) - creditNoteAmount);
      const ageDays = Math.max(0, Math.floor((new Date(args.to).getTime() - new Date(dueDate).getTime()) / 86400000));
      return {
        id: String(row.id),
        invoiceNumber: String(row.invoice_number ?? row.id),
        invoiceDate,
        dueDate,
        sourceModule: invoiceModule(row),
        branch: invoiceBranch(row),
        description: row.description ? String(row.description) : `${invoiceModule(row)} invoice`,
        totalAmount: Number(row.total_amount ?? 0),
        paidAmount: Number(row.paid_amount ?? 0),
        creditNoteAmount,
        outstandingAmount,
        ageDays,
        status: String(row.payment_status ?? 'DRAFT'),
      };
    })
    .filter((row) => row.outstandingAmount > 0)
    .sort((left, right) => right.ageDays - left.ageDays);

  const outstandingSummary = {
    totalOutstanding: roundMoney(outstanding.reduce((sum, row) => sum + row.outstandingAmount, 0)),
    current: roundMoney(outstanding.filter((row) => row.ageDays <= 0).reduce((sum, row) => sum + row.outstandingAmount, 0)),
    d1to30: roundMoney(outstanding.filter((row) => row.ageDays >= 1 && row.ageDays <= 30).reduce((sum, row) => sum + row.outstandingAmount, 0)),
    d31to60: roundMoney(outstanding.filter((row) => row.ageDays >= 31 && row.ageDays <= 60).reduce((sum, row) => sum + row.outstandingAmount, 0)),
    d61to90: roundMoney(outstanding.filter((row) => row.ageDays >= 61 && row.ageDays <= 90).reduce((sum, row) => sum + row.outstandingAmount, 0)),
    d90plus: roundMoney(outstanding.filter((row) => row.ageDays > 90).reduce((sum, row) => sum + row.outstandingAmount, 0)),
  };

  const depositRows = customerDeposits.map((row) => ({
    id: String(row.id),
    depositNo: String(row.deposit_no ?? row.id),
    type: String(row.contract_type ?? 'LEASE'),
    date: row.collection_date ? String(row.collection_date).slice(0, 10) : '',
    agreement: String(row.contract_id ?? ''),
    amount: Number(row.collected_amount ?? 0),
    used: Number(row.total_deducted ?? 0),
    refunded: Number(row.refund_amount ?? 0),
    refundDate: row.refund_date ? String(row.refund_date).slice(0, 10) : '',
    status: String(row.status ?? 'HELD'),
    branch: String(row.branch ?? 'Unassigned'),
    vehicleNo: String(row.vehicle_no ?? ''),
  }));

  return {
    customer,
    filters: {
      from: args.from,
      to: args.to,
      includeInactive,
      view,
      module: moduleFilter,
      branch: branchFilter,
    },
    availableFilters: filterOptions,
    ledger: {
      entries: ledger,
      openingBalance,
      totalDebit,
      totalCredit,
      endingBalance,
    },
    outstanding: {
      invoices: outstanding,
      summary: outstandingSummary,
    },
    deposits: depositRows,
  };
}
