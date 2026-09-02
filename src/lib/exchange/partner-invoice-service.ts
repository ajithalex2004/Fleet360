/**
 * src/lib/exchange/partner-invoice-service.ts
 *
 * Handles Partner Invoice generation, Enterprise Review, and Core Finance AP (FinancePayable) Handoff.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';

export interface SubmitPartnerInvoiceInput {
  partnerId: string;
  awardId: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  subtotalAmount: number;
  vatAmount?: number;
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
   * Partner submits an invoice against an awarded/completed job
   */
  static async submitInvoice(input: SubmitPartnerInvoiceInput) {
    const award = await prisma.outsourceAward.findUnique({
      where: { id: input.awardId, partnerId: input.partnerId },
      include: { partner: true, request: true },
    });

    if (!award) throw new Error('Award not found for this partner');

    const subtotal = Number(input.subtotalAmount);
    const vat = input.vatAmount != null ? Number(input.vatAmount) : subtotal * 0.05;
    const total = subtotal + vat;

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
      },
    });

    await raiseAlert({
      tenantId: award.tenantId,
      code: 'PARTNER_INVOICE_SUBMITTED',
      sourceModule: 'exchange',
      subjectType: 'PartnerInvoice' as any,
      subjectId: invoice.id,
      title: `🧾 Partner Invoice Submitted: ${award.partner.legalName} (${invoice.invoiceNumber})`,
      description: `Invoice ${invoice.invoiceNumber} for AED ${total.toFixed(2)} submitted for award ${award.id.slice(0, 8)}.`,
      severity: 'LOW',
      actor: input.actorUserId || award.partner.legalName,
    });

    return invoice;
  }

  /**
   * Enterprise Finance approves invoice and hands off to FinancePayable in core ledger
   */
  static async approveInvoice(input: ApprovePartnerInvoiceInput) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.partnerInvoice.findUnique({
        where: { id: input.invoiceId, tenantId: input.tenantId },
        include: { partner: true, award: true },
      });

      if (!invoice) throw new Error('Invoice not found');
      if (invoice.status === 'APPROVED' || invoice.status === 'PAID') {
        throw new Error(`Invoice is already ${invoice.status}`);
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

      // 2. Update PartnerInvoice
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
        },
        input.approvedByUserId
      );

      return {
        invoice: updatedInvoice,
        payable,
      };
    });
  }
}
