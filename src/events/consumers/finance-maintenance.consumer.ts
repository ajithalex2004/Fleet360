/**
 * Finance consumer: maintenance.work_order_completed → Finance
 *
 * Mirrors a completed maintenance work order to Finance via
 * mirrorMaintenanceToFinance() — creates AP payable + DRAFT JE.
 * Triggered on INVOICE_SUBMITTED, not MAINTENANCE_COMPLETED.
 * Idempotency handled at bridge level (source_type+source_id) and inbox.
 */

import { BaseEventConsumer }                        from '@/events/consumer-base';
import type { DomainEventEnvelope }                 from '@/events/event-envelope';
import { MAINTENANCE_WORK_ORDER_COMPLETED }         from '@/events/contracts/maintenance.events';
import type { MaintenanceWorkOrderCompletedPayload } from '@/events/contracts/maintenance.events';
import { mirrorMaintenanceToFinance }               from '@/lib/finance/module-ledger';

export class FinanceMaintenanceConsumer extends BaseEventConsumer<MaintenanceWorkOrderCompletedPayload> {
  readonly consumerName = 'finance-work-order-completed';
  readonly eventType    = MAINTENANCE_WORK_ORDER_COMPLETED;

  protected async handle(
    envelope: DomainEventEnvelope<MaintenanceWorkOrderCompletedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;

    // totalCost from the event is advisory — mirrorMaintenanceToFinance
    // re-reads actualCost/estimatedCost from the DB and will return
    // { mirrored: false, reason: 'no_billable_cost' } if there is nothing to post.
    const result = await mirrorMaintenanceToFinance(
      data.requestId,
      tenantId,
      envelope.actor ?? 'system',
    );

    if (!result) {
      console.log(`[finance-maintenance] request ${data.requestId} — no result from mirror`);
      return;
    }

    console.log(
      `[finance-maintenance] request ${data.requestId} → ` +
      `payable ${result.financePayableId} | JE ${result.journalEntryId}`,
    );
  }
}
