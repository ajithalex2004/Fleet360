import type { TxClient } from '@/lib/rls';

/**
 * Outstanding balance on a LeaseInvoice = totalAmount minus everything
 * that has actually offset it: received payment-intent rows AND
 * non-reversed lease_deposit_applications rows. Summing over live,
 * non-reversed rows (rather than a mutated running total) is what makes a
 * deposit-application reversal automatically restore the balance — see
 * applyInvoicePayment below, which reads this and nothing else.
 */
export async function getInvoiceOutstandingBalance(
  tx: TxClient,
  tenantId: string,
  invoiceId: string,
): Promise<number> {
  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { totalAmount: true },
  });
  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const [paidRows, appliedRows] = await Promise.all([
    tx.$queryRawUnsafe<Array<{ total: string | null }>>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM lease_payment_intents
        WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'RECEIVED'`,
      tenantId,
      invoiceId,
    ),
    tx.$queryRawUnsafe<Array<{ total: string | null }>>(
      `SELECT COALESCE(SUM(applied_amount), 0)::text AS total
         FROM lease_deposit_applications
        WHERE tenant_id = $1 AND invoice_id = $2 AND reversed_at IS NULL`,
      tenantId,
      invoiceId,
    ),
  ]);

  const paid = Number(paidRows[0]?.total || 0);
  const applied = Number(appliedRows[0]?.total || 0);
  const balance = Number(invoice.totalAmount) - paid - applied;
  return Math.max(0, Math.round((balance + Number.EPSILON) * 100) / 100);
}

/**
 * Pure status recompute — never a ledger write. The only ledger writes are
 * the lease_payment_intents insert (record-payment) and the
 * lease_deposit_applications insert (settle_deposit). This function only
 * re-derives LeaseInvoice.status from the live balance above, so calling
 * it repeatedly — including right after a reversal — is safe and can never
 * double-count: there is nothing here for a second call to double-apply.
 *
 * DRAFT/CANCELLED invoices are left untouched (not yet, or no longer, in
 * the payment lifecycle at all).
 */
export async function applyInvoicePayment(
  tx: TxClient,
  tenantId: string,
  invoiceId: string,
): Promise<{ status: string; outstandingBalance: number }> {
  const invoice = await tx.leaseInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { status: true, totalAmount: true },
  });
  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') {
    return { status: invoice.status, outstandingBalance: Number(invoice.totalAmount) };
  }

  const outstandingBalance = await getInvoiceOutstandingBalance(tx, tenantId, invoiceId);
  const totalAmount = Number(invoice.totalAmount);
  const nextStatus =
    outstandingBalance <= 0.005 ? 'PAID' : outstandingBalance < totalAmount ? 'PARTIALLY_PAID' : 'SENT';

  if (nextStatus !== invoice.status) {
    await tx.leaseInvoice.update({
      where: { id: invoiceId },
      data: { status: nextStatus, paidAt: nextStatus === 'PAID' ? new Date() : null },
    });
  }

  return { status: nextStatus, outstandingBalance };
}
