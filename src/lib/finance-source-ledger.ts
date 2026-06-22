import { prisma } from '@/lib/prisma';
import { ensureLeaseContractTenantColumn } from '@/lib/leasing-governance';

type LeaseInvoiceForMirror = Awaited<ReturnType<typeof loadLeaseInvoiceForMirror>>;

const SOURCE_MODULE_LEASING = 'LEASING';
const SOURCE_ENTITY_LEASE_INVOICE = 'LEASE_INVOICE';
const FINANCE_STATUS_EQUIVALENT: Record<string, string> = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
  VOID: 'CANCELLED',
};

export async function ensureFinanceSourceLedger() {
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
      module_source    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at       TIMESTAMPTZ
    )
  `);

  await Promise.all([
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS module_source TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_type TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_id TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_entity_no TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_customer_id TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_customer_name TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_contract_ids TEXT[]`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS source_payload JSONB NOT NULL DEFAULT '{}'::jsonb`),
    prisma.$executeRawUnsafe(`ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS line_items_json JSONB`),
    prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_finance_invoices_source
        ON finance_invoices(module_source, reference_type, reference_id)
        WHERE deleted_at IS NULL
    `),
    prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_finance_invoices_source_entity
        ON finance_invoices(source_entity_type, source_entity_id)
        WHERE deleted_at IS NULL
    `),
  ]);
}

async function loadLeaseInvoiceForMirror(invoiceId: string) {
  return prisma.leaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lessee: { select: { id: true, name: true, email: true, phone: true } },
      lines: true,
    },
  });
}

function toDateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toISOString().split('T')[0];
}

function lineItems(invoice: NonNullable<LeaseInvoiceForMirror>) {
  return invoice.lines.map(line => ({
    description: line.description,
    qty: Number(line.quantity ?? 1),
    unitPrice: Number(line.unitAmount ?? 0),
    amount: Number(line.totalAmount ?? 0),
    lineType: line.lineType,
    contractId: line.contractId,
    vehicleRef: line.vehicleRef,
    sourceModule: SOURCE_MODULE_LEASING,
  }));
}

export async function mirrorLeaseInvoiceToFinance(invoiceId: string, tenantId: string, actor = 'system') {
  await ensureFinanceSourceLedger();

  const invoice = await loadLeaseInvoiceForMirror(invoiceId);
  if (!invoice) return { mirrored: false, reason: 'lease_invoice_not_found' };

  const lines = lineItems(invoice);
  const contractIds = Array.from(new Set(invoice.lines.map(line => line.contractId).filter(Boolean))) as string[];
  const invoiceNo = invoice.invoiceNo ?? invoice.id;
  const financeInvoiceNo = `LSE-${invoiceNo.replace(/^INV-/, '')}`;
  const status = invoice.status ?? 'DRAFT';
  const subtotal = Number(invoice.subTotal ?? 0);
  const vatAmount = Number(invoice.vatAmount ?? 0);
  const totalAmount = Number(invoice.totalAmount ?? 0);
  const paidAmount = status === 'PAID' ? totalAmount : 0;
  const currency = invoice.currency ?? 'AED';
  const issueDate = toDateOnly(invoice.issueDate) ?? new Date().toISOString().split('T')[0];
  const dueDate = toDateOnly(invoice.dueDate);
  const payload = {
    leaseInvoiceId: invoice.id,
    leaseInvoiceNo: invoice.invoiceNo,
    billingPeriod: invoice.billingPeriod,
    contractIds,
    status,
  };

  type Existing = { id: string };
  const [existing] = await prisma.$queryRawUnsafe<Existing[]>(
    `SELECT id
       FROM finance_invoices
      WHERE deleted_at IS NULL
        AND module_source = $1
        AND reference_type = $2
        AND reference_id::text = $3
      LIMIT 1`,
    SOURCE_MODULE_LEASING,
    SOURCE_ENTITY_LEASE_INVOICE,
    invoice.id,
  );

  if (existing?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET client_name = $2,
              client_email = $3,
              client_phone = $4,
              service_type = 'LEASING',
              module = 'LEASING',
              module_source = $5,
              description = $6,
              line_items = $7::jsonb,
              line_items_json = $7::jsonb,
              subtotal = $8,
              vat_amount = $9,
              total_amount = $10,
              paid_amount = $11,
              currency = $12,
              issue_date = $13::date,
              due_date = $14::date,
              payment_status = $15,
              notes = $16,
              tenant_id = $17,
              source_entity_type = $18,
              source_entity_id = $19,
              source_entity_no = $20,
              source_customer_id = $21,
              source_customer_name = $22,
              source_contract_ids = $23::text[],
              source_payload = $24::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      existing.id,
      invoice.lessee?.name ?? invoice.lesseeId,
      invoice.lessee?.email ?? null,
      invoice.lessee?.phone ?? null,
      SOURCE_MODULE_LEASING,
      `Vehicle Leasing invoice ${invoiceNo}`,
      JSON.stringify(lines),
      subtotal,
      vatAmount,
      totalAmount,
      paidAmount,
      currency,
      issueDate,
      dueDate,
      status,
      invoice.notes ?? null,
      tenantId,
      SOURCE_ENTITY_LEASE_INVOICE,
      invoice.id,
      invoiceNo,
      invoice.lesseeId,
      invoice.lessee?.name ?? null,
      contractIds,
      JSON.stringify(payload),
    );
    return { mirrored: true, mode: 'updated', financeInvoiceId: existing.id };
  }

  type Inserted = { id: string };
  const [inserted] = await prisma.$queryRawUnsafe<Inserted[]>(
    `INSERT INTO finance_invoices
       (invoice_number, client_name, client_email, client_phone,
        service_type, module, module_source, description,
        line_items, line_items_json, subtotal, discount_amount, vat_rate,
        vat_amount, total_amount, paid_amount, currency, issue_date, due_date,
        payment_status, notes, reference_id, reference_type, created_by, tenant_id,
        source_entity_type, source_entity_id, source_entity_no,
        source_customer_id, source_customer_name, source_contract_ids, source_payload)
     VALUES
       ($1,$2,$3,$4,
        'LEASING','LEASING',$5,$6,
        $7::jsonb,$7::jsonb,$8,0,$9,
        $10,$11,$12,$13,$14::date,$15::date,
        $16,$17,$18::uuid,$19,$20,$21,
        $22,$23,$24,$25,$26,$27::text[],$28::jsonb)
     RETURNING id`,
    financeInvoiceNo,
    invoice.lessee?.name ?? invoice.lesseeId,
    invoice.lessee?.email ?? null,
    invoice.lessee?.phone ?? null,
    SOURCE_MODULE_LEASING,
    `Vehicle Leasing invoice ${invoiceNo}`,
    JSON.stringify(lines),
    subtotal,
    Number(invoice.vatPct ?? 5),
    vatAmount,
    totalAmount,
    paidAmount,
    currency,
    issueDate,
    dueDate,
    status,
    invoice.notes ?? null,
    invoice.id,
    SOURCE_ENTITY_LEASE_INVOICE,
    actor,
    tenantId,
    SOURCE_ENTITY_LEASE_INVOICE,
    invoice.id,
    invoiceNo,
    invoice.lesseeId,
    invoice.lessee?.name ?? null,
    contractIds,
    JSON.stringify(payload),
  );

  return { mirrored: true, mode: 'created', financeInvoiceId: inserted?.id };
}

export async function getFinanceMirrorById(financeInvoiceId: string) {
  type FinanceMirror = Record<string, unknown> & { id: string };
  const [row] = await prisma.$queryRawUnsafe<FinanceMirror[]>(
    `SELECT id::text, tenant_id, module_source, reference_type, reference_id::text,
            source_entity_type, source_entity_id, source_entity_no,
            source_customer_id, source_customer_name, source_contract_ids,
            payment_status, total_amount, notes, created_at::text, updated_at::text
       FROM finance_invoices
      WHERE id::text = $1
      LIMIT 1`,
    financeInvoiceId,
  ).catch(() => [] as FinanceMirror[]);
  return row ?? null;
}

export async function getLeasingBillingReconciliation(tenantId: string) {
  await ensureFinanceSourceLedger();
  await ensureLeaseContractTenantColumn();

  type LeaseRow = {
    id: string;
    invoice_no: string | null;
    lessee_id: string;
    lessee_name: string | null;
    status: string | null;
    total_amount: string | number;
    created_at: Date | string | null;
  };
  type FinanceRow = {
    id: string;
    reference_id: string | null;
    payment_status: string | null;
    total_amount: string | number;
    source_entity_no: string | null;
    tenant_id: string | null;
    source_entity_id: string | null;
  };
  type GlobalLeaseRow = { id: string; tenant_id: string | null };
  type DuplicateRow = { reference_id: string | null; count: bigint };

  const leaseInvoices = await prisma.$queryRawUnsafe<LeaseRow[]>(
    `SELECT DISTINCT li.id, li.invoice_no, li.lessee_id, l.name AS lessee_name,
            li.status, li.total_amount, li.created_at
       FROM lease_invoices li
       JOIN lease_invoice_lines lil ON lil.invoice_id = li.id
       JOIN lease_contracts_v2 lc ON lc.id = lil.contract_id
       LEFT JOIN lessees l ON l.id = li.lessee_id
      WHERE lc.tenant_id = $1
      ORDER BY li.created_at DESC NULLS LAST`,
    tenantId,
  ).catch(() => [] as LeaseRow[]);

  const financeRows = await prisma.$queryRawUnsafe<FinanceRow[]>(
    `SELECT id::text, reference_id::text, payment_status, total_amount, source_entity_no, tenant_id, source_entity_id
       FROM finance_invoices
      WHERE deleted_at IS NULL
        AND tenant_id = $1
        AND module_source = $2
        AND reference_type = $3`,
    tenantId,
    SOURCE_MODULE_LEASING,
    SOURCE_ENTITY_LEASE_INVOICE,
  ).catch(() => [] as FinanceRow[]);

  const globalLeaseInvoices = await prisma.$queryRawUnsafe<GlobalLeaseRow[]>(
    `SELECT DISTINCT li.id::text, lc.tenant_id::text
       FROM lease_invoices li
       JOIN lease_invoice_lines lil ON lil.invoice_id = li.id
       JOIN lease_contracts_v2 lc ON lc.id = lil.contract_id`,
  ).catch(() => [] as GlobalLeaseRow[]);

  const duplicateRows = await prisma.$queryRawUnsafe<DuplicateRow[]>(
    `SELECT reference_id::text AS reference_id, COUNT(*)::bigint AS count
       FROM finance_invoices
      WHERE deleted_at IS NULL
        AND tenant_id = $1
        AND module_source = $2
        AND reference_type = $3
      GROUP BY reference_id
      HAVING COUNT(*) > 1`,
    tenantId,
    SOURCE_MODULE_LEASING,
    SOURCE_ENTITY_LEASE_INVOICE,
  ).catch(() => [] as DuplicateRow[]);

  const financeByReference = new Map(financeRows.map(row => [row.reference_id, row]));
  const duplicateMap = new Map(duplicateRows.map(row => [row.reference_id, Number(row.count)]));
  const globalLeaseMap = new Map(globalLeaseInvoices.map(row => [row.id, row.tenant_id]));
  const leaseInvoiceIds = new Set(leaseInvoices.map(invoice => invoice.id));
  const rows = leaseInvoices.map(invoice => {
    const mirror = financeByReference.get(invoice.id);
    const leaseTotal = Number(invoice.total_amount ?? 0);
    const financeTotal = mirror ? Number(mirror.total_amount ?? 0) : null;
    const canonicalLeasingStatus = invoice.status ? FINANCE_STATUS_EQUIVALENT[invoice.status] ?? invoice.status : null;
    const statusMatches = mirror ? canonicalLeasingStatus === (mirror.payment_status ?? null) : false;
    return {
      leaseInvoiceId: invoice.id,
      invoiceNo: invoice.invoice_no,
      lesseeId: invoice.lessee_id,
      lesseeName: invoice.lessee_name,
      leasingStatus: invoice.status,
      financeStatus: mirror?.payment_status ?? null,
      leaseTotal,
      financeTotal,
      financeInvoiceId: mirror?.id ?? null,
      mirrored: Boolean(mirror),
      statusMatches,
      duplicateMirrors: duplicateMap.get(invoice.id) ?? 0,
      totalMatches: mirror ? Math.abs(leaseTotal - Number(financeTotal ?? 0)) < 0.01 : false,
    };
  });

  const orphanFinanceMirrors = financeRows
    .filter(row => !row.reference_id || !leaseInvoiceIds.has(row.reference_id))
    .map(row => {
      const globalTenant = row.reference_id ? globalLeaseMap.get(row.reference_id) : null;
      return {
        financeInvoiceId: row.id,
        referenceId: row.reference_id,
        financeStatus: row.payment_status,
        financeTotal: Number(row.total_amount ?? 0),
        issue: globalTenant && globalTenant !== tenantId ? 'TENANT_MISMATCH' : 'ORPHAN',
        leaseTenantId: globalTenant ?? null,
      };
    });

  return {
    tenantId,
    sourceModule: SOURCE_MODULE_LEASING,
    totalLeasingInvoices: leaseInvoices.length,
    mirroredInvoices: rows.filter(row => row.mirrored).length,
    missingFinanceMirror: rows.filter(row => !row.mirrored).length,
    totalMismatches: rows.filter(row => row.mirrored && (!row.totalMatches || !row.statusMatches)).length,
    statusMismatches: rows.filter(row => row.mirrored && !row.statusMatches).length,
    duplicateMirrors: duplicateRows.reduce((sum, row) => sum + Number(row.count) - 1, 0),
    orphanFinanceMirrors: orphanFinanceMirrors.filter(row => row.issue === 'ORPHAN').length,
    tenantMismatches: orphanFinanceMirrors.filter(row => row.issue === 'TENANT_MISMATCH').length,
    orphanRows: orphanFinanceMirrors,
    rows,
  };
}
