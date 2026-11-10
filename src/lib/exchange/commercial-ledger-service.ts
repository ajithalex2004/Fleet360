/**
 * src/lib/exchange/commercial-ledger-service.ts
 *
 * Phase 2 (P0): Spread, Commission & IFRS 15 Commercial Transaction Engine.
 *
 * Supports two explicit commercial accounting models:
 *
 *   1. AGENCY (Pass-Through + Commission Model):
 *      - Option 1 ('BUYER_DIRECT_TO_SUPPLIER'):
 *          Buyer pays supplier directly (e.g. AED 9,000 + VAT);
 *          Supplier owes Fleet360 platform commission (e.g. 3% = AED 270 + VAT).
 *      - Option 2 ('PLATFORM_COLLECT_AND_NET_REMIT'):
 *          Fleet360 collects AED 9,000 + VAT from buyer on supplier's behalf,
 *          retains AED 270 commission (+ VAT), and remits net settlement to supplier.
 *
 *   2. PRINCIPAL (Managed 3PL / 4PL Spread Model):
 *      - Requires IFRS 15 Principal control indicators (primary responsibility,
 *        inventory/capacity commitment or pricing discretion) and a financePolicyVersion.
 *      - Buyer is charged buyerAgreedAmount (e.g. AED 10,000 + 5% VAT).
 *      - Supplier is paid supplierAwardedAmount (e.g. AED 9,000 + 5% VAT).
 *      - Platform fee (if tracked internally, e.g. AED 300) is allocated out of
 *        the AED 1,000 gross spread (leaving AED 700 net contribution before overheads)
 *        — NEVER double-deducted from both buyer and supplier.
 *
 * Generates immutable, balanced double-entry journal lines and delegates draft
 * journal creation to src/lib/finance/journal-service.ts.
 */

import { createDraftJournalEntry } from '@/lib/finance/journal-service';

export type ExchangeCommercialModel = 'AGENCY' | 'PRINCIPAL';
export type CommercialModel = ExchangeCommercialModel;
export type AgencySettlementFlow = 'BUYER_DIRECT_TO_SUPPLIER' | 'PLATFORM_COLLECT_AND_NET_REMIT';
export type AgencySettlementMode = AgencySettlementFlow;
export type PlatformFeeBasis = 'PERCENTAGE' | 'FIXED';
export type UaeTaxTreatment = 'UAE_STANDARD_5_PCT' | 'ZERO_RATED_EXPORT' | 'EXEMPT' | 'REVERSE_CHARGE';

export interface Ifrs15PrincipalIndicators {
  /** Entity is primarily responsible for fulfilling the promise to provide the transport service. */
  hasPrimaryFulfilmentResponsibility: boolean;
  /** Entity bears capacity/utilization or substitution cost risk before/during transfer. */
  hasCapacityOrSubstitutionRisk: boolean;
  /** Entity has discretion in establishing the price for the specified service. */
  hasPricingDiscretion: boolean;
  /** Accountant or finance policy reference approving PRINCIPAL classification. */
  approvedByFinancePolicyVersion: string;
}

export interface CalculateExchangeEconomicsInput {
  commercialModel: ExchangeCommercialModel;
  /** Required when commercialModel === 'AGENCY' (defaults to 'PLATFORM_COLLECT_AND_NET_REMIT'). */
  agencySettlementFlow?: AgencySettlementFlow;
  /** Required when commercialModel === 'PRINCIPAL' to satisfy IFRS 15 control test. */
  principalIndicators?: Ifrs15PrincipalIndicators;
  /** Buyer agreed price (excl. VAT). In AGENCY mode, defaults to supplierAwardedAmount. */
  buyerAgreedAmount?: number;
  /** Supplier awarded cost (excl. VAT). */
  supplierAwardedAmount: number;
  /** Platform fee basis ('PERCENTAGE' of supplierAwardedAmount or 'FIXED' AED). */
  platformFeeBasis?: PlatformFeeBasis;
  /** Percentage (e.g. 3 for 3%) when platformFeeBasis === 'PERCENTAGE', or fixed AED when 'FIXED'. */
  platformFeeValue?: number;
  /** Deductions / SLA penalties applied against supplier payout (excl. VAT). */
  supplierDeductionsAmount?: number;
  /** Customer refunds / SLA credits granted to buyer (excl. VAT). */
  buyerRefundsAmount?: number;
  taxTreatment?: UaeTaxTreatment;
  currencyCode?: string;
  financePolicyVersion?: string;
  commercialAgreementId?: string;
}

