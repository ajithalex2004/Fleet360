/**
 * Finance module ledger — canonical write path for all domain → finance_invoices mirrors.
 *
 * Every module (Leasing, Maintenance, Rental, Logistics) that generates billable
 * events uses this file to upsert a mirror row into finance_invoices so the Finance
 * hub has a single-table view of all revenue.
 *
 * Upsert key: (module_source, reference_type, reference_id) — always idempotent.
 *
 * Supersedes src/lib/finance-source-ledger.ts (deleted 2026-08-10).
 */

import { prisma } from '@/lib/prisma';
import { ensureLeaseContractTenantColumn } from '@/lib/leasing-governance';
import { createDraftJournalEntry } from '@/lib/finance/journal-service';

// ── Status mapping (Leasing → Finance) ────────────────────────────────────────

const LEASING_STATUS_MAP: Record<string, string> = {
  DRAFT:     'DRAFT',
  SENT:      'SENT',
  PAID:      'PAID',
  OVERDUE:   'OVERDUE',
  CANCELLED: 'CANCELLED',
  VOID:      'CANCELLED',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateOnly(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString().split('T')[0];
  return new Date(v).toISOString().split('T')[0];
}

// ── Canonical upsert interface ─────────────────────────────────────────────────

export type ModuleLedgerParams = {
  tenantId: string;
  moduleSource: string;
  referenceType: string;
  /** TEXT — UUID-shaped strings are accepted without an explicit cast. */
  referenceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  serviceType: string;
  description: string;
  lineItems: object[];
  subtotal: number;
  discountAmount?: number;
  vatRate?: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount?: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string | null;
  paymentStatus: string;
  notes?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  sourceEntityNo?: string | null;
  sourceCustomerId?: string | null;
  sourceCustomerName?: string | null;
  /** Used by Leasing only; pass null/undefined for all other modules. */
  sourceContractIds?: string[] | null;
  sourcePayload?: object;
  actor?: string;
};

export type ModuleLedgerResult = {
  financeInvoiceId: string;
  mode: 'created' | 'updated';
};

// ── Core upsert (one SQL path for every module) ───────────────────────────────

export async function upsertFinanceInvoice(p: ModuleLedgerParams): Promise<ModuleLedgerResult> {
  const lineItemsJson     = JSON.stringify(p.lineItems);
  const sourcePayloadJson = JSON.stringify(p.sourcePayload ?? {});
  const issueDate         = p.issueDate       ?? toDateOnly(new Date());
  const currency          = p.currency        ?? 'AED';
  const vatRate           = p.vatRate         ?? 5;
  const discountAmount    = p.discountAmount  ?? 0;
  const paidAmount        = p.paidAmount      ?? 0;
  const sourceContractIds = p.sourceContractIds ?? null;

  type Row = { id: string };

  // Lookup keyed on (module_source, reference_type, reference_id).
  // Cast reference_id::text so comparison works whether the column is UUID or TEXT.
  const [existing] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id FROM finance_invoices
      WHERE deleted_at IS NULL
        AND module_source       = $1
        AND reference_type      = $2
        AND reference_id::text  = $3
      LIMIT 1`,
    p.moduleSource,
    p.referenceType,
    p.referenceId,
  );

  if (existing?.id) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_invoices
          SET client_name          = $2,
              client_email         = $3,
              client_phone         = $4,
              service_type         = $5,
              module               = $6,
              module_source        = $6,
              description          = $7,
              line_items           = $8::jsonb,
              line_items_json      = $8::jsonb,
              subtotal             = $9,
              discount_amount      = $10,
              vat_rate             = $11,
              vat_amount           = $12,
              total_amount         = $13,
              paid_amount          = $14,
              currency             = $15,
              issue_date           = $16::date,
              due_date             = $17::date,
              payment_status       = $18,
              notes                = $19,
              tenant_id            = $20,
              source_entity_type   = $21,
              source_entity_id     = $22,
              source_entity_no     = $23,
              source_customer_id   = $24,
              source_customer_name = $25,
              source_contract_ids  = $26::text[],
              source_payload       = $27::jsonb,
              updated_at           = NOW()
        WHERE id = $1`,
      existing.id,
      p.clientName, p.clientEmail ?? null, p.clientPhone ?? null,
      p.serviceType, p.moduleSource, p.description,
      lineItemsJson,
      p.subtotal, discountAmount, vatRate, p.vatAmount, p.totalAmount, paidAmount,
      currency, issueDate, p.dueDate ?? null,
      p.paymentStatus, p.notes ?? null,
      p.tenantId,
      p.sourceEntityType ?? null, p.sourceEntityId ?? null, p.sourceEntityNo ?? null,
      p.sourceCustomerId ?? null, p.sourceCustomerName ?? null,
      sourceContractIds,
      sourcePayloadJson,
    );
    return { financeInvoiceId: existing.id, mode: 'updated' };
  }

  const [inserted] = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO finance_invoices
       (invoice_number, client_name, client_email, client_phone,
        service_type, module, module_source, description,
        line_items, line_items_json, subtotal, discount_amount, vat_rate,
        vat_amount, total_amount, paid_amount, currency,
        issue_date, due_date, payment_status, notes,
        reference_id, reference_type, created_by, tenant_id,
        source_entity_type, source_entity_id, source_entity_no,
        source_customer_id, source_customer_name, source_contract_ids, source_payload)
     VALUES
       ($1,$2,$3,$4,
        $5,$5,$5,$6,
        $7::jsonb,$7::jsonb,$8,$9,$10,
        $11,$12,$13,$14,
        $15::date,$16::date,$17,$18,
        $19,$20,$21,$22,
        $23,$24,$25,$26,$27,$28::text[],$29::jsonb)
     RETURNING id`,
    p.invoiceNumber, p.clientName, p.clientEmail ?? null, p.clientPhone ?? null,
    p.moduleSource, p.description,
    lineItemsJson, p.subtotal, discountAmount, vatRate,
    p.vatAmount, p.totalAmount, paidAmount, currency,
    issueDate, p.dueDate ?? null, p.paymentStatus, p.notes ?? null,
    p.referenceId, p.referenceType, p.actor ?? 'system', p.tenantId,
    p.sourceEntityType ?? null, p.sourceEntityId ?? null, p.sourceEntityNo ?? null,
    p.sourceCustomerId ?? null, p.sourceCustomerName ?? null,
    sourceContractIds,
    sourcePayloadJson,
  );

  return { financeInvoiceId: inserted!.id, mode: 'created' };
}

// ── Leasing ────────────────────────────────────────────────────────────────────

/**
 * Mirror a lease invoice into finance_invoices.
 *
 * Call whenever a LeaseInvoice is created or its status/amounts change.
 * Safe to call multiple times — upsert is keyed on
 * (module_source='LEASING', reference_type='LEASE_INVOICE', reference_id=invoiceId).
 */
export async function mirrorLeaseInvoiceToFinance(
  invoiceId: string,
  tenantId: string,
  actor = 'system',
): Promise<{ mirrored: boolean; financeInvoiceId?: string; mode?: string; reason?: string }> {

  const invoice = await prisma.leaseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lessee: { select: { id: true, name: true, email: true, phone: true } },
      lines:  true,
    },
  });
  if (!invoice) return { mirrored: false, reason: 'lease_invoice_not_found' };

  const invoiceNo       = (invoice as any).invoiceNo ?? invoice.id;
  const financeInvoiceNo = `LSE-${invoiceNo.replace(/^INV-/, '')}`;
  const status          = LEASING_STATUS_MAP[(invoice as any).status ?? ''] ?? (invoice as any).status ?? 'DRAFT';
  const subtotal        = Number((invoice as any).subTotal    ?? 0);
  const vatAmount       = Number((invoice as any).vatAmount   ?? 0);
  const totalAmount     = Number((invoice as any).totalAmount ?? 0);
  const paidAmount      = status === 'PAID' ? totalAmount : 0;
  const currency        = (invoice as any).currency ?? 'AED';
  const vatRate         = Number((invoice as any).vatPct ?? 5);

  const contractIds = Array.from(
    new Set((invoice.lines as any[]).map(l => l.contractId).filter(Boolean)),
  ) as string[];

  const lineItems = (invoice.lines as any[]).map(line => ({
    description:  line.description,
    qty:          Number(line.quantity  ?? 1),
    unitPrice:    Number(line.unitAmount ?? 0),
    amount:       Number(line.totalAmount ?? 0),
    lineType:     line.lineType,
    contractId:   line.contractId,
    vehicleRef:   line.vehicleRef,
    sourceModule: 'LEASING',
  }));

  const result = await upsertFinanceInvoice({
    tenantId,
    moduleSource:      'LEASING',
    referenceType:     'LEASE_INVOICE',
    referenceId:       invoice.id,
    invoiceNumber:     financeInvoiceNo,
    clientName:        (invoice as any).lessee?.name ?? (invoice as any).lesseeId,
    clientEmail:       (invoice as any).lessee?.email ?? null,
    clientPhone:       (invoice as any).lessee?.phone ?? null,
    serviceType:       'LEASING',
    description:       `Vehicle Leasing invoice ${invoiceNo}`,
    lineItems,
    subtotal,
    vatRate,
    vatAmount,
    totalAmount,
    paidAmount,
    currency,
    issueDate:         toDateOnly((invoice as any).issueDate),
    dueDate:           (invoice as any).dueDate ? toDateOnly((invoice as any).dueDate) : null,
    paymentStatus:     status,
    notes:             (invoice as any).notes ?? null,
    sourceEntityType:  'LEASE_INVOICE',
    sourceEntityId:    invoice.id,
    sourceEntityNo:    invoiceNo,
    sourceCustomerId:  (invoice as any).lesseeId,
    sourceCustomerName:(invoice as any).lessee?.name ?? null,
    sourceContractIds: contractIds,
    sourcePayload: {
      leaseInvoiceId: invoice.id,
      leaseInvoiceNo: (invoice as any).invoiceNo,
      billingPeriod:  (invoice as any).billingPeriod,
      contractIds,
      status:         (invoice as any).status,
    },
    actor,
  });

  return { mirrored: true, ...result };
}

// ── Maintenance ───────────────────────────────────────────────────────────────

/**
 * Post a completed/closed maintenance work order to Finance.
 *
 * Creates two Finance entries — both idempotent, both best-effort:
 *   1. AP payable (finance.finance_payables) — garage is a vendor, this is
 *      an expense liability, NOT revenue. Source lineage: MAINTENANCE_REQUEST.
 *   2. DRAFT journal entry — debit GL5100 (Maintenance Expense) /
 *      credit GL2100 (Accounts Payable / Accrued), cost_centre = PC-MAINTENANCE.
 *
 * Returns the IDs of both entries so the caller can write them back to the MR row.
 */
export async function mirrorMaintenanceToFinance(
  requestId: string,
  tenantId:  string,
  actor = 'system',
): Promise<{
  mirrored:          boolean;
  financePayableId?: string;
  payableNumber?:    string;
  journalEntryId?:   string;
  journalEntryNo?:   string;
  reason?:           string;
}> {
  const req = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: { Vehicle: true, Garage: true },
  });
  if (!req) return { mirrored: false, reason: 'maintenance_request_not_found' };

  const cost = Number((req as any).actualCost ?? (req as any).estimatedCost ?? 0);
  if (cost <= 0) return { mirrored: false, reason: 'no_billable_cost' };

  const vatAmount  = parseFloat((cost * 0.05).toFixed(2));
  const total      = parseFloat((cost + vatAmount).toFixed(2));
  const garageName = (req as any).Garage?.name ?? 'Workshop';
  const garageId   = (req as any).Garage?.id   ?? null;
  const vehicleRef = (req as any).Vehicle?.registrationNo ?? req.vehicleId ?? 'N/A';
  const workOrderNo = (req as any).workOrderNo ?? req.id;
  const description = `Maintenance: ${(req as any).maintenanceType ?? 'SERVICE'} — ${vehicleRef}`;
  const issueDate   = new Date().toISOString().slice(0, 10);

  // ── 1. AP Payable ─────────────────────────────────────────────────────────
  // Idempotent: skip if a payable already exists for this source_id.
  const [existingAP] = await prisma.$queryRawUnsafe<Array<{ id: string; payable_number: string }>>(
    `SELECT id::text, payable_number FROM finance.finance_payables
      WHERE source_type = 'MAINTENANCE_REQUEST' AND source_id = $1 LIMIT 1`,
    req.id,
  ).catch(() => []);

  let financePayableId = existingAP?.id;
  let payableNumber    = existingAP?.payable_number;

  if (!financePayableId) {
    const ym  = issueDate.slice(0, 7).replace('-', '');
    const [seqRow] = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE payable_number LIKE $1`,
      `AP-${ym}-%`,
    ).catch(() => [{ count: 0 }]);
    payableNumber = `AP-${ym}-${String(Number(seqRow?.count ?? 0) + 1).padStart(5, '0')}`;

    const [apRow] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO finance.finance_payables
         (payable_number, vendor_id, vendor_name, module,
          source_type, source_id, description, line_items,
          subtotal, vat_amount, total_amount, currency,
          issue_date, cost_centre, profit_centre,
          status, payment_status, prepared_by, tenant_id)
       VALUES ($1,$2,$3,'MAINTENANCE',
               'MAINTENANCE_REQUEST',$4,$5,$6::jsonb,
               $7,$8,$9,'AED',
               $10::date,'PC-MAINTENANCE','PC-MAINTENANCE',
               'DRAFT','UNPAID',$11,$12)
       RETURNING id::text`,
      payableNumber,
      garageId,
      garageName,
      req.id,
      description,
      JSON.stringify([{
        description, qty: 1, unitPrice: cost, amount: cost,
        vehicleRef, workOrderNo, sourceModule: 'MAINTENANCE',
      }]),
      cost, vatAmount, total,
      issueDate,
      actor,
      tenantId,
    ).catch(() => []);

    financePayableId = apRow?.id;
  }

  // ── 2. DRAFT Journal Entry ────────────────────────────────────────────────
  // Idempotent: skip if a JE already exists for this source.
  const [existingJE] = await prisma.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
    `SELECT id::text, je_number FROM finance_journal_entries
      WHERE source_type = 'MAINTENANCE_REQUEST' AND source_id::text = $1 LIMIT 1`,
    req.id,
  ).catch(() => []);

  let journalEntryId = existingJE?.id;
  let journalEntryNo = existingJE?.je_number;

  if (!journalEntryId) {
    try {
      const je = await createDraftJournalEntry({
        tenantId,
        narration:   description,
        reference:   workOrderNo,
        sourceType:  'MAINTENANCE_REQUEST',
        sourceId:    req.id,
        amount:      cost,
        currency:    'AED',
        preparedBy:  actor,
        costCentre:  'PC-MAINTENANCE',
        notes:       `Auto-generated on MR ${workOrderNo} completion. Vehicle: ${vehicleRef}`,
        debit:  { code: '5100', name: 'Maintenance Expense',             description },
        credit: { code: '2100', name: 'Accounts Payable / Accrued Exp.', description: `Accrual: ${workOrderNo}` },
      });
      journalEntryId = je.id;
      journalEntryNo = je.number;
    } catch (err) {
      console.warn('[maintenance] createDraftJournalEntry failed:', err);
    }
  }

  return {
    mirrored:        true,
    financePayableId,
    payableNumber,
    journalEntryId,
    journalEntryNo,
  };
}

// ── Rental ─────────────────────────────────────────────────────────────────────

/**
 * Mirror a rental invoice into finance_invoices.
 *
 * Call immediately after inserting a rental_invoice row in
 * /api/rental/agreements/:id/generate-invoice.
 */
export async function mirrorRentalInvoiceToFinance(
  rentalInvoiceId: string,
  tenantId: string,
  actor = 'system',
): Promise<{ mirrored: boolean; financeInvoiceId?: string; mode?: string; reason?: string }> {
  type RentalRow = {
    id: string; invoice_no: string; agreement_id: string;
    customer_id: string | null; total_amount: string | number;
    subtotal: string | number; tax_amount: string | number;
    tax_rate: string | number; discount_amount: string | number;
    currency: string | null; status: string | null;
    invoice_date: string | null; due_date: string | null; notes: string | null;
  };
  type CustomerRow = { id: string; name: string | null; email: string | null; phone: string | null };

  const [inv] = await prisma.$queryRawUnsafe<RentalRow[]>(
    `SELECT id, invoice_no, agreement_id, customer_id, total_amount, subtotal,
            tax_amount, tax_rate, discount_amount, currency, status,
            invoice_date, due_date, notes
       FROM rental_invoices WHERE id = $1 LIMIT 1`,
    rentalInvoiceId,
  );
  if (!inv) return { mirrored: false, reason: 'rental_invoice_not_found' };

  let customer: CustomerRow | undefined;
  if (inv.customer_id) {
    const [c] = await prisma.$queryRawUnsafe<CustomerRow[]>(
      `SELECT id, name, email, phone FROM customers WHERE id = $1 LIMIT 1`,
      inv.customer_id,
    );
    customer = c;
  }

  const total     = Number(inv.total_amount ?? 0);
  const subtotal  = Number(inv.subtotal ?? 0);
  const vatAmount = Number(inv.tax_amount ?? 0);
  const vatRate   = Number(inv.tax_rate ?? 5);
  const discount  = Number(inv.discount_amount ?? 0);
  const paid      = inv.status === 'PAID' ? total : 0;

  const result = await upsertFinanceInvoice({
    tenantId,
    moduleSource:      'RENTAL',
    referenceType:     'RENTAL_INVOICE',
    referenceId:       inv.id,
    invoiceNumber:     `RNT-${inv.invoice_no.replace(/^RINV-/, '')}`,
    clientName:        customer?.name ?? inv.customer_id ?? 'Rental Customer',
    clientEmail:       customer?.email,
    clientPhone:       customer?.phone,
    serviceType:       'RENTAL',
    description:       `Rental Invoice ${inv.invoice_no} — Agreement ${inv.agreement_id}`,
    lineItems: [{
      description:  `Vehicle Rental — ${inv.invoice_no}`,
      qty:          1,
      unitPrice:    subtotal,
      amount:       subtotal,
      lineType:     'RENTAL',
      agreementId:  inv.agreement_id,
      sourceModule: 'RENTAL',
    }],
    subtotal,
    discountAmount: discount,
    vatRate,
    vatAmount,
    totalAmount:   total,
    paidAmount:    paid,
    currency:      inv.currency ?? 'AED',
    issueDate:     toDateOnly(inv.invoice_date),
    dueDate:       inv.due_date ? toDateOnly(inv.due_date) : null,
    paymentStatus: inv.status ?? 'DRAFT',
    notes:         inv.notes,
    sourceEntityType:   'RENTAL_INVOICE',
    sourceEntityId:     inv.id,
    sourceEntityNo:     inv.invoice_no,
    sourceCustomerId:   inv.customer_id,
    sourceCustomerName: customer?.name ?? null,
    sourcePayload: {
      rentalInvoiceId: inv.id,
      invoiceNo:       inv.invoice_no,
      agreementId:     inv.agreement_id,
      status:          inv.status,
    },
    actor,
  });

  return { mirrored: true, ...result };
}

// ── Logistics ──────────────────────────────────────────────────────────────────

/**
 * Mirror a shipment's customer-side freight charges into finance_invoices
 * when the shipment reaches CLOSED (or any terminal status with charges).
 *
 * Call from the shipment status PATCH handler when next === 'CLOSED'.
 */
export async function mirrorLogisticsShipmentToFinance(
  shipmentOrderId: string,
  tenantId: string,
  actor = 'system',
): Promise<{ mirrored: boolean; financeInvoiceId?: string; mode?: string; reason?: string }> {
  type ShipmentRow = {
    id: string; shipment_no: string | null;
    cargo_owner_customer_id: string | null;
    cargo_owner_name: string | null; cargo_owner_email: string | null;
    cargo_owner_phone: string | null;
    status: string | null; currency: string | null;
    origin_name: string | null; destination_name: string | null;
  };
  type ChargeRow = {
    id: string; charge_side: string; charge_type: string;
    description: string | null; quantity: string | number | null;
    unit_rate: string | number | null; amount: string | number | null;
    tax_amount: string | number | null; total_amount: string | number | null;
    currency: string | null;
  };

  const [shipment] = await prisma.$queryRawUnsafe<ShipmentRow[]>(
    `SELECT id, shipment_no, cargo_owner_customer_id, cargo_owner_name,
            cargo_owner_email, cargo_owner_phone, status, currency,
            origin_name, destination_name
       FROM logistics_shipment_orders WHERE id = $1 LIMIT 1`,
    shipmentOrderId,
  );
  if (!shipment) return { mirrored: false, reason: 'shipment_not_found' };

  const charges = await prisma.$queryRawUnsafe<ChargeRow[]>(
    `SELECT id, charge_side, charge_type, description, quantity, unit_rate,
            amount, tax_amount, total_amount, currency
       FROM logistics_freight_charges
      WHERE shipment_order_id = $1
        AND charge_side = 'CUSTOMER'
        AND deleted_at IS NULL`,
    shipmentOrderId,
  );
  if (!charges.length) return { mirrored: false, reason: 'no_customer_charges' };

  const lineItems = charges.map(c => ({
    description:  c.description ?? c.charge_type,
    qty:          Number(c.quantity ?? 1),
    unitPrice:    Number(c.unit_rate ?? c.amount ?? 0),
    amount:       Number(c.amount ?? 0),
    lineType:     c.charge_type,
    sourceModule: 'LOGISTICS',
  }));

  const subtotal   = lineItems.reduce((s, l) => s + l.amount, 0);
  const vatAmount  = parseFloat((subtotal * 0.05).toFixed(2));
  const total      = parseFloat((subtotal + vatAmount).toFixed(2));
  const invoiceNo  = `LOG-${(shipment.shipment_no ?? shipmentOrderId).replace(/^SHP-/, '')}`;
  const route      = [shipment.origin_name, shipment.destination_name].filter(Boolean).join(' → ');

  const result = await upsertFinanceInvoice({
    tenantId,
    moduleSource:      'LOGISTICS',
    referenceType:     'LOGISTICS_SHIPMENT',
    referenceId:       shipmentOrderId,
    invoiceNumber:     invoiceNo,
    clientName:        shipment.cargo_owner_name ?? 'Cargo Owner',
    clientEmail:       shipment.cargo_owner_email,
    clientPhone:       shipment.cargo_owner_phone,
    serviceType:       'LOGISTICS',
    description:       `Logistics: ${invoiceNo}${route ? ' — ' + route : ''}`,
    lineItems,
    subtotal,
    vatAmount,
    totalAmount:       total,
    currency:          shipment.currency ?? 'AED',
    paymentStatus:     'DRAFT',
    sourceEntityType:  'LOGISTICS_SHIPMENT',
    sourceEntityId:    shipmentOrderId,
    sourceEntityNo:    shipment.shipment_no ?? shipmentOrderId,
    sourceCustomerId:  shipment.cargo_owner_customer_id,
    sourceCustomerName: shipment.cargo_owner_name,
    sourcePayload: {
      shipmentOrderId,
      shipmentNo:  shipment.shipment_no,
      status:      shipment.status,
      chargeCount: charges.length,
    },
    actor,
  });

  return { mirrored: true, ...result };
}

// ── Leasing reconciliation reads ──────────────────────────────────────────────

/**
 * Look up a single finance_invoices row by its ID.
 * Used by the leasing module to verify a mirror exists after syncing.
 */
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

/**
 * Full leasing ↔ finance reconciliation report for a tenant.
 *
 * Compares lease_invoices against finance_invoices mirror rows and flags
 * amount/status mismatches, orphans, duplicate mirrors, and cross-tenant
 * anomalies.
 */
export async function getLeasingBillingReconciliation(tenantId: string) {
  await ensureLeaseContractTenantColumn();

  type LeaseRow = {
    id: string; invoice_no: string | null; lessee_id: string;
    lessee_name: string | null; status: string | null;
    total_amount: string | number; created_at: Date | string | null;
  };
  type FinanceRow = {
    id: string; reference_id: string | null; payment_status: string | null;
    total_amount: string | number; source_entity_no: string | null;
    tenant_id: string | null; source_entity_id: string | null;
  };
  type GlobalLeaseRow = { id: string; tenant_id: string | null };
  type DuplicateRow   = { reference_id: string | null; count: bigint };

  const [leaseInvoices, financeRows, globalLeaseInvoices, duplicateRows] = await Promise.all([
    prisma.$queryRawUnsafe<LeaseRow[]>(
      `SELECT DISTINCT li.id, li.invoice_no, li.lessee_id, l.name AS lessee_name,
              li.status, li.total_amount, li.created_at
         FROM lease_invoices li
         JOIN lease_invoice_lines lil ON lil.invoice_id = li.id
         JOIN lease_contracts_v2 lc  ON lc.id = lil.contract_id
         LEFT JOIN lessees l          ON l.id  = li.lessee_id
        WHERE lc.tenant_id = $1
        ORDER BY li.created_at DESC NULLS LAST`,
      tenantId,
    ).catch(() => [] as LeaseRow[]),

    prisma.$queryRawUnsafe<FinanceRow[]>(
      `SELECT id::text, reference_id::text, payment_status, total_amount,
              source_entity_no, tenant_id, source_entity_id
         FROM finance_invoices
        WHERE deleted_at IS NULL
          AND tenant_id      = $1
          AND module_source  = 'LEASING'
          AND reference_type = 'LEASE_INVOICE'`,
      tenantId,
    ).catch(() => [] as FinanceRow[]),

    prisma.$queryRawUnsafe<GlobalLeaseRow[]>(
      `SELECT DISTINCT li.id::text, lc.tenant_id::text
         FROM lease_invoices li
         JOIN lease_invoice_lines lil ON lil.invoice_id = li.id
         JOIN lease_contracts_v2 lc  ON lc.id = lil.contract_id`,
    ).catch(() => [] as GlobalLeaseRow[]),

    prisma.$queryRawUnsafe<DuplicateRow[]>(
      `SELECT reference_id::text AS reference_id, COUNT(*)::bigint AS count
         FROM finance_invoices
        WHERE deleted_at IS NULL
          AND tenant_id      = $1
          AND module_source  = 'LEASING'
          AND reference_type = 'LEASE_INVOICE'
        GROUP BY reference_id
        HAVING COUNT(*) > 1`,
      tenantId,
    ).catch(() => [] as DuplicateRow[]),
  ]);

  const financeByRef   = new Map(financeRows.map(r => [r.reference_id, r]));
  const duplicateMap   = new Map(duplicateRows.map(r => [r.reference_id, Number(r.count)]));
  const globalLeaseMap = new Map(globalLeaseInvoices.map(r => [r.id, r.tenant_id]));
  const leaseIds       = new Set(leaseInvoices.map(inv => inv.id));

  const rows = leaseInvoices.map(inv => {
    const mirror         = financeByRef.get(inv.id);
    const leaseTotal     = Number(inv.total_amount ?? 0);
    const financeTotal   = mirror ? Number(mirror.total_amount ?? 0) : null;
    const canonicalStatus = LEASING_STATUS_MAP[inv.status ?? ''] ?? inv.status ?? null;
    return {
      leaseInvoiceId:  inv.id,
      invoiceNo:       inv.invoice_no,
      lesseeId:        inv.lessee_id,
      lesseeName:      inv.lessee_name,
      leasingStatus:   inv.status,
      financeStatus:   mirror?.payment_status ?? null,
      leaseTotal,
      financeTotal,
      financeInvoiceId: mirror?.id ?? null,
      mirrored:        Boolean(mirror),
      statusMatches:   mirror ? canonicalStatus === (mirror.payment_status ?? null) : false,
      totalMatches:    mirror ? Math.abs(leaseTotal - Number(financeTotal ?? 0)) < 0.01 : false,
      duplicateMirrors: duplicateMap.get(inv.id) ?? 0,
    };
  });

  const orphanFinanceMirrors = financeRows
    .filter(r => !r.reference_id || !leaseIds.has(r.reference_id))
    .map(r => {
      const globalTenant = r.reference_id ? globalLeaseMap.get(r.reference_id) : null;
      return {
        financeInvoiceId: r.id,
        referenceId:      r.reference_id,
        financeStatus:    r.payment_status,
        financeTotal:     Number(r.total_amount ?? 0),
        issue:            globalTenant && globalTenant !== tenantId ? 'TENANT_MISMATCH' : 'ORPHAN',
        leaseTenantId:    globalTenant ?? null,
      };
    });

  return {
    tenantId,
    sourceModule:          'LEASING',
    totalLeasingInvoices:  leaseInvoices.length,
    mirroredInvoices:      rows.filter(r => r.mirrored).length,
    missingFinanceMirror:  rows.filter(r => !r.mirrored).length,
    totalMismatches:       rows.filter(r => r.mirrored && (!r.totalMatches || !r.statusMatches)).length,
    statusMismatches:      rows.filter(r => r.mirrored && !r.statusMatches).length,
    duplicateMirrors:      duplicateRows.reduce((s, r) => s + Number(r.count) - 1, 0),
    orphanFinanceMirrors:  orphanFinanceMirrors.filter(r => r.issue === 'ORPHAN').length,
    tenantMismatches:      orphanFinanceMirrors.filter(r => r.issue === 'TENANT_MISMATCH').length,
    orphanRows:            orphanFinanceMirrors,
    rows,
  };
}
