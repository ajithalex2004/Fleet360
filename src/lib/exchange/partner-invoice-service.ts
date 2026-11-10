/**
 * src/lib/exchange/partner-invoice-service.ts
 *
 * Handles Partner Invoice generation, Enterprise Review, Commercial Economics Calculation,
 * Core Finance AP (FinancePayable) Handoff, and Double-Entry GL Posting (Phase 2 P0).
 */

import { prisma } from '@/lib/prisma';
import { activeRlsScope } from '@/lib/rls-scope';
import { logAuditInTx } from '@/lib/audit';
import { raiseAlert } from '@/lib/alerts/raise';
import { InvoiceVarianceReason, type Prisma } from '@prisma/client';
import type { AlertSubjectType } from '@/events/contracts/alert.events';
import {
  ExchangeCommercialLedgerService,
  type CommercialModel,
  type AgencySettlementMode,
  type Ifrs15PrincipalIndicators,
} from './commercial-ledger-service';

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
  commercialModel?: CommercialModel;
  agencySettlementMode?: AgencySettlementMode;
  buyerAgreedSubtotal?: number;
  platformFeePct?: number;
  deductionsAmount?: number;
  ifrs15Indicators?: Ifrs15PrincipalIndicators;
  financePolicyVersion?: string;
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
      subjectType: 'PartnerInvoice' as unknown as AlertSubjectType,
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
   * Enterprise Finance approves invoice, calculates Agency/Principal economics,
   * hands off to FinancePayable, and posts balanced GL journal lines.
   * Fully idempotent under network retries and double-clicks.
   */
  static async approveInvoice(input: ApprovePartnerInvoiceInput) {
    const scope = activeRlsScope();
    const scopedTx = scope?.tx as Prisma.TransactionClient | undefined;
    const runTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
      scopedTx && typeof scopedTx.partnerInvoice?.findUnique === 'function'
        ? fn(scopedTx)
        : prisma.$transaction(fn, { maxWait: 15_000, timeout: 30_000 });

    const txResult = await runTx(async (tx) => {
      if (typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
        await tx
          .$queryRawUnsafe(`SELECT id FROM partner_invoices WHERE id = $1 FOR UPDATE`, input.invoiceId)
          .catch(() => {});
      }
      const invoice = await tx.partnerInvoice.findUnique({
        where: { id: input.invoiceId, tenantId: input.tenantId },
        include: { partner: true, award: true, items: true },
      });

      if (!invoice) throw new Error('Invoice not found');

      if (invoice.status === 'APPROVED' && invoice.payableId) {
        const existingPayable = await tx.financePayable.findUnique({
          where: { id: invoice.payableId },
        });
        return {
          invoice,
          rawInvoice: invoice,
          payable: existingPayable,
          isRetry: true,
        };
      }

      if (invoice.status === 'PAID') {
        throw new Error('Invoice is already paid');
      }

      const approvedTotal = input.approvedAmount != null ? Number(input.approvedAmount) : Number(invoice.totalAmount);

      const payable = await tx.financePayable.create({
        data: {
          tenantId: input.tenantId,
          payableNumber: `PAY-${invoice.invoiceNumber}`,
          sourceType: 'CARRIER_SETTLEMENT',
          sourceId: invoice.id,
          vendorId: invoice.partnerId,
          vendorName: invoice.partner.legalName,
          issueDate: invoice.invoiceDate,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          subtotal: invoice.subtotalAmount,
          vatAmount: invoice.vatAmount,
          totalAmount: approvedTotal,
          currency: invoice.currency,
          status: 'APPROVED',
          approvedBy: input.approvedByUserId,
          approvedAt: new Date(),
        },
      });

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

      await logAuditInTx({
        tenantId: input.tenantId,
        entityType: 'PartnerInvoice',
        entityId: invoice.id,
        action: 'UPDATE',
        details: `Invoice approved for ${approvedTotal} (payable ${payable.id}, verification: ${invoice.verificationStatus})`,
        userId: input.approvedByUserId,
      }, tx);

      return {
        invoice: updatedInvoice,
        rawInvoice: invoice,
        payable,
        isRetry: false,
      };
    });

    if (txResult.isRetry || !txResult.rawInvoice) {
      return {
        invoice: txResult.invoice,
        payable: txResult.payable,
        isRetry: true,
      };
    }

    const rawInvoice = txResult.rawInvoice;
    const snap = ((rawInvoice.award?.commercialSnapshot || {}) as Record<string, unknown>);
    const commercialModel: CommercialModel =
      input.commercialModel ||
      (snap.commercialModel as CommercialModel | undefined) ||
      'AGENCY';
    const agencySettlementMode: AgencySettlementMode =
      input.agencySettlementMode ||
      (snap.agencySettlementMode as AgencySettlementMode | undefined) ||
      'PLATFORM_COLLECT_AND_NET_REMIT';
    const supplierSubtotal = Number(rawInvoice.subtotalAmount);
    const buyerAgreedSubtotal =
      input.buyerAgreedSubtotal != null
        ? Number(input.buyerAgreedSubtotal)
        : snap.buyerAgreedPrice != null
        ? Number(snap.buyerAgreedPrice)
        : supplierSubtotal;
    const platformFeePct =
      input.platformFeePct != null
        ? Number(input.platformFeePct)
        : snap.platformFeePct != null
        ? Number(snap.platformFeePct)
        : 3;
    const financePolicyVersion =
      input.financePolicyVersion ||
      (snap.financePolicyVersion as string | undefined) ||
      'IFRS15-UAE-2026.1';
    const ifrs15Indicators =
      input.ifrs15Indicators ||
      (snap.ifrs15Indicators as Ifrs15PrincipalIndicators | undefined) || {
        hasPrimaryFulfilmentResponsibility: commercialModel === 'PRINCIPAL',
        hasCapacityOrSubstitutionRisk: false,
        hasPricingDiscretion: commercialModel === 'PRINCIPAL',
        approvedByFinancePolicyVersion: financePolicyVersion,
      };

    const economics = ExchangeCommercialLedgerService.calculateTransactionEconomics({
      commercialModel,
      agencySettlementFlow: agencySettlementMode,
      principalIndicators: ifrs15Indicators,
      buyerAgreedAmount: buyerAgreedSubtotal,
      supplierAwardedAmount: supplierSubtotal,
      platformFeeBasis: 'PERCENTAGE',
      platformFeeValue: platformFeePct,
      supplierDeductionsAmount: input.deductionsAmount ?? 0,
      currencyCode: rawInvoice.currency,
      financePolicyVersion,
    });

    const glEntries = await ExchangeCommercialLedgerService.postSupplierApprovalToGl({
      tenantId: input.tenantId,
      invoiceId: rawInvoice.id,
      invoiceNumber: rawInvoice.invoiceNumber,
      partnerName: rawInvoice.partner?.legalName || rawInvoice.partnerId,
      economics,
      preparedBy: input.approvedByUserId,
    });

    return {
      invoice: txResult.invoice,
      payable: txResult.payable,
      economics,
      glEntries,
      isRetry: false,
    };
  }
}
