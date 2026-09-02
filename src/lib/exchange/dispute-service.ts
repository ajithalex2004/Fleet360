/**
 * src/lib/exchange/dispute-service.ts
 *
 * Commercial Dispute Management Service for Fleet360 Exchange.
 * Lifecycle: OPEN -> UNDER_REVIEW -> SETTLED / CREDIT_NOTE_ISSUED / REJECTED.
 * Prevents payment blocking on uncontested invoice line items.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { DisputeStatus } from '@prisma/client';

export interface RaiseDisputeInput {
  tenantId: string;
  partnerId: string;
  invoiceId: string;
  invoiceItemId?: string;
  disputedAmount: number;
  reason: string;
  raisedByUserId: string;
}

export interface ResolveDisputeInput {
  tenantId: string;
  disputeId: string;
  resolution: DisputeStatus;
  resolvedAmount?: number;
  creditNoteRef?: string;
  resolutionNotes: string;
  resolvedByUserId: string;
}

export class DisputeService {
  /**
   * Raise a commercial dispute against an invoice or specific invoice line item
   */
  static async raiseDispute(input: RaiseDisputeInput) {
    const invoice = await prisma.partnerInvoice.findUnique({
      where: { id: input.invoiceId, tenantId: input.tenantId },
    });

    if (!invoice) throw new Error('Invoice not found');

    const disputeNumber = `DSP-${Date.now().toString().slice(-6)}`;

    const dispute = await prisma.outsourceDispute.create({
      data: {
        tenantId: input.tenantId,
        partnerId: input.partnerId,
        invoiceId: input.invoiceId,
        invoiceItemId: input.invoiceItemId,
        disputeNumber,
        disputedAmount: input.disputedAmount,
        status: DisputeStatus.OPEN,
        reason: input.reason,
        raisedBy: input.raisedByUserId,
      },
    });

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'OutsourceDispute',
      entityId: dispute.id,
      action: 'CREATE',
      details: `Raised dispute ${disputeNumber} for AED ${input.disputedAmount.toFixed(2)} on invoice ${invoice.invoiceNumber}`,
      userId: input.raisedByUserId,
    }).catch(() => {});

    return dispute;
  }

  /**
   * Settle, adjust, or issue credit note for a commercial dispute
   */
  static async resolveDispute(input: ResolveDisputeInput) {
    const dispute = await prisma.outsourceDispute.findUnique({
      where: { id: input.disputeId, tenantId: input.tenantId },
      include: { invoice: true },
    });

    if (!dispute) throw new Error('Dispute not found');

    const updated = await prisma.outsourceDispute.update({
      where: { id: dispute.id },
      data: {
        status: input.resolution,
        resolvedAmount: input.resolvedAmount != null ? input.resolvedAmount : dispute.disputedAmount,
        creditNoteRef: input.creditNoteRef,
        resolutionNotes: input.resolutionNotes,
        resolvedAt: new Date(),
        resolvedBy: input.resolvedByUserId,
      },
    });

    await logAudit({
      tenantId: input.tenantId,
      entityType: 'OutsourceDispute',
      entityId: dispute.id,
      action: 'RESOLVE',
      details: `Resolved dispute ${dispute.disputeNumber} as ${input.resolution}. Note: ${input.resolutionNotes}`,
      userId: input.resolvedByUserId,
    }).catch(() => {});

    return updated;
  }

  /**
   * List disputes for a tenant or partner
   */
  static async listDisputes(tenantId: string, partnerId?: string) {
    return prisma.outsourceDispute.findMany({
      where: {
        tenantId,
        partnerId: partnerId || undefined,
      },
      include: {
        partner: { select: { legalName: true, partnerCode: true } },
        invoice: { select: { invoiceNumber: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
