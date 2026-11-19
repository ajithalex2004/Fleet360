/**
 * Double-entry General Ledger posting engine for Corporate Leasing invoices & payments.
 *
 * Implements UAE VAT compliance (FTA VATP006 / VATP040):
 * - Statutory traffic fines: Out of scope (0% VAT), credited to 2160 (Traffic Fines & Tolls Clearing)
 * - Admin surcharges: Standard-rated (5% VAT), credited to 4140 (Fine & Violation Admin Surcharges)
 * - Lease rental charges: Standard-rated (5% VAT), credited to 4210 (Vehicle Lease Revenue)
 * - Output VAT: Credited to 2120 (VAT Output Tax Payable)
 * - Accounts Receivable: Debited to 1132 (Accounts Receivable — Corporate Leasing)
 */

import { postOperationalJournalEntry, type JournalTx } from '@/lib/finance/journal-service';

export interface LeaseGlPostingParams {
  invoiceId: string;
  tenantId: string;
  preparedBy?: string;
  reason?: string;
}

export interface LeasePaymentGlParams {
  invoiceId: string;
  tenantId: string;
  amount: number;
  paymentRef?: string;
  paymentMethod?: string;
  preparedBy?: string;
}

export async function postLeaseInvoiceToGl(
  tx: JournalTx & { leaseInvoice: any },
  params: LeaseGlPostingParams,
): Promise<{ id: string; number: string; created: boolean } | null> {
  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { lines: true, lessee: true },
  });
  if (!invoice) return null;

  const totalAmount = Number(Number(invoice.totalAmount).toFixed(2));
  if (totalAmount <= 0) return null;

  let statutoryFineSum = 0;
  let adminFeeSum = 0;
  let leaseRevenueSum = 0;

  for (const line of invoice.lines ?? []) {
    const lineAmt = Number(Number(line.totalAmount ?? (Number(line.quantity ?? 1) * Number(line.unitAmount ?? 0))).toFixed(2));
    const upperType = String(line.lineType || '').trim().toUpperCase();
    const upperDesc = String(line.description || '').toLowerCase();
    const taxCat = String(line.taxCategory || '').toUpperCase();

    if (upperType === 'STATUTORY_FINE' || taxCat === 'O' || upperDesc.includes('statutory fine')) {
      statutoryFineSum += lineAmt;
    } else if (upperType === 'ADMIN_FEE' || upperDesc.includes('admin surcharge') || upperDesc.includes('admin fee')) {
      adminFeeSum += lineAmt;
    } else {
      leaseRevenueSum += lineAmt;
    }
  }

  // If no lines found, fall back to subtotal
  if (statutoryFineSum === 0 && adminFeeSum === 0 && leaseRevenueSum === 0) {
    leaseRevenueSum = Number(Number(invoice.subTotal ?? totalAmount).toFixed(2));
  }

  const vatAmount = Number(Number(invoice.vatAmount ?? 0).toFixed(2));

  // Credits
  const credits: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [];

  if (leaseRevenueSum > 0) {
    credits.push({
      code: '4210',
      name: 'Vehicle Lease Revenue',
      description: `Lease revenue for invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: 0,
      credit: Number(leaseRevenueSum.toFixed(2)),
    });
  }

  if (statutoryFineSum > 0) {
    credits.push({
      code: '2160',
      name: 'Traffic Fines & Tolls Clearing',
      description: `Statutory traffic fine recharges (0% VAT FTA VATP006/040) for ${invoice.invoiceNo ?? invoice.id}`,
      debit: 0,
      credit: Number(statutoryFineSum.toFixed(2)),
    });
  }

  if (adminFeeSum > 0) {
    credits.push({
      code: '4140',
      name: 'Fine & Violation Admin Surcharges',
      description: `Traffic fine admin fee surcharge (5% VAT) for ${invoice.invoiceNo ?? invoice.id}`,
      debit: 0,
      credit: Number(adminFeeSum.toFixed(2)),
    });
  }

  if (vatAmount > 0) {
    credits.push({
      code: '2120',
      name: 'VAT Output Tax Payable',
      description: `Output VAT for invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: 0,
      credit: Number(vatAmount.toFixed(2)),
    });
  }

  // Ensure balance matches totalAmount exactly
  const totalCredit = Number(credits.reduce((s, c) => s + c.credit, 0).toFixed(2));
  const diff = Number((totalAmount - totalCredit).toFixed(2));
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.05 && credits.length > 0) {
    // Balance rounding discrepancy into largest revenue line
    const target = credits.find((c) => c.code === '4210') ?? credits[0];
    target.credit = Number((target.credit + diff).toFixed(2));
  }

  const lines = [
    {
      code: '1132',
      name: 'Accounts Receivable — Corporate Leasing',
      description: `AR for lease invoice ${invoice.invoiceNo ?? invoice.id} (${invoice.lessee?.name ?? 'Lessee'})`,
      debit: totalAmount,
      credit: 0,
    },
    ...credits,
  ];

  return postOperationalJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: invoice.issueDate ? new Date(invoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    narration: `Corporate Lease Invoice ${invoice.invoiceNo ?? invoice.id} — ${invoice.lessee?.name ?? 'Lessee'}`,
    reference: invoice.invoiceNo ?? invoice.id,
    sourceType: 'LEASE_INVOICE',
    sourceId: invoice.id,
    currency: invoice.currency ?? 'AED',
    preparedBy: params.preparedBy ?? 'system',
    idempotencyKey: `LEASE_INVOICE:${invoice.id}`,
    lines,
  });
}

