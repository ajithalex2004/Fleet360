/**
 * Finance consumer: maintenance.estimation_approved → Finance (DRAFT accrual)
 *
 * When an estimation is approved the cost is committed — we want Finance to see
 * a provisional AP accrual immediately rather than waiting for invoice submission.
 *
 * Key differences from FinanceMaintenanceConsumer (work_order_completed):
 *   - Source type: 'MAINTENANCE_ESTIMATE'  ← separate key so it never conflicts
 *     with the final 'MAINTENANCE_REQUEST' payable created at INVOICE_SUBMITTED.
 *   - Uses estimatedCost from the event payload (actualCost isn't known yet).
 *   - The AP payable status is 'DRAFT' and payment_status is 'UNPAID'.
 *   - Journal entry is also DRAFT, narrated as an accrual provision.
 *   - The accrual is idempotent: re-processing the same event is safe.
 *
 * When the work order is later completed (INVOICE_SUBMITTED), FinanceMaintenanceConsumer
 * fires and creates the canonical 'MAINTENANCE_REQUEST' payable. The accrual row is
 * left as-is (reconciliation happens in Finance module manually or via a future job).
 */

import { BaseEventConsumer }                       from '@/events/consumer-base';
import type { DomainEventEnvelope }                from '@/events/event-envelope';
import { MAINTENANCE_ESTIMATION_APPROVED }         from '@/events/contracts/maintenance.events';
import type { EstimationApprovedPayload }          from '@/events/contracts/maintenance.events';
import { prisma }                                  from '@/lib/prisma';
import { createDraftJournalEntry }                 from '@/lib/finance/journal-service';

export class FinanceEstimationConsumer extends BaseEventConsumer<EstimationApprovedPayload> {
  readonly consumerName = 'finance-estimation-approved';
  readonly eventType    = MAINTENANCE_ESTIMATION_APPROVED;

  protected async handle(
    envelope: DomainEventEnvelope<EstimationApprovedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;
    const { requestId, vehicleId, estimatedCost, currency, garageId, garageName, approvedBy } = data;
    const cost = Number(estimatedCost ?? 0);

    if (cost <= 0) {
      console.log(`[finance-estimation] request ${requestId} — no cost, skipping accrual`);
      return;
    }

    const vatAmount  = parseFloat((cost * 0.05).toFixed(2));
    const total      = parseFloat((cost + vatAmount).toFixed(2));
    const vendor     = garageName ?? 'Workshop';
    const issueDate  = new Date().toISOString().slice(0, 10);
    const actor      = approvedBy ?? envelope.actor ?? 'system';
    const description = `Maintenance accrual (estimate): vehicle ${vehicleId}`;
    const reference   = requestId;

    // ── 1. DRAFT AP accrual payable (idempotent on source_type + source_id) ──
    const [existingAP] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM finance.finance_payables
        WHERE source_type = 'MAINTENANCE_ESTIMATE' AND source_id = $1 LIMIT 1`,
      requestId,
    ).catch(() => [] as Array<{ id: string }>);

    let payableId = existingAP?.id;

    if (!payableId) {
      const ym = issueDate.slice(0, 7).replace('-', '');
      const [seqRow] = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
        `SELECT COUNT(*) AS count FROM finance.finance_payables WHERE payable_number LIKE $1`,
        `AP-EST-${ym}-%`,
      ).catch(() => [{ count: 0 }]);
      const payableNumber = `AP-EST-${ym}-${String(Number(seqRow?.count ?? 0) + 1).padStart(5, '0')}`;

      const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO finance.finance_payables
           (payable_number, vendor_id, vendor_name, module,
            source_type, source_id, description, line_items,
            subtotal, vat_amount, total_amount, currency,
            issue_date, cost_centre, profit_centre,
            status, payment_status, prepared_by, tenant_id, notes)
         VALUES ($1,$2,$3,'MAINTENANCE',
                 'MAINTENANCE_ESTIMATE',$4,$5,$6::jsonb,
                 $7,$8,$9,$10,
                 $11::date,'PC-MAINTENANCE','PC-MAINTENANCE',
                 'DRAFT','UNPAID',$12,$13,$14)
         RETURNING id::text`,
        payableNumber,
        garageId ?? null,
        vendor,
        requestId,
        description,
        JSON.stringify([{
          description,
          qty:          1,
          unitPrice:    cost,
          amount:       cost,
          vehicleId,
          sourceModule: 'MAINTENANCE',
          note:         'Accrual estimate — superseded by final AP at invoice submission',
        }]),
        cost, vatAmount, total, currency ?? 'AED',
        issueDate,
        actor,
        tenantId,
        'Auto-generated accrual on estimation approval. Will be reconciled at invoice submission.',
      ).catch((err) => {
        console.warn(`[finance-estimation] AP insert failed for ${requestId}: ${err.message}`);
        return [] as Array<{ id: string }>;
      });

      payableId = row?.id;
    }

    // ── 2. DRAFT journal entry (accrual provision) ────────────────────────────
    const [existingJE] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM finance_journal_entries
        WHERE source_type = 'MAINTENANCE_ESTIMATE' AND source_id::text = $1 LIMIT 1`,
      requestId,
    ).catch(() => [] as Array<{ id: string }>);

    if (!existingJE?.id) {
      await createDraftJournalEntry({
        tenantId,
        narration:  `${description} [provision]`,
        reference,
        sourceType: 'MAINTENANCE_ESTIMATE',
        sourceId:   requestId,
        amount:     cost,
        currency:   currency ?? 'AED',
        preparedBy: actor,
        costCentre: 'PC-MAINTENANCE',
        notes:      `Accrual provision on estimation approval for MR ${requestId}.`,
        debit:  { code: '5100', name: 'Maintenance Expense',             description },
        credit: { code: '2100', name: 'Accounts Payable / Accrued Exp.', description: `Accrual est. ${requestId}` },
      }).catch(err =>
        console.warn(`[finance-estimation] createDraftJournalEntry failed: ${err.message}`),
      );
    }

    console.log(
      `[finance-estimation] request ${requestId} — accrual payable ${payableId ?? 'skipped (dup)'} created`,
    );
  }
}
