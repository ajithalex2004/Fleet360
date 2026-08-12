/**
 * Finance consumer: quotation.approved → Finance
 *
 * When a garage quotation is approved the liability is incurred immediately.
 * Creates a DRAFT AP payable + DRAFT JE via the same logic that was previously
 * inline in the quotations PUT route.
 *
 * Idempotency:
 *   - event_consumer_inbox UNIQUE(consumer_name, event_id) — inbox level
 *   - AP payable: SELECT WHERE source_type='QUOTATION_APPROVAL' AND source_id=quotationId
 */

import { BaseEventConsumer }           from '@/events/consumer-base';
import type { DomainEventEnvelope }    from '@/events/event-envelope';
import { QUOTATION_APPROVED }          from '@/events/registry';
import type { QuotationApprovedPayload } from '@/events/contracts/quotation.events';
import { prisma }                      from '@/lib/prisma';
import { createDraftJournalEntry }     from '@/lib/finance/journal-service';

export class FinanceQuotationConsumer extends BaseEventConsumer<QuotationApprovedPayload> {
  readonly consumerName = 'finance-quotation';
  readonly eventType    = QUOTATION_APPROVED;

  protected async handle(
    envelope: DomainEventEnvelope<QuotationApprovedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;
    const { quotationId, garageId, garageName, amount, currency } = data;

    if (amount <= 0) {
      console.log(`[finance-quotation] quotation ${quotationId} — zero amount, skipping`);
      return;
    }

    // Idempotency: skip if AP payable already exists for this quotation approval
    const [existingAP] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM finance.finance_payables
        WHERE source_type = 'QUOTATION_APPROVAL' AND source_id = $1 LIMIT 1`,
      quotationId,
    ).catch(() => [] as Array<{ id: string }>);

    if (existingAP?.id) {
      console.log(
        `[finance-quotation] AP payable already exists for quotation ${quotationId} — skipping`,
      );
      return;
    }

    const vatAmount   = parseFloat((amount * 0.05).toFixed(2));
    const totalAmount = parseFloat((amount + vatAmount).toFixed(2));
    const vendor      = garageName ?? 'Workshop';
    const mrId        = data.maintenanceRequestId;
    const descr       = `Approved quotation — ${vendor}${mrId ? ` (MR: ${mrId})` : ''}`;
    const issueDate   = data.approvedAt.slice(0, 10);
    const ym          = issueDate.slice(0, 7).replace('-', '');

    // Generate AP number
    const [seqRow] = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
      `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE payable_number LIKE $1`,
      `AP-${ym}-%`,
    ).catch(() => [{ count: 0 }]);
    const apNumber = `AP-${ym}-${String(Number(seqRow?.count ?? 0) + 1).padStart(5, '0')}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO finance.finance_payables
         (payable_number, vendor_id, vendor_name, module,
          source_type, source_id, description, line_items,
          subtotal, vat_amount, total_amount, currency,
          issue_date, cost_centre, profit_centre,
          status, payment_status, tenant_id)
       VALUES ($1,$2,$3,'MAINTENANCE',
               'QUOTATION_APPROVAL',$4,$5,$6::jsonb,
               $7,$8,$9,$10,$11::date,
               'PC-MAINTENANCE','PC-MAINTENANCE',
               'DRAFT','UNPAID',$12)`,
      apNumber,
      garageId ?? null,
      vendor,
      quotationId,
      descr,
      JSON.stringify([{ description: descr, qty: 1, unitPrice: amount, amount }]),
      amount,
      vatAmount,
      totalAmount,
      currency,
      issueDate,
      tenantId,
    );

    await createDraftJournalEntry({
      tenantId,
      narration:  descr,
      reference:  quotationId,
      sourceType: 'QUOTATION_APPROVAL',
      sourceId:   quotationId,
      amount,
      currency,
      preparedBy: envelope.actor ?? 'system',
      costCentre: 'PC-MAINTENANCE',
      debit:  { code: '5100', name: 'Maintenance Expense',             description: descr },
      credit: { code: '2100', name: 'Accounts Payable / Accrued Exp.', description: `Accrual: quotation ${quotationId}` },
    });

    console.log(
      `[finance-quotation] quotation ${quotationId} → AP ${apNumber} created`,
    );
  }
}