export async function postLeaseInvoiceReversalToGl(
  tx: JournalTx & { leaseInvoice: any },
  params: LeaseGlPostingParams,
): Promise<{ id: string; number: string; created: boolean } | null> {
  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { lines: true, lessee: true },
  });
  if (!invoice) return null;

  const totalAmount = Number(Number(invoice.totalAmount).toFixed(2));
  if (totalAmount <= 0) return null;

  let statutoryFineSum = 0;
  let adminFeeSum = 0;
  let leaseRevenueSum = 0;

  for (const line of invoice.lines ?? []) {
    const lineAmt = Number(Number(line.totalAmount ?? (Number(line.quantity ?? 1) * Number(line.unitAmount ?? 0))).toFixed(2));
    const upperType = String(line.lineType || '').trim().toUpperCase();
    const upperDesc = String(line.description || '').toLowerCase();
    const taxCat = String(line.taxCategory || '').toUpperCase();

    if (upperType === 'STATUTORY_FINE' || taxCat === 'O' || upperDesc.includes('statutory fine')) {
      statutoryFineSum += lineAmt;
    } else if (upperType === 'ADMIN_FEE' || upperDesc.includes('admin surcharge') || upperDesc.includes('admin fee')) {
      adminFeeSum += lineAmt;
    } else {
      leaseRevenueSum += lineAmt;
    }
  }

  if (statutoryFineSum === 0 && adminFeeSum === 0 && leaseRevenueSum === 0) {
    leaseRevenueSum = Number(Number(invoice.subTotal ?? totalAmount).toFixed(2));
  }

  const vatAmount = Number(Number(invoice.vatAmount ?? 0).toFixed(2));

  // Inverted lines: what was credited is now debited, AR is credited
  const debits: Array<{ code: string; name: string; description: string; debit: number; credit: number }> = [];

  if (leaseRevenueSum > 0) {
    debits.push({
      code: '4210',
      name: 'Vehicle Lease Revenue',
      description: `Reversal of lease revenue for voided invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: Number(leaseRevenueSum.toFixed(2)),
      credit: 0,
    });
  }

  if (statutoryFineSum > 0) {
    debits.push({
      code: '2160',
      name: 'Traffic Fines & Tolls Clearing',
      description: `Reversal of statutory traffic fine recharges for voided invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: Number(statutoryFineSum.toFixed(2)),
      credit: 0,
    });
  }

  if (adminFeeSum > 0) {
    debits.push({
      code: '4140',
      name: 'Fine & Violation Admin Surcharges',
      description: `Reversal of fine admin fee surcharge for voided invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: Number(adminFeeSum.toFixed(2)),
      credit: 0,
    });
  }

  if (vatAmount > 0) {
    debits.push({
      code: '2120',
      name: 'VAT Output Tax Payable',
      description: `Reversal of Output VAT for voided invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: Number(vatAmount.toFixed(2)),
      credit: 0,
    });
  }

  const totalDebit = Number(debits.reduce((s, d) => s + d.debit, 0).toFixed(2));
  const diff = Number((totalAmount - totalDebit).toFixed(2));
  if (Math.abs(diff) > 0 && Math.abs(diff) <= 0.05 && debits.length > 0) {
    const target = debits.find((d) => d.code === '4210') ?? debits[0];
    target.debit = Number((target.debit + diff).toFixed(2));
  }

  const lines = [
    ...debits,
    {
      code: '1132',
      name: 'Accounts Receivable — Corporate Leasing',
      description: `Credit AR for voided lease invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: 0,
      credit: totalAmount,
    },
  ];

  return postOperationalJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: new Date().toISOString().slice(0, 10),
    narration: `Void Reversal: Corporate Lease Invoice ${invoice.invoiceNo ?? invoice.id}${params.reason ? ` — ${params.reason}` : ''}`,
    reference: `${invoice.invoiceNo ?? invoice.id}-VOID`,
    sourceType: 'LEASE_INVOICE_VOID',
    sourceId: invoice.id,
    currency: invoice.currency ?? 'AED',
    preparedBy: params.preparedBy ?? 'system',
    idempotencyKey: `LEASE_INVOICE_VOID:${invoice.id}`,
    lines,
  });
}

export async function postLeasePaymentToGl(
  tx: JournalTx & { leaseInvoice: any },
  params: LeasePaymentGlParams,
): Promise<{ id: string; number: string; created: boolean } | null> {
  const amount = Number(Number(params.amount).toFixed(2));
  if (amount <= 0) return null;

  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    select: { id: true, invoiceNo: true, currency: true },
  });
  if (!invoice) return null;

  const isCash = String(params.paymentMethod || '').toUpperCase() === 'CASH';
  const cashAccountCode = isCash ? '1110' : '1120';
  const cashAccountName = isCash ? 'Cash in Hand' : 'Bank Accounts — Operations';

  const ref = params.paymentRef || `PMT-${Date.now().toString().slice(-6)}`;

  const lines = [
    {
      code: cashAccountCode,
      name: cashAccountName,
      description: `Collection receipt for lease invoice ${invoice.invoiceNo ?? invoice.id}`,
      debit: amount,
      credit: 0,
    },
    {
      code: '1132',
      name: 'Accounts Receivable — Corporate Leasing',
      description: `AR clearance on lease payment ref ${ref}`,
      debit: 0,
      credit: amount,
    },
  ];

  return postOperationalJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: new Date().toISOString().slice(0, 10),
    narration: `Payment Received for Lease Invoice ${invoice.invoiceNo ?? invoice.id} (${params.paymentMethod ?? 'BANK_TRANSFER'})`,
    reference: ref,
    sourceType: 'LEASE_PAYMENT',
    sourceId: `${params.invoiceId}:${ref}`,
    currency: invoice.currency ?? 'AED',
    preparedBy: params.preparedBy ?? 'system',
    idempotencyKey: `LEASE_PAYMENT:${params.invoiceId}:${ref}`,
    lines,
  });
}
