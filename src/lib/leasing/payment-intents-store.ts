/**
 * Leasing payment intents — CRUD over the lazy-init lease_payment_intents
 * table (see payment-schema.ts). Raw SQL, same tradeoff as leasing-portal
 * and shipper-portal.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { ensurePaymentIntentTables } from './payment-schema';

export type PaymentIntentStatus = 'PENDING' | 'RECEIVED' | 'CANCELLED';

export interface PaymentIntent {
  id: string;
  tenantId: string;
  invoiceId: string;
  lesseeId: string;
  amount: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  method: string;
  status: PaymentIntentStatus;
  initiatedBy: 'LESSEE' | 'STAFF';
  initiatedByUser: string | null;
  referenceCode: string;
  notes: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  receiptId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  invoice_id: string;
  lessee_id: string;
  amount: string;
  currency: string;
  provider: string;
  provider_ref: string | null;
  method: string;
  status: string;
  initiated_by: string;
  initiated_by_user: string | null;
  reference_code: string;
  notes: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  receipt_id: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `id::text, tenant_id, invoice_id, lessee_id, amount::text, currency,
  provider, provider_ref, method, status, initiated_by, initiated_by_user,
  reference_code, notes, confirmed_at::text, confirmed_by, receipt_id,
  created_at::text, updated_at::text`;

function rowToApi(r: Row): PaymentIntent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    invoiceId: r.invoice_id,
    lesseeId: r.lessee_id,
    amount: Number(r.amount),
    currency: r.currency,
    provider: r.provider,
    providerRef: r.provider_ref,
    method: r.method,
    status: r.status as PaymentIntentStatus,
    initiatedBy: r.initiated_by as 'LESSEE' | 'STAFF',
    initiatedByUser: r.initiated_by_user,
    referenceCode: r.reference_code,
    notes: r.notes,
    confirmedAt: r.confirmed_at,
    confirmedBy: r.confirmed_by,
    receiptId: r.receipt_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createPaymentIntent(args: {
  tenantId: string;
  invoiceId: string;
  lesseeId: string;
  amount: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  method: string;
  initiatedBy: 'LESSEE' | 'STAFF';
  initiatedByUser: string | null;
  referenceCode: string;
  notes?: string | null;
}): Promise<PaymentIntent> {
  await ensurePaymentIntentTables();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO lease_payment_intents
       (tenant_id, invoice_id, lessee_id, amount, currency, provider, provider_ref,
        method, initiated_by, initiated_by_user, reference_code, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${SELECT}`,
    args.tenantId, args.invoiceId, args.lesseeId, args.amount, args.currency,
    args.provider, args.providerRef, args.method, args.initiatedBy,
    args.initiatedByUser, args.referenceCode, args.notes ?? null,
  );
  if (!rows[0]) throw new Error('createPaymentIntent returned no row');
  return rowToApi(rows[0]);
}

export async function listPaymentIntentsForInvoice(tenantId: string, invoiceId: string): Promise<PaymentIntent[]> {
  await ensurePaymentIntentTables();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM lease_payment_intents
      WHERE tenant_id = $1 AND invoice_id = $2
      ORDER BY created_at DESC`,
    tenantId, invoiceId,
  );
  return rows.map(rowToApi);
}

export async function listPaymentIntentsForLessee(tenantId: string, lesseeId: string): Promise<PaymentIntent[]> {
  await ensurePaymentIntentTables();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM lease_payment_intents
      WHERE tenant_id = $1 AND lessee_id = $2
      ORDER BY created_at DESC`,
    tenantId, lesseeId,
  );
  return rows.map(rowToApi);
}

/**
 * Confirms a pending payment intent: marks it RECEIVED, writes a real
 * LeaseReceipt, and marks the invoice PAID — all in one transaction. This
 * is the actual "money movement" moment in this codebase today: a human
 * (staff, reconciling a bank statement) confirms funds arrived. A real
 * gateway webhook would call the same function once wired in.
 */
export async function confirmPaymentIntent(args: {
  tenantId: string;
  intentId: string;
  confirmedBy: string;
  paymentMethod?: string;
  bankRef?: string | null;
}): Promise<{ intent: PaymentIntent; receiptId: string } | null> {
  await ensurePaymentIntentTables();

  return withTenantRls(prisma, args.tenantId, async (tx) => {
    const existingRows = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT} FROM lease_payment_intents
        WHERE id = $1::uuid AND tenant_id = $2 AND status = 'PENDING'
        LIMIT 1`,
      args.intentId, args.tenantId,
    );
    const existing = existingRows[0];
    if (!existing) return null;

    const invoice = await tx.leaseInvoice.findFirst({
      where: { id: existing.invoice_id, tenantId: args.tenantId },
    });
    if (!invoice) return null;

    // LeaseReceipt.contractId is required, but an invoice isn't always
    // tied to one contract on this model — fall back to a lookup via the
    // invoice's own lines, and skip receipt creation gracefully if none
    // exists rather than failing the whole confirmation.
    const line = await tx.leaseInvoiceLine.findFirst({
      where: { invoiceId: existing.invoice_id, contractId: { not: null } },
      select: { contractId: true },
    });

    let receiptId: string | null = null;
    if (line?.contractId) {
      const receipt = await tx.leaseReceipt.create({
        data: {
          receiptNumber: `RCP-${Date.now().toString().slice(-6)}`,
          contractId: line.contractId,
          paymentType: 'MONTHLY',
          amount: Number(existing.amount),
          currency: existing.currency,
          receivedDate: new Date(),
          paymentMethod: args.paymentMethod ?? existing.method,
          bankRef: args.bankRef ?? existing.reference_code,
          receivedBy: args.confirmedBy,
          notes: `Auto-recorded from payment intent ${existing.id} (ref ${existing.reference_code})`,
          tenantId: args.tenantId,
        },
      });
      receiptId = receipt.id;
    }

    await tx.leaseInvoice.update({
      where: { id: existing.invoice_id },
      data: { status: 'PAID', paidAt: new Date(), paymentRef: existing.reference_code },
    });

    const confirmedRows = await tx.$queryRawUnsafe<Row[]>(
      `UPDATE lease_payment_intents
          SET status = 'RECEIVED', confirmed_at = NOW(), confirmed_by = $1,
              receipt_id = $2, updated_at = NOW()
        WHERE id = $3::uuid
        RETURNING ${SELECT}`,
      args.confirmedBy, receiptId, args.intentId,
    );

    return { intent: rowToApi(confirmedRows[0]!), receiptId: receiptId ?? '' };
  });
}

export async function cancelPaymentIntent(tenantId: string, intentId: string): Promise<boolean> {
  await ensurePaymentIntentTables();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE lease_payment_intents
        SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2 AND status = 'PENDING'`,
    intentId, tenantId,
  );
  return Number(result) > 0;
}
