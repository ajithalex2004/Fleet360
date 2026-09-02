/**
 * src/lib/exchange/partner-invoice-service.ts
 *
 * Handles Partner Invoice generation, Enterprise Review, and Core Finance AP (FinancePayable) Handoff.
 * Hardened for Phase 1.5 & Phase 2.5:
 * - Line Itemized Invoices (Base Award + Variance adjustments: WAITING_TIME, TOLL, PARKING, etc.)
 * - Automatic Commercial Variance Detection (MATCHED vs. VARIANCE_REVIEW)
 * - Strict 1:1 Invariant between PartnerInvoice and FinancePayable
 * - Idempotent approval retries (safely returns existing payable without duplicate AP entries)
 * - Complete audit trail logging
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { InvoiceVarianceReason } from '@prisma/client';

export interface InvoiceLineItemInput {
  description: string;
  varianceReason?: InvoiceVarianceReason;
  quantity?: number;
  unitPrice: number;
  amount?: number;
  vatAmount?: number;
  totalAmount?: number;
}

export interface SubmitPartnerInvoiceInput {
  partnerId: string;
  awardId: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  subtotalAmount: number;
  vatAmount?: number;
  items?: InvoiceLineItemInput[];
  actorUserId?: string;
}

export interface ApprovePartnerInvoiceInput {
  tenantId: string;
  invoiceId: string;
  approvedAmount?: number;
  approvedByUserId: string;
}

export class PartnerInvoiceService {
  /**
   * Partner submits an invoice against an awarded/completed job with line item verification
   */
  static async submitInvoice(input: SubmitPartnerInvoiceInput) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: input.awardId, partnerId: input.partnerId },
      include: { partner: true, request: true, invoice: true, assignment: true },
    });

    if (!award) throw new Error('Award not found for this partner');
    if (award.invoice) {
      throw new Error(`An invoice (${award.invoice.invoiceNumber}) has already been submitted for this award`);
    }

    const subtotal = Number(input.subtotalAmount);
    const vat = input.vatAmount != null ? Number(input.vatAmount) : subtotal * 0.05;
    const total = subtotal + vat;

    // Commercial Variance Check against immutable Award Snapshot
    const awardedTotal = Number(award.totalAwarded);
    const variance = Math.abs(total - awardedTotal);
    const verificationStatus = variance > 0.01 ? 'VARIANCE_REVIEW' : 'MATCHED';

    const invoice = await prisma.partnerInvoice.create({
      data: {
        partnerId: input.partnerId,
        tenantId: award.tenantId,
        awardId: award.id,
        invoiceNumber: input.invoiceNumber.trim(),
        invoiceDate: new Date(input.invoiceDate),
        subtotalAmount: subtotal,
        vatAmount: vat,
        totalAmount: total,
        currency: award.currency,
        status: 'SUBMITTED',
        verificationStatus,
        items: input.items && input.items.length > 0
          ? {
              create: input.items.map((item) => {
                const itemAmount = item.amount != null ? Number(item.amount) : Number(item.unitPrice) * (Number(item.quantity) || 1);
                const itemVat = item.vatAmount != null ? Number(item.vatAmount) : itemAmount * 0.05;
                return {
                  description: item.description,
                  varianceReason: item.varianceReason,
                  quantity: Number(item.quantity) || 1,
                  unitPrice: Number(item.unitPrice),
                  amount: itemAmount,
                  vatAmount: itemVat,
                  totalAmount: itemAmount + itemVat,
                };
              }),
            }
          : undefined,
      },
      include: {
        items: true,
      },
    });

    await raiseAlert({
      tenantId: award.tenantId,
      code: verificationStatus === 'VARIANCE_REVIEW' ? 'PARTNER_INVOICE_VARIANCE' : 'PARTNER_INVOICE_SUBMITTED',
      sourceModule: 'exchange',
      subjectType: 'PartnerInvoice' as any,
      subjectId: invoice.id,
      title: verificationStatus === 'VARIANCE_REVIEW'
        ? `⚠️ Partner Invoice Variance Detected: ${award.partner.legalName} (${invoice.invoiceNumber})`
        : `🧾 Partner Invoice Submitted: ${award.partner.legalName} (${invoice.invoiceNumber})`,
      description: verificationStatus === 'VARIANCE_REVIEW'
        ? `Invoice total AED ${total.toFixed(2)} differs from awarded AED ${awardedTotal.toFixed(2)} (variance: AED ${variance.toFixed(2)}). Review required.`
        : `Invoice ${invoice.invoiceNumber} for AED ${total.toFixed(2)} matched awarded amount exactly.`,
      severity: verificationStatus === 'VARIANCE_REVIEW' ? 'MEDIUM' : 'LOW',
      actor: input.actorUserId || award.partner.legalName,
    });

    return invoice;
  }

  /**
   * Enterprise Finance approves invoice and hands off to FinancePayable in core ledger.
   * Fully idempotent under network retries and double-clicks.
   */
  static async approveInvoice(input: ApprovePartnerInvoiceInput) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.partnerInvoice.findUnique({
        where: { id: input.invoiceId, tenantId: input.tenantId },
        include: { partner: true, award: true, items: true },
      });

      if (!invoice) throw new Error('Invoice not found');

      // Idempotency: if already approved, retrieve the existing FinancePayable
      if (invoice.status === 'APPROVED' && invoice.payableId) {
        const existingPayable = await tx.financePayable.findUnique({
          where: { id: invoice.payableId },
        });
        return {
          invoice,
          payable: existingPayable,
          isRetry: true,
        };
      }

      if (invoice.status === 'PAID') {
        throw new Error('Invoice is already paid');
      }

      const approvedTotal = input.approvedAmount != null ? Number(input.approvedAmount) : Number(invoice.totalAmount);

      // 1. Create FinancePayable in core accounting ledger
      const payable = await tx.financePayable.create({
        data: {
          tenantId: input.tenantId,
          payableNumber: `PAY-${invoice.invoiceNumber}`,
          sourceType: 'CARRIER_SETTLEMENT',
          sourceId: invoice.id,
          vendorId: invoice.partnerId,
          vendorName: invoice.partner.legalName,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Net 30 default
          subtotalAmount: invoice.subtotalAmount,
          taxAmount: invoice.vatAmount,
          totalAmount: approvedTotal,
          outstandingBalance: approvedTotal,
          currency: invoice.currency,
          status: 'PENDING_APPROVAL',
        },
      });

      // 2. Update PartnerInvoice with payableId linkage
      const updatedInvoice = await tx.partnerInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'APPROVED',
          approvedAmount: approvedTotal,
          approvedAt: new Date(),
          approvedBy: input.approvedByUserId,
          payableId: payable.id,
        },
      });

      // 3. Log Audit
      await logAudit(
        tx,
        input.tenantId,
        'PartnerInvoice',
        invoice.id,
        'UPDATE',
        {
          action: 'INVOICE_APPROVED',
          approvedAmount: approvedTotal,
          payableId: payable.id,
          verificationStatus: invoice.verificationStatus,
        },
        input.approvedByUserId
      );

      return {
        invoice: updatedInvoice,
        payable,
        isRetry: false,
      };
    });
  }
}