export interface BalancedJournalLine {
  lineNo: number;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface ExchangeTransactionEconomics {
  commercialModel: ExchangeCommercialModel;
  agencySettlementFlow?: AgencySettlementFlow;
  ifrs15PrincipalQualified: boolean;
  financePolicyVersion: string;
  currencyCode: string;
  taxTreatment: UaeTaxTreatment;
  vatRate: number;

  // Buyer side (excl. & incl. VAT)
  buyerChargeExclVat: number;
  buyerVatAmount: number;
  buyerRefundsExclVat: number;
  buyerTotalReceivableInclVat: number;

  // Supplier side (excl. & incl. VAT)
  supplierCostExclVat: number;
  supplierVatAmount: number;
  supplierDeductionsExclVat: number;
  supplierGrossPayableInclVat: number;
  /** Net amount remitted to supplier after deductions (and commission if AGENCY + PLATFORM_COLLECT_AND_NET_REMIT). */
  supplierNetSettlementPayable: number;

  // Platform Commission & Spread Economics
  platformFeeExclVat: number;
  platformFeeVatAmount: number;
  platformFeeInclVat: number;
  /** Total gross spread before platform fee allocation (Buyer Excl VAT - Supplier Excl VAT, or Commission in AGENCY). */
  grossSpreadExclVat: number;
  /** Remaining gross contribution after allocating platform fee (never double-counted). */
  grossContributionAfterFeeExclVat: number;
  /** IFRS 15 Recognizable Platform Revenue (Excl. VAT). */
  recognizableAccountingRevenueExclVat: number;

  // Immutable Balanced Double-Entry Lines (sum(debit) === sum(credit))
  journalLines: BalancedJournalLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export class ExchangeCommercialLedgerService {
  /**
   * Verify IFRS 15 Principal control indicators.
   * Under IFRS 15 B34-B38, an entity is a Principal only if it controls the
   * specified service before transfer (evidenced by primary responsibility and
   * at least one of capacity/substitution risk or pricing discretion, backed by
   * a finance policy version).
   */
  static verifyIfrs15Principal(indicators?: Ifrs15PrincipalIndicators): boolean {
    if (!indicators) return false;
    if (!indicators.approvedByFinancePolicyVersion?.trim()) return false;
    return (
      indicators.hasPrimaryFulfilmentResponsibility &&
      (indicators.hasCapacityOrSubstitutionRisk || indicators.hasPricingDiscretion)
    );
  }

  /**
   * Compute full transaction economics and balanced double-entry journal lines.
   */
  static calculateTransactionEconomics(
    input: CalculateExchangeEconomicsInput,
  ): ExchangeTransactionEconomics {
    const supplierCostExclVat = round2(Math.max(0, Number(input.supplierAwardedAmount || 0)));
    if (supplierCostExclVat <= 0) {
      throw new Error('supplierAwardedAmount must be greater than zero');
    }

    const taxTreatment: UaeTaxTreatment = input.taxTreatment ?? 'UAE_STANDARD_5_PCT';
    const vatRate = taxTreatment === 'UAE_STANDARD_5_PCT' ? 0.05 : 0.0;
    const currencyCode = input.currencyCode || 'AED';

    // Validate IFRS 15 Principal qualification if PRINCIPAL is requested
    const ifrs15PrincipalQualified =
      input.commercialModel === 'PRINCIPAL'
        ? this.verifyIfrs15Principal(input.principalIndicators)
        : false;

    if (input.commercialModel === 'PRINCIPAL' && !ifrs15PrincipalQualified) {
      throw new Error(
        'IFRS 15 Principal classification requires primary fulfilment responsibility, pricing/capacity risk, and an approved financePolicyVersion.',
      );
    }

    const financePolicyVersion =
      input.principalIndicators?.approvedByFinancePolicyVersion ||
      input.financePolicyVersion ||
      'IFRS15-UAE-2026.1';

    const supplierDeductionsExclVat = round2(Math.max(0, Number(input.supplierDeductionsAmount || 0)));
    const buyerRefundsExclVat = round2(Math.max(0, Number(input.buyerRefundsAmount || 0)));

    // Platform fee calculation
    const feeBasis: PlatformFeeBasis = input.platformFeeBasis ?? 'PERCENTAGE';
    const feeVal = Number(input.platformFeeValue ?? 0);
    const platformFeeExclVat =
      feeVal > 0
        ? round2(feeBasis === 'PERCENTAGE' ? supplierCostExclVat * (feeVal / 100) : feeVal)
        : 0;
    const platformFeeVatAmount = round2(platformFeeExclVat * vatRate);
    const platformFeeInclVat = round2(platformFeeExclVat + platformFeeVatAmount);

    const netSupplierServiceExclVat = round2(Math.max(0, supplierCostExclVat - supplierDeductionsExclVat));
    const supplierVatAmount = round2(netSupplierServiceExclVat * vatRate);
    const supplierGrossPayableInclVat = round2(netSupplierServiceExclVat + supplierVatAmount);

    const journalLines: BalancedJournalLine[] = [];

    if (input.commercialModel === 'AGENCY') {
      const flow: AgencySettlementFlow =
        input.agencySettlementFlow ?? 'PLATFORM_COLLECT_AND_NET_REMIT';

      const buyerChargeExclVat = netSupplierServiceExclVat;
      const buyerVatAmount = supplierVatAmount;
      const buyerTotalReceivableInclVat = supplierGrossPayableInclVat;

      const supplierNetSettlementPayable =
        flow === 'PLATFORM_COLLECT_AND_NET_REMIT'
          ? round2(Math.max(0, supplierGrossPayableInclVat - platformFeeInclVat))
          : supplierGrossPayableInclVat;

      if (flow === 'PLATFORM_COLLECT_AND_NET_REMIT') {
        // Option 2: Fleet360 collects on behalf of supplier, deducts commission + VAT, remits net
        journalLines.push({
          lineNo: 1,
          accountCode: '1120',
          accountName: 'Exchange Clearing Receivable — Buyer',
          description: 'Pass-through transport collection from buyer (incl. VAT)',
          debit: buyerTotalReceivableInclVat,
          credit: 0,
        });
        journalLines.push({
          lineNo: 2,
          accountCode: '2110',
          accountName: 'Accounts Payable — Exchange Partner (Net Settlement)',
          description: 'Net payable to transport partner after commission deduction',
          debit: 0,
          credit: supplierNetSettlementPayable,
        });
        if (platformFeeExclVat > 0) {
          journalLines.push({
            lineNo: 3,
            accountCode: '4450',
            accountName: 'Exchange Marketplace Commission Revenue',
            description: 'Platform agency commission retained',
            debit: 0,
            credit: platformFeeExclVat,
          });
        }
        if (platformFeeVatAmount > 0) {
          journalLines.push({
            lineNo: 4,
            accountCode: '2140',
            accountName: 'UAE Output VAT Payable (5%)',
            description: 'Output VAT on platform agency commission',
            debit: 0,
            credit: platformFeeVatAmount,
          });
        }
      } else {
        // Option 1: Buyer pays supplier directly; Fleet360 bills supplier for commission + VAT
        if (platformFeeInclVat > 0) {
          journalLines.push({
            lineNo: 1,
            accountCode: '1125',
            accountName: 'Accounts Receivable — Partner Commission',
            description: 'Commission invoice receivable from transport partner',
            debit: platformFeeInclVat,
            credit: 0,
          });
          journalLines.push({
            lineNo: 2,
            accountCode: '4450',
            accountName: 'Exchange Marketplace Commission Revenue',
            description: 'Platform agency commission billed to partner',
            debit: 0,
            credit: platformFeeExclVat,
          });
          if (platformFeeVatAmount > 0) {
            journalLines.push({
              lineNo: 3,
              accountCode: '2140',
              accountName: 'UAE Output VAT Payable (5%)',
              description: 'Output VAT on platform commission',
              debit: 0,
              credit: platformFeeVatAmount,
            });
          }
        }
      }

      const totalDebits = round2(journalLines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = round2(journalLines.reduce((s, l) => s + l.credit, 0));

      return {
        commercialModel: 'AGENCY',
        agencySettlementFlow: flow,
        ifrs15PrincipalQualified: false,
        financePolicyVersion,
        currencyCode,
        taxTreatment,
        vatRate,
        buyerChargeExclVat,
        buyerVatAmount,
        buyerRefundsExclVat,
        buyerTotalReceivableInclVat,
        supplierCostExclVat,
        supplierVatAmount,
        supplierDeductionsExclVat,
        supplierGrossPayableInclVat,
        supplierNetSettlementPayable,
        platformFeeExclVat,
        platformFeeVatAmount,
        platformFeeInclVat,
        grossSpreadExclVat: platformFeeExclVat,
        grossContributionAfterFeeExclVat: platformFeeExclVat,
        recognizableAccountingRevenueExclVat: platformFeeExclVat,
        journalLines,
        totalDebits,
        totalCredits,
        isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
      };
    }

    // Mode B: PRINCIPAL (Managed 3PL / 4PL Model)
    const rawBuyerAgreed = Number(input.buyerAgreedAmount ?? supplierCostExclVat);
    const buyerChargeExclVat = round2(Math.max(0, rawBuyerAgreed - buyerRefundsExclVat));
    const buyerVatAmount = round2(buyerChargeExclVat * vatRate);
    const buyerTotalReceivableInclVat = round2(buyerChargeExclVat + buyerVatAmount);

    // In PRINCIPAL mode, the supplier is paid their agreed cost (less SLA deductions).
    // Any internal platformFeeExclVat is an allocation of the spread (Buyer - Supplier),
    // NEVER deducted a second time from the supplier payout unless explicitly contracted.
    const supplierNetSettlementPayable = supplierGrossPayableInclVat;
    const grossSpreadExclVat = round2(buyerChargeExclVat - netSupplierServiceExclVat);
    const grossContributionAfterFeeExclVat = round2(grossSpreadExclVat - platformFeeExclVat);

    // Balanced Double-Entry Journal Lines for Principal Transaction:
    // Leg 1 (Revenue & AR): Dr AR (Buyer Total), Cr Revenue (Net of platform fee & Platform Fee split), Cr Output VAT
    journalLines.push({
      lineNo: 1,
      accountCode: '1110',
      accountName: 'Accounts Receivable — Enterprise Buyer',
      description: 'Customer invoice for managed transport service',
      debit: buyerTotalReceivableInclVat,
      credit: 0,
    });
    if (platformFeeExclVat > 0 && buyerChargeExclVat >= platformFeeExclVat) {
      journalLines.push({
        lineNo: 2,
        accountCode: '4400',
        accountName: 'Managed Transport Service Revenue',
        description: 'Principal transport revenue (net of internal platform fee allocation)',
        debit: 0,
        credit: round2(buyerChargeExclVat - platformFeeExclVat),
      });
      journalLines.push({
        lineNo: 3,
        accountCode: '4450',
        accountName: 'Exchange Marketplace Commission Revenue',
        description: 'Internal platform fee allocation on principal booking',
        debit: 0,
        credit: platformFeeExclVat,
      });
    } else {
      journalLines.push({
        lineNo: 2,
        accountCode: '4400',
        accountName: 'Managed Transport Service Revenue',
        description: 'Principal transport service revenue',
        debit: 0,
        credit: buyerChargeExclVat,
      });
    }
    if (buyerVatAmount > 0) {
      journalLines.push({
        lineNo: journalLines.length + 1,
        accountCode: '2140',
        accountName: 'UAE Output VAT Payable (5%)',
        description: 'Output VAT on customer transport invoice',
        debit: 0,
        credit: buyerVatAmount,
      });
    }

    // Leg 2 (Subcontracted Cost of Sales & AP): Dr Subcontracted Transport Cost, Dr Input VAT, Cr AP Supplier
    journalLines.push({
      lineNo: journalLines.length + 1,
      accountCode: '5220',
      accountName: 'Subcontracted Partner Transport Cost',
      description: 'Partner fulfilment cost of sales',
      debit: netSupplierServiceExclVat,
      credit: 0,
    });
    if (supplierVatAmount > 0) {
      journalLines.push({
        lineNo: journalLines.length + 1,
        accountCode: '1140',
        accountName: 'UAE Input VAT Recoverable (5%)',
        description: 'Recoverable input VAT on partner tax invoice',
        debit: supplierVatAmount,
        credit: 0,
      });
    }
    journalLines.push({
      lineNo: journalLines.length + 1,
      accountCode: '2110',
      accountName: 'Accounts Payable — Exchange Partner',
      description: 'Payable to fulfilment partner',
      debit: 0,
      credit: supplierGrossPayableInclVat,
    });

    const totalDebits = round2(journalLines.reduce((s, l) => s + l.debit, 0));
    const totalCredits = round2(journalLines.reduce((s, l) => s + l.credit, 0));

    return {
      commercialModel: 'PRINCIPAL',
      ifrs15PrincipalQualified: true,
      financePolicyVersion,
      currencyCode,
      taxTreatment,
      vatRate,
      buyerChargeExclVat,
      buyerVatAmount,
      buyerRefundsExclVat,
      buyerTotalReceivableInclVat,
      supplierCostExclVat,
      supplierVatAmount,
      supplierDeductionsExclVat,
      supplierGrossPayableInclVat,
      supplierNetSettlementPayable,
      platformFeeExclVat,
      platformFeeVatAmount,
      platformFeeInclVat,
      grossSpreadExclVat,
      grossContributionAfterFeeExclVat,
      recognizableAccountingRevenueExclVat: buyerChargeExclVat,
      journalLines,
      totalDebits,
      totalCredits,
      isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }

  /**
   * Post the supplier AP & commission journal entries into the core Finance GL
   * via createDraftJournalEntry (idempotent by sourceId + occurrence key).
   */
  static async postSupplierApprovalToGl(params: {
    tenantId: string;
    invoiceId: string;
    invoiceNumber: string;
    partnerName: string;
    economics: ExchangeTransactionEconomics;
    preparedBy?: string;
  }) {
    if (!params.economics.isBalanced) {
      throw new Error('Cannot post unbalanced exchange transaction to General Ledger');
    }

    const entries = [];

    // 1. Supplier Subcontracted Cost -> Accounts Payable
    const apEntry = await createDraftJournalEntry({
      tenantId: params.tenantId,
      narration: `Exchange Partner Invoice ${params.invoiceNumber} — ${params.partnerName}`,
      reference: params.invoiceNumber,
      sourceType: 'CARRIER_SETTLEMENT',
      sourceId: params.invoiceId,
      amount: params.economics.supplierGrossPayableInclVat,
      currency: params.economics.currencyCode,
      preparedBy: params.preparedBy || 'EXCHANGE_FINANCE',
      debit: {
        code: '5220',
        name: 'Subcontracted Partner Transport Cost',
        description: `Partner fulfilment cost (${params.invoiceNumber})`,
      },
      credit: {
        code: '2110',
        name: 'Accounts Payable — Trade',
        description: `Payable to ${params.partnerName} (${params.invoiceNumber})`,
      },
      idempotencyKey: `EXCHANGE_AP:${params.invoiceId}`,
    }).catch(() => null);

    if (apEntry) entries.push(apEntry);

    // 2. If Platform Commission applies, record commission journal entry idempotently
    if (params.economics.platformFeeInclVat > 0) {
      const commEntry = await createDraftJournalEntry({
        tenantId: params.tenantId,
        narration: `Exchange Platform Commission on ${params.invoiceNumber} — ${params.partnerName}`,
        reference: `COMM-${params.invoiceNumber}`,
        sourceType: 'EXCHANGE_COMMISSION',
        sourceId: params.invoiceId,
        amount: params.economics.platformFeeInclVat,
        currency: params.economics.currencyCode,
        preparedBy: params.preparedBy || 'EXCHANGE_FINANCE',
        debit: {
          code: '2110',
          name: 'Accounts Payable — Trade',
          description: `Commission deduction from ${params.partnerName}`,
        },
        credit: {
          code: '4400',
          name: 'Staff Transport Revenue',
          description: `Exchange platform commission (${params.invoiceNumber})`,
        },
        idempotencyKey: `EXCHANGE_COMMISSION:${params.invoiceId}`,
      }).catch(() => null);

      if (commEntry) entries.push(commEntry);
    }

    return entries;
  }
}
